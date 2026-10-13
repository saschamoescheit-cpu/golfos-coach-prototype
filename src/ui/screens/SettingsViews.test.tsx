import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../../coach/i18n/i18n';
import { HistoryConfirmSheet } from '../components/HistoryConfirmSheet';
import { ProgressBars } from '../components/ProgressBars';
import { faultProgress } from '../../coach/storage/progress';
import { rowsFromPattern } from '../../coach/storage/testFixtures';
import { HistoryScreen } from './HistoryScreen';
import { HomeScreen } from './HomeScreen';
import { SettingsScreen } from './SettingsScreen';

/** Static renders: catch crashes and untranslated keys ("settings.xyz" showing up as text). */
const rawKey = /\b(common|history|settings)\.[a-z][\w.]*/;

afterEach(() => setLang('en'));

describe('settings / history / home (static render)', () => {
  it.each(['en', 'de'] as const)('SettingsScreen renders all sections in %s without raw keys', (lang) => {
    setLang(lang);
    const html = renderToStaticMarkup(<SettingsScreen route={{ name: 'settings', params: {} }} />);
    expect(html).not.toMatch(rawKey);
    expect(html).toContain(lang === 'de' ? 'Score-Stufe' : 'Score level');
    expect(html).toContain('Deutsch');
    expect(html).toContain(lang === 'de' ? 'Alle Daten löschen' : 'Delete all data');
  });

  it('HistoryScreen and HomeScreen render their first frame', () => {
    expect(renderToStaticMarkup(<HistoryScreen route={{ name: 'history', params: {} }} />)).toContain('My swings');
    expect(renderToStaticMarkup(<HomeScreen />)).toContain('Analyze a swing');
  });

  it('confirm sheet and progress bars', () => {
    const html = renderToStaticMarkup(<HistoryConfirmSheet title="T" text="X" okLabel="OK" danger onOk={() => {}} onCancel={() => {}} />);
    expect(html).toContain('Cancel');
    const p = faultProgress(rowsFromPattern('f', 'x.x'), 'f');
    const svg = renderToStaticMarkup(<ProgressBars points={p.points} ariaLabel="f" />);
    expect((svg.match(/<rect/g) ?? []).length).toBe(3);
  });
});
