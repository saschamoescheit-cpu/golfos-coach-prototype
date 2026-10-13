import { LM } from '../model/constants';
import type { Landmark } from '../model/types';

/**
 * Live viewfinder checks (camera guide, US-1.0): is the whole player in the picture, big enough, alone, phone level?
 * Pure functions on RAW (as filmed) landmarks. OWNER: agent "capture-pose".
 */
export type LiveIssue =
  | 'no_person'
  | 'body_cut_off' // head or feet outside the picture
  | 'too_far' // player small in the picture
  | 'no_headroom' // head close to the top edge → club at the top will be cut off (full swings)
  | 'multiple_people'
  | 'camera_tilted';

/** ordered by importance – the viewfinder shows the first one */
export const LIVE_ISSUE_ORDER: LiveIssue[] = ['no_person', 'multiple_people', 'body_cut_off', 'too_far', 'no_headroom', 'camera_tilted'];

export interface LiveCheckOptions {
  /** people seen by the detector in this frame */
  people?: number;
  /** full swing → the club goes above the head; leave room at the top */
  needsHeadroom?: boolean;
}

export function liveFrameIssues(lm: Landmark[] | null, opts: LiveCheckOptions = {}): LiveIssue[] {
  if (!lm) return ['no_person'];
  const out: LiveIssue[] = [];
  if ((opts.people ?? 1) > 1) out.push('multiple_people');
  const nose = lm[LM.NOSE];
  const ankles = [lm[LM.LEFT_ANKLE], lm[LM.RIGHT_ANKLE]];
  const headOut = nose.v < 0.5 || nose.y < 0.03 || nose.x < 0 || nose.x > 1;
  const feetOut = ankles.every((a) => a.v < 0.5 || a.y > 0.98 || a.x < 0 || a.x > 1);
  if (headOut || feetOut) out.push('body_cut_off');
  else {
    const feet = Math.max(...[LM.LEFT_ANKLE, LM.RIGHT_ANKLE, LM.LEFT_HEEL, LM.RIGHT_HEEL, LM.LEFT_FOOT, LM.RIGHT_FOOT].map((i) => lm[i].y));
    const height = (feet - nose.y) * 1.12;
    if (height < 0.35) out.push('too_far');
    // REVIEW(golf): at the top of a full swing the club head is roughly one head-to-hip length above the head
    if (opts.needsHeadroom && nose.y < 0.15) out.push('no_headroom');
  }
  return out;
}

/**
 * Phone held upright (portrait) and level? DeviceOrientation: beta = tilt forward/back (90 = upright),
 * gamma = roll left/right (0 = level). Returns true when the picture will be tilted.
 */
export function cameraTilted(beta: number | null | undefined, gamma: number | null | undefined): boolean {
  if (beta == null || gamma == null || !Number.isFinite(beta) || !Number.isFinite(gamma)) return false;
  return Math.abs(gamma) > 8 || Math.abs(beta - 90) > 25;
}

/**
 * Show an issue only after it was present for `onMs`, hide it after it was gone for `offMs` – the status text must not
 * flicker with every noisy frame.
 */
export class IssueDebouncer<T extends string> {
  private since = new Map<T, number>();
  private lastSeen = new Map<T, number>();
  private shown = new Set<T>();
  constructor(
    private onMs = 500,
    private offMs = 700,
  ) {}

  push(issues: T[], t: number): T[] {
    const now = new Set(issues);
    for (const i of now) {
      if (!this.since.has(i)) this.since.set(i, t);
      this.lastSeen.set(i, t);
      if (t - this.since.get(i)! >= this.onMs) this.shown.add(i);
    }
    for (const i of [...this.since.keys()]) {
      if (now.has(i)) continue;
      if (t - (this.lastSeen.get(i) ?? t) >= this.offMs) {
        this.since.delete(i);
        this.shown.delete(i);
      } else if (!this.shown.has(i)) this.since.delete(i);
    }
    return [...this.shown];
  }

  reset() {
    this.since.clear();
    this.lastSeen.clear();
    this.shown.clear();
  }
}
