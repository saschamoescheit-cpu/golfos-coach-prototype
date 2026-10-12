import { LM } from '../model/constants';
import type { CameraView, Landmark, PoseFrame, ShotType, Vec2 } from '../model/types';

/**
 * OWNER: agent "capture-pose" (US-1.0 automatic recording without a button).
 * Pure state machine fed with CANONICAL live pose frames (~15–30 per second). Used by the capture screen
 * (auto-record) and by the training series (agent "training").
 *
 * Events:
 * - 'player'  : a person is fully in the frame ("Player detected")
 * - 'address' : the player stands still in an address posture ("Ready for swing")
 * - 'impact'  : (additive) fired as soon as the hands came back through the address zone fast – about one frame after
 *               the real impact; use it for quick feedback (training tone). The 'swing' event follows later.
 * - 'swing'   : a complete swing happened; startT/endT bracket it (ms, same clock as the frames) incl. pre/post-roll
 *               practice = true when it looks like a practice swing (best effort, see docs/coach/decisions/capture-pose.md)
 * - 'lost'    : the player left the frame
 *
 * How it works (all distances relative to the torso length, so camera distance does not matter):
 *   idle → (person fully visible 0.3 s) → present → (hands low in front of the body, still for stillMs) → address
 *   → (hands leave the address spot) → backswing → (hands come back, distance < 60 % of the largest) → downswing
 *   → (hands pass the address spot and move away again, downswing faster than backswing) → follow
 *   → (hands still again = finish, or timeout) → post → (post-roll elapsed) → 'swing' → present (re-armed).
 * Anything that does not fit (slow return, timeout, hands at rest, hands far from the address spot) silently goes
 * back to 'present' – it was a waggle or a rehearsal, not a swing. One swing can only fire once, because a new swing
 * needs a new still address first.
 *
 * Hand motion: face-on in the image plane. Down-the-line most of the hand motion is along the camera axis (towards /
 * away from the target), so the trigger uses MediaPipe's 3D world landmarks there when the frames carry them;
 * without them it falls back to the image with halved thresholds.
 */
export type TriggerEvent =
  | { type: 'player' }
  | { type: 'address' }
  | { type: 'impact'; startT: number; topT: number; impactT: number }
  | {
      type: 'swing';
      startT: number;
      topT: number | null;
      impactT: number | null;
      endT: number;
      practice: boolean;
      /** (additive) how long the player stood still at address before the takeaway (ms) */
      addressStillMs?: number;
      /** (additive) largest hand excursion from the address spot in torso lengths */
      amplitude?: number;
    }
  | { type: 'lost' };

export interface SwingTriggerOptions {
  shotType: ShotType;
  view: CameraView;
  /** pre-roll before the takeaway and post-roll after the finish to keep in the clip (ms) */
  preRollMs?: number;
  postRollMs?: number;
  /** (additive) width/height of the camera picture; distances are measured aspect-correct. Default 9/16 (portrait). */
  aspect?: number;
  /** (additive) how long the player must stand still for 'address' (ms, default 500) */
  stillMs?: number;
  /** (additive) shorter still address before the takeaway → practice swing (ms, default 1000) */
  practiceAddressMs?: number;
  /** (additive) use 3D world landmarks for the hand motion down-the-line when available (default true) */
  useWorld?: boolean;
}

export type TriggerState = 'idle' | 'present' | 'address' | 'backswing' | 'downswing' | 'follow' | 'post';

type V3 = [number, number, number];

interface Sample {
  t: number;
  /** image (pixel space) – posture checks */
  hands: Vec2;
  sh: Vec2;
  hip: Vec2;
  torso: number;
  /** motion point of the hands (pixel space with z = 0, or world metres) and the torso length in the same units */
  m: V3;
  mTorso: number;
  full: boolean;
}

