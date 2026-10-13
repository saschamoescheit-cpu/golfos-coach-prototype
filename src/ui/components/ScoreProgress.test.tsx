import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { computeSwingScore } from '../../coach/faults/score';
import { metrics, mv } from '../../coach/faults/testUtils';
import { fakeSwing } from '../../coach/storage/testFixtures';
import { LevelUpCard, ScoreCurveCard } from './ScoreProgress';

const score = computeSwingScore(
  metrics(mv('shaft_plane_dev', 'downswing9', 1), mv('tempo_ratio', 'swing', 3), mv('shoulder_turn', 'top', 90),
    mv('shaft_plane_dev', 'top', 1), mv('shaft_plane_dev', 'backswing9', 0), mv('spine_angle', 'address', 30)),
  { shotType: 'iron', view: 'down_the_line', handedness: 'right' },
  { level: 3, fps: 240 },
);
const t0 = new Date(2026, 9, 1, 10).getTime();
const swings = [0, 1, 2].flatMap((d) => [0, 1, 2, 3, 4].map((i) => fakeSwing(`${d}-${i}`, { createdAt: t0 + d * 86_400_000 + i * 60_000, score })));

describe('score progress views (review W7)', () => {
  it('curve: one row per practice day, empty hint without enough swings', () => {
    const html = renderToStaticMarkup(<ScoreCurveCard swings={swings} level={3} />);
    expect(html.match(/<li /g)?.length).toBe(3);
    expect(html).toContain('5 swings');
    expect(renderToStaticMarkup(<ScoreCurveCard swings={swings.slice(0, 4)} level={3} />)).toContain('at least 5 scored swings');
  });
  it('level-up card only when suggested', () => {
    expect(renderToStaticMarkup(<LevelUpCard swings={swings} level={3} />)).toContain('Switch to level 2');
    expect(renderToStaticMarkup(<LevelUpCard swings={swings.slice(0, 10)} level={3} />)).toBe('');
  });
});
