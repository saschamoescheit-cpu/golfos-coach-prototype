import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { keysOf, setLang } from '../../coach/i18n/i18n';
import { computeSwingScore } from '../../coach/faults/score';
import { metrics, mv } from '../../coach/faults/testUtils';
import { FaultCard } from './FaultCard';
import { ScoreCard } from './ScoreCard';
import { DrillSheet } from './DrillSheet';
import { DiagnoseScreen } from '../screens/DiagnoseScreen';

describe('fault UI (static render)', () => {
  it('FaultCard shows title, benefit and actions in German', () => {
    setLang('de');
    const html = renderToStaticMarkup(
      <FaultCard
        fault={{ defId: 'over_the_top', severity: 0.5, priority: 2, confidence: 0.9, marker: 'downswing9', frameIndex: 10, measured: [{ metric: 'hand_path_shift', at: 'downswing9', value: 14, threshold: 8 }] }}
        rank={1}
      />,
    );
    expect(html).toContain('Over the Top');
    expect(html).toContain('Slice');
    expect(html).toContain('Das trainieren');
    setLang('en');
  });

  it('ScoreCard renders total, level badge and six bars', () => {
    const s = computeSwingScore(metrics(mv('shaft_plane_dev', 'downswing9', 2), mv('tempo_ratio', 'swing', 3), mv('shoulder_turn', 'top', 90),
      mv('shaft_plane_dev', 'top', 1), mv('shaft_plane_dev', 'backswing9', 0), mv('spine_angle', 'address', 30)),
    { shotType: 'iron', view: 'down_the_line', handedness: 'right' }, { level: 3 })!;
    const html = renderToStaticMarkup(<ScoreCard score={s} />);
    expect(html).toContain('Level 3');
    expect(html.match(/fx-bar"/g)?.length).toBe(6);
  });

  it('DrillSheet and DiagnoseScreen render', () => {
    expect(renderToStaticMarkup(<DrillSheet faultId="casting" onClose={() => {}} />)).toContain('Video / tutorial follows');
    expect(renderToStaticMarkup(<DiagnoseScreen route={{ name: 'diagnose', params: {} }} />)).toContain('Slice');
    expect(renderToStaticMarkup(<DiagnoseScreen route={{ name: 'diagnose', params: { flight: 'fat' } }} />)).toContain('Causes the camera');
  });

  it('i18n: analysis, diagnose, faults namespaces have the same keys in en and de', () => {
    for (const ns of ['analysis.', 'diagnose.', 'faults.']) {
      const en = keysOf('en').filter((k) => k.startsWith(ns)).sort();
      const de = keysOf('de').filter((k) => k.startsWith(ns)).sort();
      expect(en.length).toBeGreaterThan(5);
      expect(de).toEqual(en);
    }
  });
});
