import { QUALITY_MIN, SHOT_TYPES } from '../model/constants';
import type {
  KeyPosition,
  MetricId,
  ScoreCriterion,
  ScoreLevel,
  ScoreStatus,
  Settings,
  SwingMetrics,
  SwingScore,
  SwingScorePartId,
} from '../model/types';
import type { AnalysisContext } from '../analysis/context';
import { metricAvailable } from './metricContract';
import scoreJson from './score.json';

/**
 * OWNER: agent "faults" (work package D). Swing-Score per the binding rules of 12.10.2026
 * (features/015-coach/swing-score-regeln.md): six parts, piecewise-linear point curve, player levels that scale
 * tolerances only, measurement-error floor, confidence gate, ≥ 80 % measured weight for a total, raw criteria stored
 * for `rescore`. All criteria live in score.json (config, not code). Pure and deterministic.
 */

type At = KeyPosition | 'swing';
type Mode = 'abs' | 'min' | 'max';

interface CriterionConfig {
  metric: MetricId;
  at: At;
  mode: Mode;
  /** number, or 'shotTypeTempo' = SHOT_TYPES[shot].tempo.target */
  target: number | 'shotTypeTempo';
  tolerance: number;
  /** measurement-error floor: number, or 'tempoFrames' = target × (1000 / fps) / downswing_ms */
  floor?: number | 'tempoFrames';
  review: string;
}
interface PartConfig {
  id: SwingScorePartId;
  weight: number;
  criteria: CriterionConfig[];
}
export interface ScoreConfig {
  version: string;
  shotTypes: string[];
  minCoverage: number;
  defaultLevel: ScoreLevel;
  levels: { level: ScoreLevel; maxHandicap: number; factor: number }[];
  parts: PartConfig[];
}

export const SCORE_CONFIG = scoreJson as unknown as ScoreConfig;
export const SCORE_VERSION = SCORE_CONFIG.version;

export interface ScoreOptions {
  /** effective fps of the analysed video – needed for the tempo measurement floor */
  fps?: number;
  /** player level 1..5 (default: config default level 3) */
  level?: ScoreLevel;
  /** personal targets (later: TPI mobility), key "metric@at", e.g. { 'shoulder_turn@top': 70 } – never used for tourTotal */
  personalTargets?: Record<string, number>;
  /** overall analysis quality; below QUALITY_MIN no score (reason 'quality') */
  quality?: number;
}

// ------------------------------------------------------------------ pure helpers

/** Point curve (continuous): d ≤ T → 100, T..2T → 100→50, 2T..3T → 50→0, > 3T → 0. */
export function pointsFor(d: number, T: number): number {
  if (!(T > 0)) return d <= 0 ? 100 : 0;
  if (d <= T) return 100;
  return Math.max(0, 100 - (50 * (d - T)) / T);
}

/** Deviation from the target; one-sided targets ('min' = at least, 'max' = at most) count only the short side. */
export function deviation(mode: Mode, value: number, target: number): number {
  if (mode === 'min') return Math.max(0, target - value);
  if (mode === 'max') return Math.max(0, value - target);
  return Math.abs(value - target);
}

export function statusFor(d: number, T: number): Exclude<ScoreStatus, 'not_measured'> {
  return d <= T ? 'green' : d <= 2 * T ? 'yellow' : 'red';
}

export type ScoreColor = 'green' | 'yellow' | 'red' | 'grey';
/** Colour of a (part) score: green ≥ 80, yellow 50–79, red < 50, grey = not measured. */
export function scoreColor(score: number | null | undefined): ScoreColor {
  if (score === null || score === undefined || !Number.isFinite(score)) return 'grey';
  return score >= 80 ? 'green' : score >= 50 ? 'yellow' : 'red';
}

/** Handicap → level (≤ 4.0 incl. plus handicaps → 1, ≤ 12 → 2, ≤ 20 → 3, ≤ 36 → 4, else 5). Unknown → default level 3. */
export function levelFromHandicap(handicap: number | null | undefined): ScoreLevel {
  if (handicap === null || handicap === undefined || !Number.isFinite(handicap)) return SCORE_CONFIG.defaultLevel;
  for (const l of SCORE_CONFIG.levels) if (handicap <= l.maxHandicap) return l.level;
  return 5;
}

