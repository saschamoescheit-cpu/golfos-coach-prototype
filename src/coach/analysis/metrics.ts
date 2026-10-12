import type { ClubEstimate, KeyPosition, Line2, MetricId, MetricValue, PhaseKeyframe, PoseSequence, SwingMetrics } from '../model/types';
import type { AnalysisContext } from './context';

/**
 * OWNER: agent "phases-metrics" (work package C).
 * Compute all metrics that make sense for ctx.view / ctx.shotType at the detected key positions.
 */
export function computeMetrics(
  _seq: PoseSequence,
  _club: (ClubEstimate | null)[],
  _keyframes: PhaseKeyframe[],
  _neutralLine: Line2 | null,
  _ctx: AnalysisContext,
): SwingMetrics {
  return { values: [] }; // TODO(phases-metrics)
}

/**
 * Metrics of ONE frame against the address frame – used live by the training mode (mirror mode, series).
 * Same definitions/units as computeMetrics. `at` is the position the frame stands for.
 */
export function metricsAtFrame(
  _seq: PoseSequence,
  _frameIndex: number,
  _addressIndex: number,
  _at: KeyPosition,
  _club: (ClubEstimate | null)[],
  _neutralLine: Line2 | null,
  _ctx: AnalysisContext,
): MetricValue[] {
  return []; // TODO(phases-metrics)
}

/** Convenience lookup. */
export function getMetric(m: SwingMetrics, id: MetricId, at: KeyPosition | 'swing'): MetricValue | undefined {
  return m.values.find((v) => v.id === id && v.at === at);
}
