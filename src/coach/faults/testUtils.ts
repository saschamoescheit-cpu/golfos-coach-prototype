import type { AnalysisQuality, KeyPosition, MetricId, MetricUnit, MetricValue, PhaseKeyframe, SwingMetrics } from '../model/types';

/** Test helpers: hand-built metrics, keyframes and quality (no pose pipeline needed). */
export function mv(id: MetricId, at: KeyPosition | 'swing', value: number, confidence = 0.9, unit: MetricUnit = 'deg'): MetricValue {
  return { id, at, value, unit, confidence };
}
export function metrics(...values: MetricValue[]): SwingMetrics {
  return { values };
}
export function keyframes(frames: Partial<Record<KeyPosition, number>> = { address: 0, backswing9: 20, top: 40, downswing9: 50, impact: 56, finish: 80 }): PhaseKeyframe[] {
  return Object.entries(frames).map(([position, frameIndex]) => ({
    position: position as KeyPosition,
    frameIndex: frameIndex!,
    t: frameIndex! * 16.7,
    confidence: 0.9,
    method: 'test',
  }));
}
export function quality(score = 0.9): AnalysisQuality {
  return { score, detectedFrameRatio: 1, meanVisibility: 0.9, fps: 60, issues: [] };
}
