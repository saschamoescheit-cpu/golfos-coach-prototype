/**
 * Mirror mode (US-1.9) – pure state machine, the clock is passed in (ms), no timers inside.
 *
 *   out ──(inside the tolerance for enterDwellMs)──▶ in      tone 'reach'
 *   in  ──(still inside after holdMs)──────────────▶ held    tone 'held'
 *   in/held ──(outside the exit band for exitDwellMs)──▶ out  no tone (the line just turns red again)
 *
 * Hysteresis against flicker at the border (live landmarks jitter by a few degrees):
 * - enter when maxDistance ≤ enterDistance (1 = the tolerance itself) for at least enterDwellMs,
 * - leave only when maxDistance > exitDistance (default 1.15 = 15 % beyond the tolerance) or nothing is measured,
 *   continuously for exitDwellMs.
 * - after leaving, a new 'reach' tone needs at least reachCooldownMs since the last one (no machine-gun beeps when the
 *   player hovers around the border).
 * No continuous tone, ever: at most one 'reach' per entry and one 'held' per hold.
 */
export type MirrorState = 'out' | 'in' | 'held';
export type MirrorEvent = 'reach' | 'held' | 'leave';

export interface MirrorOptions {
  holdMs: number;
  enterDistance: number;
  exitDistance: number;
  enterDwellMs: number;
  exitDwellMs: number;
  reachCooldownMs: number;
}

export const MIRROR_DEFAULTS: MirrorOptions = {
  holdMs: 2000, // US-1.9: "hält der Spieler sie 2 Sekunden"
  enterDistance: 1,
  exitDistance: 1.15,
  enterDwellMs: 120,
  exitDwellMs: 250,
  reachCooldownMs: 700,
};

export interface MirrorUpdate {
  state: MirrorState;
  events: MirrorEvent[];
  /** ms the position has been held (0 when out) */
  heldMs: number;
  /** 0..1 progress of the 2-second hold (for a ring / bar on screen) */
  holdProgress: number;
}

export class MirrorMachine {
  readonly opts: MirrorOptions;
  private state: MirrorState = 'out';
  private insideSince: number | null = null;
  private outsideSince: number | null = null;
  private enteredAt = 0;
  private lastReachAt = -Infinity;

  constructor(opts: Partial<MirrorOptions> = {}) {
    this.opts = { ...MIRROR_DEFAULTS, ...opts };
  }

  get current(): MirrorState {
    return this.state;
  }

  /**
   * Feed one evaluation. `maxDistance` = largest criterion distance in tolerances (Evaluation.maxDistance);
   * null/Infinity/NaN = nothing measured (player not visible).
   */
  update(now: number, maxDistance: number | null): MirrorUpdate {
    const o = this.opts;
    const d = maxDistance == null || !Number.isFinite(maxDistance) ? Infinity : maxDistance;
    const events: MirrorEvent[] = [];

    if (this.state === 'out') {
      if (d <= o.enterDistance) {
        if (this.insideSince == null) this.insideSince = now;
        if (now - this.insideSince >= o.enterDwellMs) {
          this.state = 'in';
          this.enteredAt = now;
          this.outsideSince = null;
          if (now - this.lastReachAt >= o.reachCooldownMs) {
            events.push('reach');
            this.lastReachAt = now;
          }
        }
      } else {
        this.insideSince = null;
      }
    } else {
      if (d > o.exitDistance) {
        if (this.outsideSince == null) this.outsideSince = now;
        if (now - this.outsideSince >= o.exitDwellMs) {
          this.state = 'out';
          this.insideSince = null;
          this.outsideSince = null;
          events.push('leave');
        }
      } else {
        this.outsideSince = null;
      }
      if (this.state === 'in' && now - this.enteredAt >= o.holdMs) {
        this.state = 'held';
        events.push('held');
      }
    }

    const heldMs = this.state === 'out' ? 0 : now - this.enteredAt;
    return { state: this.state, events, heldMs, holdProgress: Math.min(1, heldMs / o.holdMs) };
  }

  reset(): void {
    this.state = 'out';
    this.insideSince = null;
    this.outsideSince = null;
    this.enteredAt = 0;
    this.lastReachAt = -Infinity;
  }
}