/** Level from the settings: explicit choice wins, otherwise derived from the handicap. */
export function levelFromSettings(s: Pick<Settings, 'handicap' | 'scoreLevel'> | undefined): ScoreLevel {
  if (s?.scoreLevel && s.scoreLevel !== 'auto') return s.scoreLevel;
  return levelFromHandicap(s?.handicap);
}

export function toleranceFactor(level: ScoreLevel): number {
  return SCORE_CONFIG.levels.find((l) => l.level === level)?.factor ?? 1;
}

/**
 * Weighted total of part scores with weight redistribution. Returns null when the measured weight share is below
 * minCoverage. (Concept example 70/85/60/80/90/95 → 77.)
 */
export function combineParts(
  parts: { score: number | null; weight: number }[],
  minCoverage = SCORE_CONFIG.minCoverage,
): { total: number | null; coverage: number } {
  const all = parts.reduce((s, p) => s + p.weight, 0);
  const measured = parts.filter((p) => p.score !== null);
  const w = measured.reduce((s, p) => s + p.weight, 0);
  const coverage = all > 0 ? round(w / all, 4) : 0;
  if (!measured.length || coverage + 1e-9 < minCoverage) return { total: null, coverage };
  const total = measured.reduce((s, p) => s + p.weight * (p.score as number), 0) / w;
  return { total: Math.round(total), coverage };
}

