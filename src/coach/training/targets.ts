import { t } from '../i18n/i18n';
import type {
  CameraView,
  FaultDef,
  KeyPosition,
  Landmark,
  Localized,
  MetricId,
  ShotType,
  Swing,
  TargetCriterion,
  TrainingTarget,
} from '../model/types';
import { newId } from '../storage/save';
import { getStore } from '../storage';
import { DEFAULT_TOLERANCE, MAX_REFERENCE_CRITERIA, TRAINABLE_METRICS, unitOf } from './metricInfo';
import { modelGhost } from './modelGhost';
import templatesJson from './templates.json';

/**
 * Training targets (US-1.9/1.10): one position + 1..3 measurable criteria (+ optional ghost pose).
 * Three sources: (a) a correction of the fault catalog (FaultDef.trainingTarget), (b) the player's own reference swing,
 * (c) templates (templates.json, every criterion carries a REVIEW(golf) note).
 */

// ------------------------------------------------------------------ templates

export interface TemplateCriterion {
  metric: MetricId;
  at: KeyPosition | 'swing';
  target: number;
  tolerance: number;
  review: string;
}
export interface TargetTemplate {
  id: string;
  label: Localized;
  shotType: ShotType;
  view: CameraView;
  position: KeyPosition;
  criteria: TemplateCriterion[];
}

export const TEMPLATES: TargetTemplate[] = templatesJson as TargetTemplate[];

function criterion(metric: MetricId, at: KeyPosition | 'swing', target: number, tolerance: number): TargetCriterion {
  return { metric, at, target, tolerance, unit: unitOf(metric) };
}

/** Target from a template. The ghost is the synthetic "model swing" at that position (testing/synth.ts). */
export function targetFromTemplate(tpl: TargetTemplate, opts: { shotType?: ShotType; withGhost?: boolean } = {}): TrainingTarget {
  const shotType = opts.shotType ?? tpl.shotType;
  return {
    id: tpl.id,
    label: tpl.label,
    source: 'template',
    sourceId: tpl.id,
    shotType,
    view: tpl.view,
    position: tpl.position,
    criteria: tpl.criteria.map((c) => criterion(c.metric, c.at, c.target, c.tolerance)),
    ghost: opts.withGhost === false ? undefined : (synthGhost(shotType, tpl.view, tpl.position) ?? undefined),
  };
}

// ------------------------------------------------------------------ from a correction (fault catalog)

/** Faults whose correction can be trained (they carry a trainingTarget). */
export function trainableFaults(faults: FaultDef[]): FaultDef[] {
  return faults.filter((f) => !!f.trainingTarget);
}

/**
 * Target from a correction. Position = trainingTarget.at, or the fault's marker position for whole-swing values
 * (tempo, chicken wing, putting) – those can only be judged in the ball series, not in the mirror.
 */
export function targetFromFault(def: FaultDef, opts: { shotType?: ShotType; view?: CameraView; withGhost?: boolean } = {}): TrainingTarget | null {
  const tt = def.trainingTarget;
  if (!tt) return null;
  const view = opts.view && def.views.includes(opts.view) ? opts.view : def.views[0];
  const shotType = opts.shotType && def.shotTypes.includes(opts.shotType) ? opts.shotType : def.shotTypes[0];
  const position: KeyPosition = tt.at === 'swing' ? def.marker : tt.at;
  return {
    id: `fault_${def.id}`,
    label: def.name,
    source: 'correction',
    sourceId: def.id,
    shotType,
    view,
    position,
    criteria: [criterion(tt.metric, tt.at, tt.target, tt.tolerance)],
    ghost: opts.withGhost === false ? undefined : (synthGhost(shotType, view, position) ?? undefined),
  };
}

// ------------------------------------------------------------------ from the player's own swing

/** Key positions of a swing that have a frame with a detected pose. */
export function referencePositions(swing: Swing): KeyPosition[] {
  return swing.keyframes.filter((k) => !!swing.pose.frames[k.frameIndex]?.lm).map((k) => k.position);
}

/** Values of a swing at a position that are worth training (trainable, confident enough), best first. */
export function referenceCandidates(swing: Swing, position: KeyPosition, minConfidence = 0.5): TargetCriterion[] {
  const out: TargetCriterion[] = [];
  for (const id of TRAINABLE_METRICS) {
    const v = swing.metrics.values.find((m) => m.id === id && m.at === position);
    if (!v || !Number.isFinite(v.value) || v.confidence < minConfidence) continue;
    out.push(criterion(id, position, round1(v.value), DEFAULT_TOLERANCE[id] ?? 10));
  }
  return out;
}

/**
 * "Hit this position of my good swing again": the position, the metrics measured there (default: the first
 * MAX_REFERENCE_CRITERIA trainable ones, or the ones given) and the pose of that frame as ghost.
 * Returns null when the position was not found in the swing.
 */
export function targetFromReference(swing: Swing, position: KeyPosition, metrics?: MetricId[]): TrainingTarget | null {
  const kf = swing.keyframes.find((k) => k.position === position);
  if (!kf) return null;
  const all = referenceCandidates(swing, position);
  const criteria = metrics ? all.filter((c) => metrics.includes(c.metric)) : all.slice(0, MAX_REFERENCE_CRITERIA);
  const ghost = swing.pose.frames[kf.frameIndex]?.lm ?? undefined;
  const date = new Date(swing.createdAt);
  const day = `${date.getDate()}.${date.getMonth() + 1}.`;
  return {
    id: newId('tgt'),
    label: {
      en: `${t(`common.pos.${position}`, undefined, 'en')} – my swing ${day}`,
      de: `${t(`common.pos.${position}`, undefined, 'de')} – mein Schwung ${day}`,
    },
    source: 'reference',
    sourceId: swing.id,
    shotType: swing.shotType,
    view: swing.view,
    position,
    criteria,
    // canonical already (analysis output) – copied so later edits of the swing do not change the target
    ghost: ghost ? ghost.map((p) => ({ ...p })) : undefined,
  };
}

// ------------------------------------------------------------------ helpers

/** Ghost from the model swing (canonical landmarks, precomputed in ghosts.json), null when the shot has no such position. */
export function synthGhost(shotType: ShotType, view: CameraView, position: KeyPosition): Landmark[] | null {
  return modelGhost(shotType, view, position);
}

/** Can the mirror mode judge this target? (Needs at least one criterion at the trained position.) */
export function supportsMirror(target: TrainingTarget): boolean {
  return target.criteria.some((c) => c.at === target.position);
}

/** Copy of a target with all tolerances multiplied (per-target "tighter / looser"). */
export function scaleTolerances(target: TrainingTarget, factor: number): TrainingTarget {
  return { ...target, criteria: target.criteria.map((c) => ({ ...c, tolerance: round2(c.tolerance * factor) })) };
}

/** Change one criterion's tolerance (UI − / + buttons). */
export function withTolerance(target: TrainingTarget, index: number, tolerance: number): TrainingTarget {
  return { ...target, criteria: target.criteria.map((c, i) => (i === index ? { ...c, tolerance: Math.max(0.01, round2(tolerance)) } : c)) };
}

export async function saveTarget(target: TrainingTarget): Promise<void> {
  const store = await getStore();
  await store.saveTarget(target);
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
