import type { Fault, FaultProgressRecord, ShotType, Swing } from '../model/types';

/** Minimal swing for storage/history tests (no real pose data needed). */
export function fakeSwing(id: string, over: Partial<Swing> = {}): Swing {
  return {
    id,
    sessionId: 'sess1',
    createdAt: 1_000,
    shotType: 'iron',
    view: 'down_the_line',
    handedness: 'right',
    source: 'live',
    durationMs: 2000,
    pose: { width: 720, height: 1280, fps: 30, frames: [{ t: 0, lm: null }], mirrored: false },
    club: [null],
    neutralLine: null,
    keyframes: [],
    metrics: { values: [] },
    quality: { score: 0.9, detectedFrameRatio: 1, meanVisibility: 0.9, fps: 30, issues: [] },
    faults: [],
    checkedFaultIds: [],
    uncertainFaultIds: [],
    score: null,
    ...over,
  };
}

export function fakeFault(defId: string, severity = 0.5): Fault {
  return { defId, severity, priority: severity, confidence: 0.9, marker: 'impact', frameIndex: 0, measured: [] };
}

/** Progress rows for a sequence of swings: pattern string, "x" = detected, "." = checked and clean. */
export function rowsFromPattern(faultId: string, pattern: string, shotType: ShotType = 'iron', t0 = 0): FaultProgressRecord[] {
  return [...pattern].map((c, i) => ({
    id: `s${i}:${faultId}`,
    faultId,
    swingId: `s${i}`,
    ts: t0 + i * 1000,
    shotType,
    view: 'down_the_line',
    detected: c === 'x',
    severity: c === 'x' ? 0.6 : 0,
    confidence: 0.9,
  }));
}