// REVIEW(golf): all motion thresholds below are first guesses (torso lengths), to be checked with real range videos.
/** hands must leave the address spot by this much to count as a takeaway */
const MOVE_TOL: Record<ShotType, number> = { putt: 0.1, chip: 0.15, pitch: 0.2, bunker: 0.2, iron: 0.2, driver: 0.2 };
/** smaller hand excursion than this = waggle-like → flagged as practice swing */
const AMP_MIN: Record<ShotType, number> = { putt: 0.15, chip: 0.3, pitch: 0.6, bunker: 1.2, iron: 1.2, driver: 1.2 };
/** absolute minimum excursion for anything that is treated as a swing */
const AMP_ANY = 0.1;
/** stillness: hands within this radius of their mean, shoulders within SHOULDER_STILL */
const HAND_STILL = 0.1;
const SHOULDER_STILL = 0.08;
/** downswing must not be slower than the backswing: down ≤ TEMPO_MAX × back (real tempos are 2:1 … 3:1; rehearsals ~1:1) */
const TEMPO_MAX = 1.0;
/** image-only down-the-line: the hands move mostly along the camera axis → visible motion is smaller */
const DTL_IMAGE_FACTOR = 0.5;
/** shorter backswings are jitter or a twitch, not a stroke (even short putts take ~0.4 s back) */
const MIN_BACKSWING_MS = 200;
const PRESENT_MS = 300;
const LOST_MS = 700;
const FINISH_STILL_MS = 400;
const FOLLOW_TIMEOUT_MS = 2500;
const BACKSWING_TIMEOUT_MS = 4000;
const DOWNSWING_TIMEOUT_MS = 1500;
const COOLDOWN_MS = 500;
const BUFFER_MS = 2500;

export class SwingTrigger {
  private st: TriggerState = 'idle';
  private buf: Sample[] = [];
  private presentSince: number | null = null;
  private lastSeen = -Infinity;
  private mode: 'image' | 'world' | null = null;
  private torsoRef = NaN;
  private addr: V3 | null = null;
  /** jitter of the hands while standing still at address (torso lengths) */
  private addrNoise = 0;
  private stillSince: number | null = null;
  private stillUntil = -Infinity;
  private cooldownUntil = -Infinity;
  // current swing
  private takeawayT = 0;
  private addrStillMs = 0;
  private maxD = 0;
  private topT = 0;
  private topM: V3 = [0, 0, 0];
  private prev: Sample | null = null;
  private bestD = Infinity;
  private minSampleD = Infinity;
  private impactT: number | null = null;
  private endT = 0;
  private lastT = 0;
  private recentM: { t: number; m: V3 }[] = [];

  constructor(readonly opts: SwingTriggerOptions) {}

  get state(): TriggerState {
    return this.st;
  }

  /** threshold scale: smaller when down-the-line motion can only be seen in the image */
  private get k(): number {
    return this.opts.view === 'down_the_line' && this.mode === 'image' ? DTL_IMAGE_FACTOR : 1;
  }

  /** feed one frame; returns the events it caused (usually none) */
  push(frame: PoseFrame): TriggerEvent[] {
    const ev: TriggerEvent[] = [];
    const t = frame.t;
    this.lastT = t;
    const s = this.sample(frame);

    if (s) {
      this.lastSeen = t;
      this.buf.push(s);
      while (this.buf.length && this.buf[0].t < t - BUFFER_MS) this.buf.shift();
    }

    // --- presence
    if (this.st === 'idle') {
      if (s?.full) {
        this.presentSince ??= t;
        if (t - this.presentSince >= PRESENT_MS) {
          this.st = 'present';
          ev.push({ type: 'player' });
        }
      } else this.presentSince = null;
      return ev;
    }
    if (!s) {
      if (t - this.lastSeen > LOST_MS) {
        if (this.st === 'follow' || this.st === 'post') ev.push(this.emitSwing(Math.min(this.lastSeen + (this.opts.postRollMs ?? 700), t)));
        this.toIdle();
        ev.push({ type: 'lost' });
      } else if (this.st === 'post' && t >= this.endT) ev.push(this.emitSwing(this.endT));
      return ev;
    }

    switch (this.st) {
      case 'present':
      case 'address':
        this.updateAddress(s, ev);
        break;
      case 'backswing':
        this.backswing(s);
        break;
      case 'downswing':
        this.downswing(s, ev);
        break;
      case 'follow':
        this.follow(s);
        break;
      case 'post':
        break;
    }
    if (this.st === 'post' && t >= this.endT) ev.push(this.emitSwing(this.endT));
    return ev;
  }

  /** Emit a pending swing now (e.g. when the camera is stopped during the post-roll). */
  flush(): TriggerEvent[] {
    if (this.st === 'follow' || this.st === 'post') return [this.emitSwing(Math.max(this.lastT, this.impactT ?? this.lastT))];
    return [];
  }

  reset(): void {
    this.toIdle();
    this.cooldownUntil = -Infinity;
  }

  // ------------------------------------------------------------------ states

  private toIdle() {
    this.st = 'idle';
    this.buf = [];
    this.presentSince = null;
    this.mode = null;
    this.recentM = [];
    this.toPresent();
    this.st = 'idle';
  }

