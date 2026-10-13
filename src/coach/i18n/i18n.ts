import { useSyncExternalStore } from 'react';
import type { Handedness, Lang, Localized } from '../model/types';

/**
 * i18n (work package G). English is the base language, German the second one.
 * Texts live in locales/<lang>/<namespace>.json; key = "<namespace>.<key>" (nested objects are flattened with dots).
 * Every agent owns its own namespace file (common, capture, analysis, faults, training, history, settings …).
 * Missing German text falls back to English, missing English text shows the key (visible in review).
 */
const files = import.meta.glob('./locales/*/*.json', { eager: true, import: 'default' }) as Record<string, Record<string, unknown>>;

type Dict = Record<string, string>;
const dicts: Record<Lang, Dict> = { en: {}, de: {} };

function flatten(prefix: string, obj: Record<string, unknown>, out: Dict) {
  for (const [k, v] of Object.entries(obj)) {
    const key = `${prefix}.${k}`;
    if (v && typeof v === 'object') flatten(key, v as Record<string, unknown>, out);
    else out[key] = String(v);
  }
}

for (const [path, content] of Object.entries(files)) {
  const m = /\/locales\/(\w+)\/([\w-]+)\.json$/.exec(path);
  if (!m) continue;
  const lang = m[1] as Lang;
  if (dicts[lang]) flatten(m[2], content, dicts[lang]);
}

let current: Lang = 'en';
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  listeners.forEach((l) => l());
}

/** Phone language as default (German phones → German, everything else English). */
export function detectLang(): Lang {
  if (typeof navigator === 'undefined') return 'en';
  return navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

// ------------------------------------------------------------------ side words (review W4)

/**
 * Texts never hard-code left/right. They use side tokens that are resolved with the player's handedness:
 *   {lead} {trail}  body side: lead = target side (left arm of a right-hander), trail = the other one
 *   {left} {right}  directions as a RIGHT-hander sees them (ball flight, aim); swapped for a left-hander
 *   capitalised ({Lead}, {Right} …) at the start of a sentence or in a German compound noun.
 * English resolves to the word ("left"/"right"). German resolves to the STEM ("link"/"recht") and the text writes the
 * ending: "die {lead}e Schulter", "den {trail}en Ellbogen", "nach {left}s", "{Right}skurve" – so every case and gender
 * stays correct for both hands.
 */
export const SIDE_TOKEN = /\{(lead|trail|left|right|Lead|Trail|Left|Right)\}/g;
const SIDE_WORDS: Record<Lang, [left: string, right: string]> = { en: ['left', 'right'], de: ['link', 'recht'] };
let hand: Handedness = 'right';

/** Default handedness for side tokens (from the settings; a screen showing one swing passes the swing's own). */
export function setHandedness(h: Handedness) {
  hand = h;
}
export function getHandedness(): Handedness {
  return hand;
}

/** Resolve the side tokens of a text for a handedness. */
export function sides(s: string, lang: Lang = current, handedness: Handedness = hand): string {
  if (!s.includes('{')) return s;
  const [l, r] = SIDE_WORDS[lang];
  return s.replace(SIDE_TOKEN, (_m, tok: string) => {
    const lower = tok.toLowerCase();
    const leftForRightHander = lower === 'lead' || lower === 'left';
    const w = leftForRightHander === (handedness === 'right') ? l : r;
    return tok[0] === lower[0] ? w : w[0].toUpperCase() + w.slice(1);
  });
}

/** Translate a key; {name} placeholders are replaced from params, side tokens with the handedness (default: settings). */
export function t(key: string, params?: Record<string, string | number>, lang: Lang = current, handedness: Handedness = hand): string {
  const own = dicts[lang][key];
  let s = own ?? dicts.en[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return sides(s, own !== undefined ? lang : 'en', handedness);
}

/** Pick the current language from a catalog text ({en, de}) and resolve its side tokens (default: settings handedness). */
export function loc(text: Localized | undefined, lang: Lang = current, handedness: Handedness = hand): string {
  if (!text) return '';
  return text[lang] ? sides(text[lang], lang, handedness) : sides(text.en, 'en', handedness);
}

/** Format a number in the current language (decimal comma in German). */
export function num(v: number, digits = 0, lang: Lang = current): string {
  return v.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** React: re-render when the language changes. */
export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => current,
  );
}

/** All keys of a language – used by the i18n completeness test. */
export function keysOf(lang: Lang): string[] {
  return Object.keys(dicts[lang]);
}
