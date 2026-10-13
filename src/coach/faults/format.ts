import { num, t } from '../i18n/i18n';
import type { KeyPosition, MetricId, MetricUnit } from '../model/types';

/** Display helpers for measured values (shared by analysis, diagnose and training screens). */
export const UNIT_OF: Partial<Record<MetricId, MetricUnit>> = {
  tempo_ratio: 'ratio',
  stance_width: 'ratio',
  backswing_ms: 'ms',
  downswing_ms: 'ms',
  head_shift_x: 'pct_torso',
  head_shift_y: 'pct_torso',
  hip_shift_x: 'pct_torso',
  hip_depth_change: 'pct_torso',
  hand_height: 'pct_torso',
  hand_depth: 'pct_torso',
  hands_ahead: 'pct_torso',
  body_motion: 'pct_torso',
  hand_path_shift: 'pct_torso',
};

export function unitOf(metric: MetricId): MetricUnit {
  return UNIT_OF[metric] ?? 'deg';
}

export function formatValue(v: number, unit: MetricUnit): string {
  const digits = unit === 'ratio' ? 1 : 0;
  if (unit === 'ratio' && Math.abs(v) < 10) return `${num(v, digits)}${t('analysis.unit.ratio')}`;
  return `${num(v, digits)}${t(`analysis.unit.${unit}`)}`;
}

export function metricName(metric: MetricId): string {
  return t(`analysis.metric.${metric}`);
}

export function positionName(at: KeyPosition | 'swing'): string {
  return at === 'swing' ? t('analysis.atSwing') : t(`common.pos.${at}`);
}

/**
 * Target of a training criterion as text: "64° ± 8°" (two-sided) or "≥ 70°" / "≤ 4 %" for one-sided criteria
 * (mode 'min'/'max'), where the shown border already includes the tolerance – that is where the hit starts.
 */
export function criterionText(
  c: { target: number; tolerance: number; unit: MetricUnit; mode?: 'abs' | 'min' | 'max' },
  toleranceScale = 1,
): string {
  const tol = c.tolerance * (toleranceScale > 0 ? toleranceScale : 1);
  if (c.mode === 'min') return `≥ ${formatValue(c.target - tol, c.unit)}`;
  if (c.mode === 'max') return `≤ ${formatValue(c.target + tol, c.unit)}`;
  return `${formatValue(c.target, c.unit)} ± ${num(tol, c.unit === 'ratio' ? 1 : 0)}`;
}