  private toPresent() {
    this.st = 'present';
    this.addr = null;
    this.stillSince = null;
    this.impactT = null;
  }

  private d(m: V3): number {
    return dist3(m, this.addr!) / this.torsoRef;
  }

  private updateAddress(s: Sample, ev: TriggerEvent[]) {
    const tol = MOVE_TOL[this.opts.shotType] * this.k;
    // takeaway?
    if (this.st === 'address' && this.addr) {
      const d = this.d(s.m);
      if (d > tol) {
        // takeaway = last moment the hands were still near the address spot
        let tk = s.t;
        for (let i = this.buf.length - 2; i >= 0; i--) {
          tk = this.buf[i].t;
          if (this.d(this.buf[i].m) < Math.min(tol / 2, Math.max(tol / 4, 1.5 * this.addrNoise))) break;
        }
        this.takeawayT = tk;
        // the still set-up must have lasted until shortly before the takeaway
        this.addrStillMs = this.stillSince !== null && this.stillUntil >= tk - 400 ? Math.max(0, tk - this.stillSince) : 0;
        this.maxD = d;
        this.topT = s.t;
        this.topM = s.m;
        this.st = 'backswing';
        return;
      }
    }
    if (s.t < this.cooldownUntil) return;
    const still = this.stillWindow(s.t, this.opts.stillMs ?? 500, HAND_STILL * this.k, true);
    const posture = s.hands.y > s.sh.y + 0.6 * s.torso && Math.abs(s.hands.x - s.hip.x) < 1.2 * s.torso;
    if (still && posture) {
      if (this.stillSince === null || this.stillUntil < s.t - 300) this.stillSince = still.since;
      this.stillUntil = s.t;
      this.addr = still.m;
      this.torsoRef = still.torso;
      const ds = this.buf.filter((b) => b.t >= s.t - (this.opts.stillMs ?? 500)).map((b) => this.d(b.m)).sort((x, y) => x - y);
      this.addrNoise = ds[Math.floor(ds.length * 0.9)] ?? 0;
      if (this.st === 'present') {
        this.st = 'address';
        ev.push({ type: 'address' });
      }
    } else if (this.st === 'address' && !posture) {
      // left the address posture without a takeaway (e.g. walked away with the club up) → wait for a new address
      this.toPresent();
    }
  }

  private backswing(s: Sample) {
    const d = this.d(s.m);
    if (d > this.maxD) {
      this.maxD = d;
      this.topT = s.t;
      this.topM = s.m;
    }
    const k = this.k;
    const prev = this.buf.length >= 2 ? this.buf[this.buf.length - 2] : s;
    // with few frames (or a dropout at impact) the hands may jump from the downswing straight into the follow-through:
    // the path segment then passes the address spot although no single frame is close to it
    const passed = prev !== s && this.passPoint(prev, s).d <= this.impactTol() && d < this.maxD * 0.9;
    if (this.maxD >= AMP_ANY * k && ((d < 0.6 * this.maxD && d < this.maxD - (MOVE_TOL[this.opts.shotType] * k) / 2) || passed)) {
      this.st = 'downswing';
      this.prev = prev;
      this.bestD = Infinity;
      this.minSampleD = this.d(prev.m);
      this.impactT = null;
      this.downswing(s, []);
      return;
    }
    // hands came to rest somewhere (player moved to a new address, re-gripped …) → no swing; re-arm
    if (s.t - this.takeawayT > BACKSWING_TIMEOUT_MS || this.resting(s.t)) this.toPresent();
  }

  /**
   * Where the hand path segment prev → s passes the address spot: closest point of the segment, or – when the hands
   * jumped from the backswing side to the other side (few frames, dropout) – the moment the horizontal motion crosses
   * the address spot.
   */
  private passPoint(prev: Sample, s: Sample): { d: number; t: number } {
    const c = closestOnSegment(prev.m, s.m, this.addr!);
    const res = { d: this.d(c.p), t: prev.t + c.f * (s.t - prev.t) };
    const a = this.addr!;
    const h: V3 = [this.topM[0] - a[0], 0, this.topM[2] - a[2]];
    const hl = Math.hypot(h[0], h[2]);
    if (hl / this.torsoRef < 0.2) return res;
    const proj = (m: V3) => ((m[0] - a[0]) * h[0] + (m[2] - a[2]) * h[2]) / hl / this.torsoRef;
    const pa = proj(prev.m);
    const pb = proj(s.m);
    if (pa > 0.2 && pb < -0.2) {
      const f = pa / (pa - pb);
      return { d: 0, t: prev.t + f * (s.t - prev.t) };
    }
    return res;
  }

