import type { FaultProgressRecord, ShotType, Swing } from '../model/types';

/**
 * Progress rows for one analysed swing: one row per checked fault (detected or not). Faults that could not be checked
 * reliably produce no row – "unknown" must not count as "fixed". Raw material for the later development curve ("Elo").
 */
export function progressRecordsFor(swing: Swing): FaultProgressRecord[] {
  return swing.checkedFaultIds.map((faultId) => {
    const f = swing.faults.find((x) => x.defId === faultId);
    return {
      id: `${swing.id}:${faultId}`,
      faultId,
      swingId: swing.id,
      ts: swing.createdAt,
      shotType: swing.shotType,
      view: swing.view,
      detected: !!f,
      severity: f?.severity ?? 0,
      confidence: f?.confidence ?? 1,
    };
  });
}

// ---------------------------------------------------------------- aggregation (work package F)

/** Window for "the last N swings" in the history screen. */
export const PROGRESS_WINDOW = 10;
/** Fewer checked swings than this in a window → no trend statement ("not enough swings yet"). */
export const PROGRESS_MIN_SWINGS = 3;
/**
 * Minimum change of the detection rate between the two windows to call it a trend (0.2 = 2 of 10 swings).
 * Statistics, not golf: with 10 swings a difference of one swing is noise.
 */
export const TREND_MIN_DELTA = 0.2;

export interface ProgressPoint {
  ts: number;
  swingId: string;
  shotType: ShotType;
  detected: boolean;
  severity: number;
  /** share of swings with the fault among the last `window` checked swings up to and including this one */
  rollingRate: number;
}

export type Trend = 'improving' | 'worse' | 'same' | 'unknown';

export interface WindowCount {
  /** swings in which the fault was detected */
  detected: number;
  /** checked swings in the window */
  total: number;
}

export interface FaultProgress {
  faultId: string;
  /** oldest first */
  points: ProgressPoint[];
  /** the last `window` checked swings */
  recent: WindowCount;
  /** the `window` checked swings before those (null when there are none) */
  previous: WindowCount | null;
  trend: Trend;
  /** mean severity of the detected swings in the recent window (0 when none) */
  recentSeverity: number;
  lastTs: number;
}

/** One time series per fault, oldest first. One row per swing (a duplicate row for the same swing keeps the last). */
export function faultSeries(records: FaultProgressRecord[], faultId: string, window = PROGRESS_WINDOW): ProgressPoint[] {
  const bySwing = new Map<string, FaultProgressRecord>();
  for (const r of records) if (r.faultId === faultId) bySwing.set(r.swingId, r);
  const rows = [...bySwing.values()].sort((a, b) => a.ts - b.ts);
  return rows.map((r, i) => {
    const from = Math.max(0, i - window + 1);
    const slice = rows.slice(from, i + 1);
    return {
      ts: r.ts,
      swingId: r.swingId,
      shotType: r.shotType,
      detected: r.detected,
      severity: r.detected ? r.severity : 0,
      rollingRate: slice.filter((x) => x.detected).length / slice.length,
    };
  });
}

function count(points: ProgressPoint[]): WindowCount {
  return { detected: points.filter((p) => p.detected).length, total: points.length };
}

/**
 * Trend of a fault: detection rate of the last `window` swings vs. the `window` swings before.
 * improving = the fault shows up clearly less often, worse = clearly more often.
 */
export function faultProgress(records: FaultProgressRecord[], faultId: string, window = PROGRESS_WINDOW): FaultProgress {
  const points = faultSeries(records, faultId, window);
  const recentPts = points.slice(-window);
  const prevPts = points.slice(-2 * window, -window);
  const recent = count(recentPts);
  const previous = prevPts.length ? count(prevPts) : null;
  let trend: Trend = 'unknown';
  if (previous && recent.total >= PROGRESS_MIN_SWINGS && previous.total >= PROGRESS_MIN_SWINGS) {
    const delta = recent.detected / recent.total - previous.detected / previous.total;
    trend = delta <= -TREND_MIN_DELTA ? 'improving' : delta >= TREND_MIN_DELTA ? 'worse' : 'same';
  }
  const det = recentPts.filter((p) => p.detected);
  return {
    faultId,
    points,
    recent,
    previous,
    trend,
    recentSeverity: det.length ? det.reduce((s, p) => s + p.severity, 0) / det.length : 0,
    lastTs: points.length ? points[points.length - 1].ts : 0,
  };
}

/**
 * Progress of every fault that was detected at least once (faults that never showed up are not interesting in the
 * list). Optional shot-type filter. Order: most frequent in the recent window first, then most recent.
 */
export function progressOverview(
  records: FaultProgressRecord[],
  opts: { shotType?: ShotType; window?: number } = {},
): FaultProgress[] {
  const rows = opts.shotType ? records.filter((r) => r.shotType === opts.shotType) : records;
  const ids = [...new Set(rows.filter((r) => r.detected).map((r) => r.faultId))];
  return ids
    .map((id) => faultProgress(rows, id, opts.window))
    .sort((a, b) => b.recent.detected / Math.max(1, b.recent.total) - a.recent.detected / Math.max(1, a.recent.total) || b.lastTs - a.lastTs);
}
