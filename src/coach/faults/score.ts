import type { SwingMetrics, SwingScore } from '../model/types';
import type { AnalysisContext } from '../analysis/context';

/**
 * OWNER: agent "faults" (work package D, Swing-Score concept 08.10.2026).
 * Score 0..100 with six parts; parts without data are null and their weight is redistributed.
 */
export function computeSwingScore(_metrics: SwingMetrics, _ctx: AnalysisContext): SwingScore | null {
  return null; // TODO(faults)
}