  /**
   * Top of the backswing = middle of the plateau where the hands are within 7 % of their largest distance from the
   * address spot (the arg-max alone wanders with jitter because the hands are slow around the top).
   */
  private plateauTop(impactT: number): number {
    const near = this.buf.filter((b) => b.t >= this.takeawayT && b.t <= impactT && this.d(b.m) >= 0.93 * this.maxD);
    return near.length ? (near[0].t + near[near.length - 1].t) / 2 : this.topT;
  }

  /** how close the hand path must come back to the address spot at impact (torso lengths) */
  private impactTol(): number {
    return Math.max(0.25 * this.k, 0.35 * this.maxD);
  }

  /** hands at rest for stillMs – never happens during a real backswing or downswing */
  private resting(t: number): boolean {
    return !!this.stillWindow(t, this.opts.stillMs ?? 500, HAND_STILL * this.k, false);
  }

  private downswing(s: Sample, ev: TriggerEvent[]) {
    const prev = this.prev ?? s;
    if (prev !== s) {
      // closest point of the hand path segment prev → s to the address spot (works with few frames per second)
      const pp = this.passPoint(prev, s);
      if (pp.d < this.bestD) {
        this.bestD = pp.d;
        this.impactT = pp.t;
      }
      const dCur = this.d(s.m);
      // moving away again = clearly further from the address spot than the closest sample so far (robust to jitter)
      const movingAway = dCur > this.minSampleD + Math.max(0.05 * this.k, 0.1 * this.maxD);
      this.minSampleD = Math.min(this.minSampleD, dCur);
      if (movingAway && this.impactT !== null) {
        const tol = this.impactTol();
        this.topT = this.plateauTop(this.impactT);
        const back = this.topT - this.takeawayT;
        const down = this.impactT - this.topT;
        if (this.bestD <= tol && back >= MIN_BACKSWING_MS && down > 0 && down <= TEMPO_MAX * back && down <= DOWNSWING_TIMEOUT_MS) {
          this.st = 'follow';
          ev.push({ type: 'impact', startT: this.startT(), topT: this.topT, impactT: this.impactT });
        } else this.toPresent();
        this.prev = s;
        return;
      }
    }
    this.prev = s;
    if (s.t - this.topT > DOWNSWING_TIMEOUT_MS || this.resting(s.t)) this.toPresent();
  }

  private follow(s: Sample) {
    const impactT = this.impactT!;
    const post = this.opts.postRollMs ?? 700;
    if (s.t - impactT >= 300) {
      const still = this.stillWindow(s.t, FINISH_STILL_MS, HAND_STILL * 1.5 * this.k, false);
      if (still && still.since > impactT) {
        this.endT = Math.min(still.since + post, impactT + FOLLOW_TIMEOUT_MS + post);
        this.st = 'post';
        return;
      }
    }
    if (s.t - impactT >= FOLLOW_TIMEOUT_MS) {
      this.endT = s.t + post;
      this.st = 'post';
    }
  }

  private startT() {
    return this.takeawayT - (this.opts.preRollMs ?? 1000);
  }

  private emitSwing(endT: number): TriggerEvent {
    const practice = this.addrStillMs < (this.opts.practiceAddressMs ?? 1000) || this.maxD < AMP_MIN[this.opts.shotType] * this.k;
    const e: TriggerEvent = {
      type: 'swing',
      startT: this.startT(),
      topT: this.topT,
      impactT: this.impactT,
      endT,
      practice,
      addressStillMs: Math.round(this.addrStillMs),
      amplitude: Math.round(this.maxD * 100) / 100,
    };
    this.toPresent();
    this.cooldownUntil = this.lastT + COOLDOWN_MS;
    return e;
  }

  // ------------------------------------------------------------------ signals

