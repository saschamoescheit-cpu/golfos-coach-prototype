import { ALL_POSITIONS, MAX_FAULTS_SHOWN, QUALITY_MIN, SKELETON } from '../model/constants';
import type {
  AnalysisQuality,
  Correction,
  Fault,
  FaultDef,
  FaultRule,
  KeyPosition,
  MetricId,
  MetricValue,
  PhaseKeyframe,
  Swing,
  SwingMetrics,
} from '../model/types';
import type { AnalysisContext } from '../analysis/context';
import { FAULTS, getFaultDef } from './catalog';
import { metricAvailable } from './metricContract';

export { FAULTS, DRILLS, BALL_FLIGHTS, getFaultDef, getDrill, getBallFlight, drillsFor } from './catalog';

export interface FaultEvaluation {
  /** all detected faults, sorted by priority (highest first) */
  faults: Fault[];
  /** fault ids that apply to shot/view and could be checked */
  checked: string[];
  /** fault ids that apply but could not be checked reliably (missing/uncertain metrics) */
  uncertain: string[];
}

type At = KeyPosition | 'swing';

/** Outcome of one rule: 'na' = metric does not exist in this view/shot (02_METRICS.md) → rule ignored. */
export interface RuleResult {
  rule: FaultRule;
  state: 'hit' | 'ok' | 'unknown' | 'na';
  value?: number;
  confidence: number;
  /** 0..1 – only for 'hit' */
  severity: number;
}

function findMetric(m: SwingMetrics, id: MetricId, at: At): MetricValue | undefined {
  return m.values.find((v) => v.id === id && v.at === at);
}

/** Distance of a value beyond the rule threshold (> 0 = rule is true). */
export function ruleExcess(rule: FaultRule, v: number): number {
  switch (rule.op) {
    case '>':
      return v - rule.threshold;
    case '<':
      return rule.threshold - v;
    case 'abs>':
      return Math.abs(v) - rule.threshold;
    case 'outside': {
      const hi = rule.thresholdHigh ?? rule.threshold;
      return v < rule.threshold ? rule.threshold - v : v > hi ? v - hi : -1;
    }
  }
}

export function evaluateRule(rule: FaultRule, metrics: SwingMetrics, ctx: AnalysisContext): RuleResult {
  if (!metricAvailable(rule.metric, rule.at, ctx.view, ctx.shotType)) return { rule, state: 'na', confidence: 0, severity: 0 };
  const mv = findMetric(metrics, rule.metric, rule.at);
  if (!mv || !Number.isFinite(mv.value)) return { rule, state: 'unknown', confidence: 0, severity: 0 };
  if (mv.confidence < (rule.minConfidence ?? QUALITY_MIN))
    return { rule, state: 'unknown', value: mv.value, confidence: mv.confidence, severity: 0 };
  const excess = ruleExcess(rule, mv.value);
  if (excess <= 0) return { rule, state: 'ok', value: mv.value, confidence: mv.confidence, severity: 0 };
  const severity = Math.min(1, Math.max(0.01, excess / Math.max(1e-9, rule.fullSeverityAt)));
  return { rule, state: 'hit', value: mv.value, confidence: mv.confidence, severity };
}

/** Faults of the catalog that apply to this shot type and view (and have at least one rule that exists there). */
export function applicableFaults(ctx: AnalysisContext, catalog: FaultDef[] = FAULTS): FaultDef[] {
  return catalog.filter(
    (f) =>
      f.shotTypes.includes(ctx.shotType) &&
      f.views.includes(ctx.view) &&
      f.rules.some((r) => metricAvailable(r.metric, r.at, ctx.view, ctx.shotType)),
  );
}

/** Frame index of a key position; falls back to the nearest detected position, then 0. */
export function frameOf(keyframes: PhaseKeyframe[], pos: KeyPosition): number {
  const exact = keyframes.find((k) => k.position === pos);
  if (exact) return exact.frameIndex;
  const order = ALL_POSITIONS.indexOf(pos);
  let best: PhaseKeyframe | undefined;
  for (const k of keyframes) {
    if (!best || Math.abs(ALL_POSITIONS.indexOf(k.position) - order) < Math.abs(ALL_POSITIONS.indexOf(best.position) - order)) best = k;
  }
  return best?.frameIndex ?? 0;
}

type FaultOutcome = { kind: 'detected'; fault: Fault } | { kind: 'clear' } | { kind: 'uncertain' } | { kind: 'na' };

