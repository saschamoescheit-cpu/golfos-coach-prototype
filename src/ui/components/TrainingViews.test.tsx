import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { keysOf, setLang } from '../../coach/i18n/i18n';
import { DEFAULT_SETTINGS } from '../../coach/storage/memory';
import { targetFromTemplate, TEMPLATES } from '../../coach/training/targets';
import { segmentColors } from './LiveOverlay';
import { TrainingPicker } from './TrainingPicker';
import { TrainingSetup } from './TrainingSetup';
import { TrainingSummary } from './TrainingSummary';
import { COLORS } from '../../coach/training/proximity';

const noop = () => {};

describe('training UI (static render)', () => {
  it('i18n: every training key exists in English and German', () => {
    const en = keysOf('en').filter((k) => k.startsWith('training.'));
    const de = new Set(keysOf('de').filter((k) => k.startsWith('training.')));
    expect(en.length).toBeGreaterThan(40);
    expect(en.filter((k) => !de.has(k))).toEqual([]);
  });

  it('picker lists templates and corrections', () => {
    setLang('de');
    const html = renderToStaticMarkup(<TrainingPicker settings={DEFAULT_SETTINGS} onPick={noop} />);
    expect(html).toContain('Was willst du trainieren?');
    expect(html).toContain('Top: linker Arm gestreckt');
    setLang('en');
  });

  it('set-up shows mode, tolerance with − / + and the camera hint; mirror disabled for series-only targets', () => {
    const target = targetFromTemplate(TEMPLATES[0], { withGhost: false });
    const html = renderToStaticMarkup(
      <TrainingSetup
        target={target}
        settings={DEFAULT_SETTINGS}
        mode="mirror"
        ballGoal={10}
        onTarget={noop}
        onMode={noop}
        onBallGoal={noop}
        onStart={noop}
        onChangeTarget={noop}
      />,
    );
    expect(html).toContain('Mirror');
    expect(html).toContain('Ball series');
    expect(html).toContain('175');
    expect(html).toContain('Tolerance');
  });

  it('summary shows the big hit rate and the list green/red', () => {
    const target = targetFromTemplate(TEMPLATES[0], { withGhost: false });
    const html = renderToStaticMarkup(
      <TrainingSummary
        target={target}
        mode="series"
        result={{
          tally: { hits: 2, judged: 3, unknown: 1, practice: 2 },
          mirror: { reached: 0, held: 0 },
          shots: [
            { n: 1, swingId: 'a', outcome: 'hit', proximity: 0.9, value: 168, createdAt: 0 },
            { n: 2, swingId: 'b', outcome: 'miss', proximity: 0.2, value: 140, createdAt: 0 },
            { n: 3, swingId: 'c', outcome: 'hit', proximity: 0.8, value: 172, createdAt: 0 },
            { n: 4, swingId: 'd', outcome: 'unknown', proximity: null, value: null, createdAt: 0 },
          ],
        }}
        onAgain={noop}
        onDone={noop}
      />,
    );
    expect(html).toContain('2 of 3 reached');
    expect(html).toContain('✓');
    expect(html).toContain('✕');
    expect(html).toContain('1 not measurable');
    expect(html).toContain('2 practice swings ignored');
  });

  it('overlay colours the lines of the trained criterion', () => {
    const target = targetFromTemplate(TEMPLATES[0], { withGhost: false });
    const c = target.criteria[0];
    const m = segmentColors(target.criteria, [{ criterion: c, value: 170, distance: 0, proximity: 1, within: true, direction: 0 }]);
    expect([...m.values()].every((v) => v === COLORS.green)).toBe(true);
    expect(m.size).toBe(2);
  });
});
