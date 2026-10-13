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