export function evaluateFault(def: FaultDef, metrics: SwingMetrics, keyframes: PhaseKeyframe[], ctx: AnalysisContext): FaultOutcome {
  const results = def.rules.map((r) => evaluateRule(r, metrics, ctx)).filter((r) => r.state !== 'na');
  if (!results.length) return { kind: 'na' };
  const hits = results.filter((r) => r.state === 'hit');
  const unknown = results.some((r) => r.state === 'unknown');
  let detected = false;
  let severity = 0;
  let confidence = 0;
  if (def.match === 'any') {
    if (hits.length) {
      detected = true;
      const top = hits.reduce((a, b) => (b.severity * b.confidence > a.severity * a.confidence ? b : a));
      severity = top.severity;
      confidence = top.confidence;
    } else if (unknown) return { kind: 'uncertain' };
  } else {
    if (results.some((r) => r.state === 'ok')) return { kind: 'clear' };
    if (unknown) return { kind: 'uncertain' };
    detected = true;
    severity = hits.reduce((s, r) => s + r.severity, 0) / hits.length;
    confidence = Math.min(...hits.map((r) => r.confidence));
  }
  if (!detected) return { kind: 'clear' };
  const fault: Fault = {
    defId: def.id,
    severity: round3(severity),
    confidence: round3(confidence),
    priority: round3(severity * def.importance * confidence),
    marker: def.marker,
    frameIndex: frameOf(keyframes, def.marker),
    measured: results
      .filter((r) => r.value !== undefined)
      .map((r) => ({ metric: r.rule.metric, at: r.rule.at, value: r.value!, threshold: r.rule.threshold })),
  };
  return { kind: 'detected', fault };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * OWNER: agent "faults" (work package D).
 * Apply the fault catalog (faults/catalog.json) to the metrics. Faults are only checked for matching shot type and view.
 * Missing or low-confidence metrics make a fault "uncertain" – never "fine".
 * With quality below QUALITY_MIN nothing is diagnosed (everything goes to `uncertain`).
 */
export function evaluateFaults(
  metrics: SwingMetrics,
  keyframes: PhaseKeyframe[],
  quality: AnalysisQuality,
  ctx: AnalysisContext,
  catalog: FaultDef[] = FAULTS,
): FaultEvaluation {
  const defs = applicableFaults(ctx, catalog);
  if (quality.score < QUALITY_MIN) return { faults: [], checked: [], uncertain: defs.map((d) => d.id) };
  const faults: Fault[] = [];
  const checked: string[] = [];
  const uncertain: string[] = [];
  for (const def of defs) {
    const o = evaluateFault(def, metrics, keyframes, ctx);
    if (o.kind === 'detected') {
      faults.push(o.fault);
      checked.push(def.id);
    } else if (o.kind === 'clear') checked.push(def.id);
    else if (o.kind === 'uncertain') uncertain.push(def.id);
  }
  faults.sort((a, b) => b.priority - a.priority || a.defId.localeCompare(b.defId));
  return { faults, checked, uncertain };
}

/** The faults shown to the player after a swing (brief D: max 3, highest priority first). */
export function topFaults(faults: Fault[], n: number = MAX_FAULTS_SHOWN): Fault[] {
  return [...faults].sort((a, b) => b.priority - a.priority || a.defId.localeCompare(b.defId)).slice(0, n);
}

/** Correction card content of a fault (US-1.4: deviation → correction → benefit). */
export function correctionFor(fault: Fault | string): Correction | undefined {
  const id = typeof fault === 'string' ? fault : fault.defId;
  const def = getFaultDef(id);
  if (!def) return undefined;
  return { faultId: id, text: def.correction, benefit: def.benefit, drillIds: def.drillIds };
}

export type ValueStatus = 'ok' | 'bad' | 'info' | 'uncertain';

/**
 * Status of every measured value for the "all measured values" list: bad = beyond the threshold of a detected fault,
 * ok = checked by a fault rule and within tolerance, info = display only, uncertain = low confidence.
 */
export function classifyValues(swing: Pick<Swing, 'metrics' | 'faults' | 'shotType' | 'view'>): { value: MetricValue; status: ValueStatus }[] {
  const ctx = { shotType: swing.shotType, view: swing.view, handedness: 'right' as const };
  const ruled = new Set(applicableFaults(ctx).flatMap((f) => f.rules.map((r) => `${r.metric}@${r.at}`)));
  const bad = new Set<string>();
  for (const f of swing.faults) {
    const def = getFaultDef(f.defId);
    for (const m of f.measured) {
      const rule = def?.rules.find((r) => r.metric === m.metric && r.at === m.at);
      if (rule && ruleExcess(rule, m.value) > 0) bad.add(`${m.metric}@${m.at}`);
    }
  }
  return swing.metrics.values.map((value) => {
    const k = `${value.id}@${value.at}`;
    const status: ValueStatus = bad.has(k) ? 'bad' : value.confidence < QUALITY_MIN ? 'uncertain' : ruled.has(k) ? 'ok' : 'info';
    return { value, status };
  });
}

// ------------------------------------------------------------------ skeleton colours (US-1.3)

const TORSO = ['11-23', '12-24'];
const SHOULDERS = ['11-12'];
const HIPS = ['23-24', '23-25', '24-26'];
const LEAD_ARM = ['11-13', '13-15'];
const TRAIL_ARM = ['12-14', '14-16'];
const FOREARMS = ['13-15', '14-16'];
const TRAIL_LEG = ['24-26', '26-28'];
const LOWER_LEGS = ['25-27', '26-28'];

/** Which skeleton lines (keys "a-b" as in SKELETON) show a metric. Metrics without a body line (tempo) map to none. */
export const METRIC_LINES: Partial<Record<MetricId, string[]>> = {
  spine_angle: TORSO,
  spine_angle_change: TORSO,
  side_bend: TORSO,
  hip_depth_change: HIPS,
  hip_shift_x: HIPS,
  hip_turn: HIPS,
  head_shift_x: [...SHOULDERS, ...TORSO],
  head_shift_y: [...SHOULDERS, ...TORSO],
  shoulder_turn: SHOULDERS,
  x_factor: SHOULDERS,
  body_motion: [...SHOULDERS, ...TORSO],
  lead_arm_angle: LEAD_ARM,
  lead_arm_post_impact: LEAD_ARM,
  trail_arm_angle: TRAIL_ARM,
  lead_wrist_hinge: FOREARMS,
  hands_ahead: FOREARMS,
  shaft_lean: FOREARMS,
  shaft_plane_dev: FOREARMS,
  hand_path_shift: FOREARMS,
  hand_depth: FOREARMS,
  putter_wrist_change: FOREARMS,
  swing_length: LEAD_ARM,
  knee_flex: TRAIL_LEG,
  stance_width: LOWER_LEGS,
};

const SKELETON_KEYS = new Set(SKELETON.map(([a, b]) => `${a}-${b}`));

/** Frame window [from, to] in which a value measured at `at` is shown (half-way to the neighbouring key positions). */
export function phaseWindow(keyframes: PhaseKeyframe[], at: At, frameCount: number): [number, number] {
  const last = Math.max(0, frameCount - 1);
  if (at === 'swing') return [0, last];
  const ks = [...keyframes].sort((a, b) => a.frameIndex - b.frameIndex);
  const i = ks.findIndex((k) => k.position === at);
  if (i < 0) return [-1, -2];
  const f = ks[i].frameIndex;
  const from = i > 0 ? Math.ceil((ks[i - 1].frameIndex + f) / 2) : 0;
  const to = i < ks.length - 1 ? Math.floor((f + ks[i + 1].frameIndex) / 2) : last;
  return [from, to];
}

export type LineStatusValue = 'ok' | 'bad' | 'neutral';

/**
 * Colour of every skeleton line in one frame (US-1.3): red while a detected fault's phase is shown,
 * green where something was measured reliably and is within tolerance, neutral otherwise.
 */
export function skeletonStatus(swing: Swing, frameIndex: number): Record<string, LineStatusValue> {
  const out: Record<string, LineStatusValue> = {};
  const n = swing.pose.frames.length;
  const inWin = (at: At) => {
    const [a, b] = phaseWindow(swing.keyframes, at, n);
    return frameIndex >= a && frameIndex <= b;
  };
  for (const v of swing.metrics.values) {
    if (v.confidence < QUALITY_MIN || !inWin(v.at)) continue;
    for (const k of METRIC_LINES[v.id] ?? []) if (SKELETON_KEYS.has(k) && !out[k]) out[k] = 'ok';
  }
  for (const f of swing.faults) {
    const def = getFaultDef(f.defId);
    if (!def) continue;
    for (const m of f.measured) {
      const rule = def.rules.find((r) => r.metric === m.metric && r.at === m.at);
      if (!rule || ruleExcess(rule, m.value) <= 0 || !inWin(m.at)) continue;
      for (const k of METRIC_LINES[m.metric] ?? []) if (SKELETON_KEYS.has(k)) out[k] = 'bad';
    }
  }
  return out;
}
