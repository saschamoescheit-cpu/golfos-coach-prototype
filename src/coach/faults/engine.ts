import type { AnalysisQuality, Fault, PhaseKeyframe, SwingMetrics } from '../model/types';
import type { AnalysisContext } from '../analysis/context';

export interface FaultEvaluation {
  /** all detected faults, sorted by priority (highest first) */
  faults: Fault[];
  /** fault ids that apply to shot/view and could be checked */
  checked: string[];
  /** fault ids that apply but could not be checked reliably (missing/uncertain metrics) */
  uncertain: string[];
}

/**
 * OWNER: agent "faults" (work package D).
 * Apply the fault catalog (faults/catalog.json) to the metrics. Faults are only checked for matching shot type and view.
 * With quality below QUALITY_MIN nothing is diagnosed (everything goes to `uncertain`).
 */
export function evaluateFaults(
  _metrics: SwingMetrics,
  _keyframes: PhaseKeyframe[],
  _quality: AnalysisQuality,
  _ctx: AnalysisContext,
): FaultEvaluation {
  return { faults: [], checked: [], uncertain: [] }; // TODO(faults)
}