  private sample(f: PoseFrame): Sample | null {
    const lm = f.lm;
    if (!lm || lm.length < 33) return null;
    const a = this.opts.aspect ?? 9 / 16;
    const P = (i: number, minV = 0.3): Vec2 | null => (lm[i] && lm[i].v >= minV ? { x: lm[i].x * a, y: lm[i].y } : null);
    const ls = P(LM.LEFT_SHOULDER);
    const rs = P(LM.RIGHT_SHOULDER);
    const lh = P(LM.LEFT_HIP);
    const rh = P(LM.RIGHT_HIP);
    const lw = P(LM.LEFT_WRIST, 0.2);
    const rw = P(LM.RIGHT_WRIST, 0.2);
    if (!ls || !rs || !lh || !rh || (!lw && !rw)) return null;
    const sh = midV(ls, rs);
    const hip = midV(lh, rh);
    const torso = distV(sh, hip);
    if (!(torso > 0.01)) return null;
    const hands = lw && rw ? midV(lw, rw) : (lw ?? rw)!;

    const w = f.world;
    const wantWorld = (this.opts.useWorld ?? true) && this.opts.view === 'down_the_line';
    if (this.mode === null) this.mode = wantWorld && w && w.length >= 33 ? 'world' : 'image';
    let m: V3 = [hands.x, hands.y, 0];
    let mTorso = torso;
    if (this.mode === 'world') {
      if (!w || w.length < 33) return null;
      const W = (i: number): V3 => [w[i].x, w[i].y, w[i].z];
      const sh3 = mid3(W(LM.LEFT_SHOULDER), W(LM.RIGHT_SHOULDER));
      const hip3 = mid3(W(LM.LEFT_HIP), W(LM.RIGHT_HIP));
      mTorso = dist3(sh3, hip3);
      if (!(mTorso > 0.05)) return null;
      m = mid3(W(LM.LEFT_WRIST), W(LM.RIGHT_WRIST));
      // world depth is noisy: average the last 3 samples and give the average the mean time (no time shift, one frame latency)
      this.recentM.push({ t: f.t, m });
      while (this.recentM.length > 3 || (this.recentM.length && this.recentM[0].t < f.t - 250)) this.recentM.shift();
      const r = this.recentM;
      m = [0, 1, 2].map((c) => mean(r.map((x) => x.m[c]))) as V3;
      return { t: mean(r.map((x) => x.t)), hands, sh, hip, torso, m, mTorso, full: fullyInFrame(lm) };
    }
    return { t: f.t, hands, sh, hip, torso, m, mTorso, full: fullyInFrame(lm) };
  }

  /** still during the last `ms`? returns the mean motion point and the start of the still period */
  private stillWindow(t: number, ms: number, handTol: number, checkShoulders: boolean): { m: V3; torso: number; since: number } | null {
    const w = this.buf.filter((b) => b.t >= t - ms);
    if (w.length < 4 || w[w.length - 1].t - w[0].t < ms * 0.75) return null;
    const inSwing = this.st === 'follow' || this.st === 'backswing' || this.st === 'downswing';
    const torso = inSwing && Number.isFinite(this.torsoRef) ? this.torsoRef : mean(w.map((b) => b.mTorso));
    const hm: V3 = [0, 1, 2].map((c) => mean(w.map((b) => b.m[c]))) as V3;
    if (w.some((b) => dist3(b.m, hm) / torso > handTol)) return null;
    if (checkShoulders) {
      const sm = { x: mean(w.map((b) => b.sh.x)), y: mean(w.map((b) => b.sh.y)) };
      const it = mean(w.map((b) => b.torso));
      if (w.some((b) => distV(b.sh, sm) / it > SHOULDER_STILL)) return null;
    }
    // the still period may have started earlier than the window: extend backwards while the hands stay close
    let since = w[0].t;
    for (let i = this.buf.length - w.length - 1; i >= 0; i--) {
      if (dist3(this.buf[i].m, hm) / torso > handTol) break;
      since = this.buf[i].t;
    }
    return { m: hm, torso, since };
  }
}

// ------------------------------------------------------------------ helpers

const midV = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distV = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const mid3 = (a: V3, b: V3): V3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const dist3 = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

function closestOnSegment(a: V3, b: V3, p: V3): { p: V3; f: number } {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const f = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / l2)) : 0;
  return { p: [a[0] + f * d[0], a[1] + f * d[1], a[2] + f * d[2]], f };
}

/** head, shoulders, hips and at least one ankle visible and inside the picture */
export function fullyInFrame(lm: Landmark[]): boolean {
  const ok = (i: number) => {
    const p = lm[i];
    return p && p.v >= 0.5 && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
  };
  return (
    ok(LM.NOSE) && ok(LM.LEFT_SHOULDER) && ok(LM.RIGHT_SHOULDER) && ok(LM.LEFT_HIP) && ok(LM.RIGHT_HIP) &&
    (ok(LM.LEFT_ANKLE) || ok(LM.RIGHT_ANKLE))
  );
}
