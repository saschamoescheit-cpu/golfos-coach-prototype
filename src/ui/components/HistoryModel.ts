import { getFaultDef, topFaults } from '../../coach/faults/engine';
import { getLang, loc, t } from '../../coach/i18n/i18n';
import { ALL_SHOT_TYPES } from '../../coach/model/constants';
import type { Fault, KeyPosition, Lang, MetricId, MetricUnit, ShotType, Swing } from '../../coach/model/types';
import type { FaultProgress } from '../../coach/storage/progress';

/** Pure helpers of the history / compare screens (testable in Node). */

/** Fault name in the player's language; unknown ids (catalog changed) are shown readable instead of as an id. */
export function faultName(id: string, lang: Lang = getLang()): string {
  const def = getFaultDef(id);
  if (def) return loc(def.name, lang);
  const s = id.replace(/[_-]+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function topFault(swing: Swing): Fault | undefined {
  return topFaults(swing.faults, 1)[0];
}

/**
 * Fault line of a swing: its top fault, "clean" only when faults were actually checked, otherwise "unsure"
 * (bad video – nothing could be judged). Same rule on Home, History and Compare (review W5).
 */
export function faultStatus(swing: Swing): { kind: 'fault'; fault: Fault } | { kind: 'clean' } | { kind: 'unsure' } {
  const fault = topFault(swing);
  if (fault) return { kind: 'fault', fault };
  return swing.checkedFaultIds.length > 0 ? { kind: 'clean' } : { kind: 'unsure' };
}

export interface ShotGroup {
  shotType: ShotType;
  swings: Swing[];
}

/** Swings grouped by shot type; groups ordered by their newest swing, swings newest first. */
export function groupByShotType(swings: Swing[]): ShotGroup[] {
  const groups = new Map<ShotType, Swing[]>();
  for (const s of [...swings].sort((a, b) => b.createdAt - a.createdAt)) {
    const g = groups.get(s.shotType) ?? [];
    g.push(s);
    groups.set(s.shotType, g);
  }
  return [...groups.entries()]
    .map(([shotType, list]) => ({ shotType, swings: list }))
    .sort((a, b) => b.swings[0].createdAt - a.swings[0].createdAt || ALL_SHOT_TYPES.indexOf(a.shotType) - ALL_SHOT_TYPES.indexOf(b.shotType));
}

/** Shot types that have swings, with counts, in the fixed order driver … putt. */
export function shotTypeCounts(swings: Swing[]): { shotType: ShotType; count: number }[] {
  return ALL_SHOT_TYPES.map((shotType) => ({ shotType, count: swings.filter((s) => s.shotType === shotType).length })).filter((x) => x.count > 0);
}

/** "Today 14:32" / "Yesterday 09:10" / "Oct 3, 14:32". */
export function formatWhen(ts: number, lang: Lang = getLang(), now = Date.now()): string {
  const d = new Date(ts);
  const locale = lang === 'de' ? 'de-DE' : 'en-US';
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const day = (x: number) => new Date(x).toDateString();
  if (day(ts) === day(now)) return `${t('history.today', undefined, lang)} ${time}`;
  if (day(ts) === day(now - 86_400_000)) return `${t('history.yesterday', undefined, lang)} ${time}`;
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const date = d.toLocaleDateString(locale, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
  return `${date}, ${time}`;
}

/**
 * The plain sentence of the progress section, e.g.
 * "6 of 10 swings before → 3 of the last 10" or "3 of the last 4 swings" when there is no earlier window.
 */
export function progressSentence(p: FaultProgress, lang: Lang = getLang()): string {
  const recent = t('history.progress.recent', { n: p.recent.detected, m: p.recent.total }, lang);
  if (!p.previous) return recent;
  const before = t('history.progress.before', { n: p.previous.detected, m: p.previous.total }, lang);
  return `${before} → ${recent}`;
}

/** Key positions both swings have (in swing order) – the sync buttons of the compare screen. */
export function commonPositions(a: Swing, b: Swing): KeyPosition[] {
  const order: KeyPosition[] = ['address', 'backswing9', 'top', 'downswing9', 'impact', 'finish'];
  const has = (s: Swing, p: KeyPosition) => s.keyframes.some((k) => k.position === p);
  return order.filter((p) => has(a, p) && has(b, p));
}

/**
 * Torso length (shoulder centre to hip centre) as a share of body height. Anthropometric tables give shoulder height
 * ≈ 0.82 H and hip-joint height ≈ 0.53 H → ≈ 0.29 H. Only for the "≈ x cm" display (decision A4).
 * REVIEW(golf): rough adult average; 2D projection makes the cm value approximate anyway.
 */
export const TORSO_SHARE_OF_HEIGHT = 0.29;

/** pct_torso value → approximate centimetres for a player of `heightCm` (rounded to whole cm). */
export function approxCm(pctTorso: number, heightCm: number): number {
  return Math.round((pctTorso / 100) * TORSO_SHARE_OF_HEIGHT * heightCm);
}

export interface CompareRow {
  metric: MetricId;
  at: KeyPosition | 'swing';
  unit: MetricUnit;
  a?: number;
  b?: number;
}

/**
 * Metric rows of the compare table: every value measured at `pos` (or over the whole swing) in at least one of the
 * two swings, in a stable order. Values below `minConfidence` are left out – unsure values would mislead in a compare.
 */
export function compareRows(a: Swing, b: Swing, pos: KeyPosition | 'swing', minConfidence = 0.5): CompareRow[] {
  const rows = new Map<MetricId, CompareRow>();
  const add = (s: Swing, side: 'a' | 'b') => {
    for (const v of s.metrics.values) {
      if (v.at !== pos || v.confidence < minConfidence) continue;
      const r = rows.get(v.id) ?? { metric: v.id, at: v.at, unit: v.unit };
      r[side] = v.value;
      rows.set(v.id, r);
    }
  };
  add(a, 'a');
  add(b, 'b');
  return [...rows.values()];
}

/**
 * Synchronised scrubbing: position u ∈ [0, positions.length − 1] between key positions → frame index of a swing,
 * linear between its own key frames. So both players reach "top" at the same slider position although their tempo differs.
 */
export function syncedFrame(swing: Swing, positions: KeyPosition[], u: number): number {
  const frames = positions.map((p) => swing.keyframes.find((k) => k.position === p)?.frameIndex ?? 0);
  if (!frames.length) return 0;
  const i = Math.max(0, Math.min(frames.length - 1, Math.floor(u)));
  if (i >= frames.length - 1) return frames[frames.length - 1];
  const f = u - i;
  return Math.round(frames[i] + (frames[i + 1] - frames[i]) * f);
}
