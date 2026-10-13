import { SCORE_CONFIG } from '../../coach/faults/score';
import type { Lang, ScoreLevel } from '../../coach/model/types';

/** Pure helpers of the settings screen (testable in Node). */

export const HANDICAP_MAX = 54;
/** Plus handicaps go down to about +10 for tour pros. */
export const PLUS_HANDICAP_MAX = 10;
export const TOLERANCE_MIN = 0.5;
export const TOLERANCE_MAX = 2;
export const HEIGHT_MIN = 120;
export const HEIGHT_MAX = 220;

/**
 * Handicap text → stored number. Plus handicaps (better than scratch) are stored NEGATIVE (+2.3 → −2.3), which is what
 * levelFromHandicap expects. The iPhone decimal keypad has no "+"/"−", hence the separate `plus` switch; a typed "+" or
 * "−" is accepted as well. Empty → null (not set). Invalid → 'invalid'.
 */
export function parseHandicap(text: string, plus: boolean): number | null | 'invalid' {
  const s = text.trim().replace(',', '.').replace('−', '-');
  if (!s) return null;
  let sign = plus ? -1 : 1;
  let body = s;
  if (body.startsWith('+')) {
    sign = -1;
    body = body.slice(1);
  } else if (body.startsWith('-')) {
    sign = -1;
    body = body.slice(1);
  }
  if (!/^\d{1,2}(\.\d)?$/.test(body.trim())) return 'invalid';
  const v = Number(body);
  if (sign < 0 ? v > PLUS_HANDICAP_MAX : v > HANDICAP_MAX) return 'invalid';
  return v === 0 ? 0 : sign * v;
}

/** Stored number → text for the input field (without the plus sign, the switch shows it). */
export function handicapInput(h: number | null | undefined, lang: Lang): string {
  if (h === null || h === undefined || !Number.isFinite(h)) return '';
  const v = Math.abs(h);
  const txt = Number.isInteger(v) ? String(v) : v.toFixed(1);
  return lang === 'de' ? txt.replace('.', ',') : txt;
}

export interface LevelInfo {
  level: ScoreLevel;
  /** handicap range covered by this level; from = null for the first level (incl. plus handicaps) */
  from: number | null;
  to: number;
  factor: number;
}

/** The score levels with their handicap ranges, from the score configuration (faults agent). */
export function levelInfos(): LevelInfo[] {
  const levels = [...SCORE_CONFIG.levels].sort((a, b) => a.level - b.level);
  return levels.map((l, i) => ({ level: l.level, from: i === 0 ? null : levels[i - 1].maxHandicap, to: l.maxHandicap, factor: l.factor }));
}

export function clampTolerance(x: number): number {
  return Math.round(Math.min(TOLERANCE_MAX, Math.max(TOLERANCE_MIN, x)) * 10) / 10;
}

export function clampHeight(cm: number): number {
  return Math.round(Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, cm)));
}
