import { rescore } from '../faults/score';
import type { CameraView, ScoreLevel, ShotType, Swing, SwingScore } from '../model/types';

/**
 * Swing score over time (Swing-Score rules §3 and §4.5/4.6, review W7). Pure functions, no DOM.
 *
 * - Every screen shows a stored score on the player's CURRENT level (rescore from the stored raw criteria), so one swing
 *   never shows two different numbers after a level change.
 * - Progress curve = median score per practice unit. A unit is one calendar day (local time) of one measuring profile
 *   (same view + shot type, §4.4) with at least MIN_SWINGS_PER_UNIT scored swings – fewer swings are too noisy.
 * - Level-up: when the median of the last LEVEL_UP_UNITS units on the own level reaches LEVEL_UP_MEDIAN, the app
 *   SUGGESTS the next (stricter) level; the player confirms. Nothing changes automatically.
 */
export const MIN_SWINGS_PER_UNIT = 5;
export const LEVEL_UP_UNITS = 3;
export const LEVEL_UP_MEDIAN = 85;

/** The swing's score on the given level (stored score when it already is on that level or has no raw criteria). */
export function displayScore(swing: Pick<Swing, 'score' | 'shotType' | 'view' | 'handedness'>, level: ScoreLevel): SwingScore | null | undefined {
  const sc = swing.score;
  if (!sc || !sc.criteria || sc.level === level) return sc;
  try {
    return rescore(sc, { shotType: swing.shotType, view: swing.view, handedness: swing.handedness }, { level });
  } catch {
    return sc;
  }
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Local calendar day "YYYY-MM-DD". */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface ScoreUnit {
  day: string;
  shotType: ShotType;
  view: CameraView;
  /** first swing of the unit (ms) – for sorting */
  start: number;
  /** scored swings in the unit */
  n: number;
  median: number;
}

/** Practice units (≥ MIN_SWINGS_PER_UNIT scored swings, same day + view + shot type), oldest first. */
export function scoreUnits(swings: Swing[], level: ScoreLevel, profile?: { shotType?: ShotType; view?: CameraView }): ScoreUnit[] {
  const groups = new Map<string, { day: string; shotType: ShotType; view: CameraView; start: number; totals: number[] }>();
  for (const s of swings) {
    if (profile?.shotType && s.shotType !== profile.shotType) continue;
    if (profile?.view && s.view !== profile.view) continue;
    const total = displayScore(s, level)?.total;
    if (total === null || total === undefined || !Number.isFinite(total)) continue;
    const day = dayKey(s.createdAt);
    const key = `${day}|${s.shotType}|${s.view}`;
    const g = groups.get(key) ?? { day, shotType: s.shotType, view: s.view, start: s.createdAt, totals: [] };
    g.start = Math.min(g.start, s.createdAt);
    g.totals.push(total);
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter((g) => g.totals.length >= MIN_SWINGS_PER_UNIT)
    .map((g) => ({ day: g.day, shotType: g.shotType, view: g.view, start: g.start, n: g.totals.length, median: median(g.totals)! }))
    .sort((a, b) => a.start - b.start);
}

export interface ScoreCurve {
  shotType: ShotType;
  view: CameraView;
  units: ScoreUnit[];
}

/** One median curve per measuring profile (view + shot type) that has at least one unit; most units first. */
export function scoreCurves(swings: Swing[], level: ScoreLevel, shotType?: ShotType): ScoreCurve[] {
  const byProfile = new Map<string, ScoreCurve>();
  for (const u of scoreUnits(swings, level, { shotType })) {
    const key = `${u.shotType}|${u.view}`;
    const c = byProfile.get(key) ?? { shotType: u.shotType, view: u.view, units: [] };
    c.units.push(u);
    byProfile.set(key, c);
  }
  return [...byProfile.values()].sort((a, b) => b.units.length - a.units.length);
}

export interface LevelUpSuggestion {
  from: ScoreLevel;
  to: ScoreLevel;
  /** median of the last units on the current level */
  median: number;
  units: ScoreUnit[];
}

/**
 * Suggest the next stricter level (level − 1) when the median of the last LEVEL_UP_UNITS units (each ≥ 5 swings, any
 * profile, scored on the current level) is ≥ LEVEL_UP_MEDIAN. Level 1 is the top. Suggestion only.
 */
export function levelUpSuggestion(swings: Swing[], level: ScoreLevel): LevelUpSuggestion | null {
  if (level <= 1) return null;
  const units = scoreUnits(swings, level).slice(-LEVEL_UP_UNITS);
  if (units.length < LEVEL_UP_UNITS) return null;
  const m = median(units.map((u) => u.median))!;
  if (m < LEVEL_UP_MEDIAN) return null;
  return { from: level, to: (level - 1) as ScoreLevel, median: m, units };
}
