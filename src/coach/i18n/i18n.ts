import { useSyncExternalStore } from 'react';
import type { Lang, Localized } from '../model/types';

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

/** Translate a key; {name} placeholders are replaced from params. */
export function t(key: string, params?: Record<string, string | number>, lang: Lang = current): string {
  let s = dicts[lang][key] ?? dicts.en[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Pick the current language from a catalog text ({en, de}). */
export function loc(text: Localized | undefined, lang: Lang = current): string {
  if (!text) return '';
  return text[lang] || text.en;
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