const round = (v: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

// ------------------------------------------------------------------ core

/** What is known about one criterion before scoring (from live metrics or from stored raw criteria). */
interface CriterionInput {
  available: boolean;
  measured: number | null;
  confidence: number;
  floor: number;
}

const keyOf = (c: { metric: MetricId; at: At }) => `${c.metric}@${c.at}`;

function targetOf(c: CriterionConfig, shot: AnalysisContext['shotType']): number {
  return c.target === 'shotTypeTempo' ? SHOT_TYPES[shot].tempo.target : c.target;
}

function scoreCriteria(
  input: (part: PartConfig, c: CriterionConfig) => CriterionInput,
  ctx: AnalysisContext,
  level: ScoreLevel,
  personalTargets: Record<string, number> | undefined,
): { parts: SwingScore['parts']; criteria: ScoreCriterion[] } {
  const factor = toleranceFactor(level);
  const criteria: ScoreCriterion[] = [];
  const parts: SwingScore['parts'] = [];
  for (const part of SCORE_CONFIG.parts) {
    const pts: number[] = [];
    for (const c of part.criteria) {
      const inp = input(part, c);
      const target = personalTargets?.[keyOf(c)] ?? targetOf(c, ctx.shotType);
      const tolerance = round(c.tolerance * factor, 6);
      const base: ScoreCriterion = {
        part: part.id,
        metric: c.metric,
        at: c.at,
        measured: inp.measured,
        target,
        tolerance,
        points: null,
        status: 'not_measured',
        baseTolerance: c.tolerance,
        mode: c.mode,
        floor: round(inp.floor, 6),
        confidence: inp.confidence,
      };
      if (!inp.available) base.reason = 'view';
      else if (inp.measured === null) base.reason = 'missing';
      else if (inp.confidence < QUALITY_MIN) base.reason = 'low_confidence';
      else if (inp.floor > tolerance) base.reason = 'below_measurement_floor';
      else {
        const d = deviation(c.mode, inp.measured, target);
        base.points = round(pointsFor(d, tolerance), 2);
        base.status = statusFor(d, tolerance);
        pts.push(base.points);
      }
      criteria.push(base);
    }
    parts.push({ id: part.id, weight: part.weight, score: pts.length ? Math.round(pts.reduce((a, b) => a + b, 0) / pts.length) : null });
  }
  return { parts, criteria };
}

function assemble(
  input: (part: PartConfig, c: CriterionConfig) => CriterionInput,
  ctx: AnalysisContext,
  opts: ScoreOptions,
): SwingScore {
  const level = opts.level ?? SCORE_CONFIG.defaultLevel;
  const base = { version: SCORE_VERSION, level, toleranceFactor: toleranceFactor(level) };
  if (!SCORE_CONFIG.shotTypes.includes(ctx.shotType)) {
    return {
      ...base,
      total: null,
      tourTotal: null,
      coverage: 0,
      noTotalReason: 'shot_type',
      parts: SCORE_CONFIG.parts.map((p) => ({ id: p.id, weight: p.weight, score: null })),
      criteria: [],
    };
  }
  const own = scoreCriteria(input, ctx, level, opts.personalTargets);
  const tour = scoreCriteria(input, ctx, 1, undefined);
  const ownTotal = combineParts(own.parts);
  const tourTotal = combineParts(tour.parts);
  const lowQuality = opts.quality !== undefined && opts.quality < QUALITY_MIN;
  return {
    ...base,
    total: lowQuality ? null : ownTotal.total,
    tourTotal: lowQuality ? null : tourTotal.total,
    coverage: ownTotal.coverage,
    ...(lowQuality ? { noTotalReason: 'quality' as const } : ownTotal.total === null ? { noTotalReason: 'coverage' as const } : {}),
    parts: own.parts,
    criteria: own.criteria,
  };
}

/**
 * Score 0..100 with six parts. Parts without data are null and their weight is redistributed (only when ≥ 80 % of the
 * weight is measured; otherwise total = null with reason 'coverage'). Only driver/iron get a score (reason 'shot_type').
 */
export function computeSwingScore(metrics: SwingMetrics, ctx: AnalysisContext, opts: ScoreOptions = {}): SwingScore | null {
  const find = (id: MetricId, at: At) => metrics.values.find((v) => v.id === id && v.at === at);
  const downswingMs = find('downswing_ms', 'swing');
  return assemble(
    (_part, c) => {
      const mv = find(c.metric, c.at);
      let floor = 0;
      if (typeof c.floor === 'number') floor = c.floor;
      else if (c.floor === 'tempoFrames') {
        floor =
          opts.fps && opts.fps > 0 && downswingMs && downswingMs.value > 0
            ? (targetOf(c, ctx.shotType) * (1000 / opts.fps)) / downswingMs.value
            : 0;
      }
      return {
        available: metricAvailable(c.metric, c.at, ctx.view, ctx.shotType),
        measured: mv && Number.isFinite(mv.value) ? mv.value : null,
        confidence: mv ? mv.confidence : 0,
        floor,
      };
    },
    ctx,
    opts,
  );
}

/**
 * Recompute a stored score with another level / personal targets / the current config version – only from the raw
 * criteria stored in the score (spec 4.5). Equal to a fresh computation with the same inputs.
 */
export function rescore(score: SwingScore, ctx: AnalysisContext, opts: Omit<ScoreOptions, 'fps'> = {}): SwingScore {
  const stored = new Map((score.criteria ?? []).map((c) => [`${c.part}|${keyOf(c)}`, c]));
  return assemble(
    (part, c) => {
      const s = stored.get(`${part.id}|${keyOf(c)}`);
      if (!s) return { available: metricAvailable(c.metric, c.at, ctx.view, ctx.shotType), measured: null, confidence: 0, floor: 0 };
      return {
        available: s.reason !== 'view',
        measured: s.measured,
        confidence: s.confidence ?? (s.reason === 'low_confidence' ? 0 : 1),
        floor: s.floor ?? 0,
      };
    },
    ctx,
    { ...opts, quality: score.noTotalReason === 'quality' ? 0 : opts.quality },
  );
}

/** Review notes of all score criteria (for the review list). */
export function scoreReviewNotes(): { part: SwingScorePartId; metric: MetricId; at: At; target: number | string; tolerance: number; review: string }[] {
  return SCORE_CONFIG.parts.flatMap((p) =>
    p.criteria.map((c) => ({ part: p.id, metric: c.metric, at: c.at, target: c.target, tolerance: c.tolerance, review: c.review })),
  );
}
