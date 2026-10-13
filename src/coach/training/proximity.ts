import type { KeyPosition, MetricId, MetricValue, TargetCriterion } from '../model/types';

/**
 * How close is the player to a training target? Pure functions, no DOM.
 *
 * Distance of one criterion = |measured − target| / (tolerance × toleranceScale), i.e. measured in "tolerances":
 *   0   = exactly on target
 *   ≤ 1 = inside the tolerance  → HIT
 *   3   = three tolerances away → proximity 0 (FAR_DISTANCE)
 * Proximity of one criterion = 1 − distance / 3, clamped to 0..1 (linear). Inside the tolerance it is therefore ≥ 2/3.
 * Overall proximity = the WEAKEST criterion (minimum): a target with two criteria is only "close" when both are close,
 * matching the hit rule "all criteria inside the tolerance".
 * Missing values (metric not measurable in this frame / swing) make the evaluation incomplete: no hit, and the overall
 * proximity only reflects the criteria that were measured (null when none was).
 */
export const FAR_DISTANCE = 3;
/** proximity value at the tolerance border (distance 1) */
export const BORDER_PROXIMITY = 1 - 1 / FAR_DISTANCE;
/** values below this metric confidence are treated as missing */
export const MIN_CONFIDENCE = 0.3;

export interface CriterionResult {
  criterion: TargetCriterion;
  value: number | null;
  /** in tolerances; null when not measured */
  distance: number | null;
  proximity: number | null;
  within: boolean;
  /** signed: + = value above target (used for hints "more" / "less") */
  direction: -1 | 0 | 1;
}

export interface Evaluation {
  criteria: CriterionResult[];
  /** 0..1, null when nothing could be measured */
  proximity: number | null;
  /** largest distance among the measured criteria (Infinity when nothing was measured) */
  maxDistance: number;
  /** all criteria measured and inside their tolerance */
  hit: boolean;
  /** number of criteria without a value */
  missing: number;
}

export function criterionDistance(c: TargetCriterion, value: number, toleranceScale = 1): number {
  const tol = Math.max(1e-9, Math.abs(c.tolerance) * (toleranceScale > 0 ? toleranceScale : 1));
  return Math.abs(value - c.target) / tol;
}

export function proximityFromDistance(d: number): number {
  if (!Number.isFinite(d)) return 0;
  return Math.max(0, Math.min(1, 1 - d / FAR_DISTANCE));
}

/** Look up the value for a criterion; accepts a list of MetricValues or a lookup function. */
export type ValueSource = MetricValue[] | ((metric: MetricId, at: KeyPosition | 'swing') => number | null | undefined);

function lookup(src: ValueSource, c: TargetCriterion): number | null {
  if (typeof src === 'function') {
    const v = src(c.metric, c.at);
    return v == null || !Number.isFinite(v) ? null : v;
  }
  // exact position first, then any value of that metric (live frames are computed for the trained position only)
  const m = src.find((v) => v.id === c.metric && v.at === c.at) ?? src.find((v) => v.id === c.metric);
  if (!m || !Number.isFinite(m.value) || m.confidence < MIN_CONFIDENCE) return null;
  return m.value;
}

export function evaluateCriteria(criteria: TargetCriterion[], values: ValueSource, toleranceScale = 1): Evaluation {
  const results: CriterionResult[] = criteria.map((c) => {
    const value = lookup(values, c);
    if (value == null) return { criterion: c, value: null, distance: null, proximity: null, within: false, direction: 0 };
    const distance = criterionDistance(c, value, toleranceScale);
    return {
      criterion: c,
      value,
      distance,
      proximity: proximityFromDistance(distance),
      within: distance <= 1,
      direction: value > c.target ? 1 : value < c.target ? -1 : 0,
    };
  });
  const measured = results.filter((r) => r.distance != null);
  const missing = results.length - measured.length;
  const maxDistance = measured.length ? Math.max(...measured.map((r) => r.distance as number)) : Infinity;
  return {
    criteria: results,
    proximity: measured.length ? proximityFromDistance(maxDistance) : null,
    maxDistance,
    hit: results.length > 0 && missing === 0 && results.every((r) => r.within),
    missing,
  };
}

// ------------------------------------------------------------------ colours

/** Strong outdoor colours (iOS system palette – readable in the sun). Green always means "inside the tolerance". */
export const COLORS = {
  red: '#ff3b30',
  yellow: '#ffd60a',
  green: '#30d158',
  unknown: '#8e9aa3',
} as const;

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mixHex(a: string, b: string, t: number): string {
  const x = hex(a);
  const y = hex(b);
  const m = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `#${m.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Colour for a proximity value: outside the tolerance a gradient red (far) → yellow (almost there),
 * inside the tolerance always green. The jump yellow → green at the border is intended – it coincides with the "reach"
 * tone, so colour and sound tell the same story. null → grey ("not visible").
 */
export function colorForProximity(p: number | null): string {
  if (p == null) return COLORS.unknown;
  if (p >= BORDER_PROXIMITY - 1e-9) return COLORS.green;
  const t = Math.max(0, p) / BORDER_PROXIMITY; // 0..1 outside the tolerance
  return mixHex(COLORS.red, COLORS.yellow, t);
}
