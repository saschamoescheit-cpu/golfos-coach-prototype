import { describe, expect, it } from 'vitest';
import { keysOf, loc, num, t } from './i18n';

/**
 * Completeness of all translation files that exist (every agent's namespace is checked automatically):
 * every key in English exists in German and vice versa, placeholders {x} are identical, nothing is empty.
 */
const files = import.meta.glob('./locales/*/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const namespaces = (lang: string) =>
  Object.keys(files)
    .map((p) => new RegExp(`/locales/${lang}/([\\w-]+)\\.json$`).exec(p)?.[1])
    .filter((x): x is string => !!x)
    .sort();
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n completeness', () => {
  it('every namespace file exists in English and German', () => {
    expect(namespaces('de')).toEqual(namespaces('en'));
    expect(namespaces('en')).toContain('common');
  });

  it('every English key exists in German', () => {
    const de = new Set(keysOf('de'));
    expect(keysOf('en').filter((k) => !de.has(k))).toEqual([]);
  });

  it('every German key exists in English', () => {
    const en = new Set(keysOf('en'));
    expect(keysOf('de').filter((k) => !en.has(k))).toEqual([]);
  });

  it('placeholders are identical in both languages', () => {
    const diff = keysOf('en')
      .filter((k) => keysOf('de').includes(k))
      .filter((k) => placeholders(t(k, undefined, 'en')).join() !== placeholders(t(k, undefined, 'de')).join());
    expect(diff).toEqual([]);
  });

  it('no empty texts', () => {
    const empty = (['en', 'de'] as const).flatMap((l) => keysOf(l).filter((k) => !t(k, undefined, l).trim()).map((k) => `${l}:${k}`));
    expect(empty).toEqual([]);
  });
});

/** Every literal key used in the code – t('ns.key') – exists in English (otherwise the key itself shows up in the app). */
const sources = import.meta.glob(['../../**/*.{ts,tsx}', '!../../**/*.test.{ts,tsx}'], { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

describe('keys used in the code', () => {
  it('every literal t() key exists', () => {
    const en = new Set(keysOf('en'));
    const missing: string[] = [];
    let used = 0;
    for (const [file, src] of Object.entries(sources)) {
      for (const m of src.matchAll(/\bt\(\s*'([a-z][\w-]*\.[\w.-]+)'/g)) {
        used++;
        if (!en.has(m[1])) missing.push(`${m[1]} (${file.replace(/^.*\/src\//, 'src/')})`);
      }
    }
    expect(used).toBeGreaterThan(50);
    expect(missing).toEqual([]);
  });
});

/** Catalog JSONs carry their own {en, de} texts (Localized) – every one needs both languages. */
const catalogs = import.meta.glob('../**/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

function missingLocalized(v: unknown, path: string, out: string[]) {
  if (Array.isArray(v)) v.forEach((x, i) => missingLocalized(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.en === 'string' || typeof o.de === 'string') {
      for (const l of ['en', 'de']) if (typeof o[l] !== 'string' || !(o[l] as string).trim()) out.push(`${path}.${l}`);
      const pe = placeholders(String(o.en ?? '')).join();
      if (pe !== placeholders(String(o.de ?? '')).join()) out.push(`${path} (placeholders)`);
    } else for (const [k, x] of Object.entries(o)) missingLocalized(x, `${path}.${k}`, out);
  }
}

describe('catalog texts (Localized {en, de})', () => {
  it('every catalog text exists in English and German', () => {
    const out: string[] = [];
    const scanned = Object.keys(catalogs).filter((p) => !p.includes('/locales/'));
    for (const p of scanned) missingLocalized(catalogs[p], p, out);
    expect(scanned.length).toBeGreaterThan(0);
    expect(out).toEqual([]);
  });
});

describe('i18n helpers', () => {
  it('t() replaces placeholders and falls back to the key', () => {
    expect(t('common.appName', { app: 'GolfOS' }, 'de')).toBe('GolfOS Coach');
    expect(t('nope.missing')).toBe('nope.missing');
  });
  it('loc() falls back to English, num() uses the decimal comma in German', () => {
    expect(loc({ en: 'Hi', de: '' }, 'de')).toBe('Hi');
    expect(num(1.5, 1, 'de')).toBe('1,5');
    expect(num(1.5, 1, 'en')).toBe('1.5');
  });
});
