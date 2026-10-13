import { useMemo, useState } from 'react';
import { scoreColor } from '../../coach/faults/score';
import { num, t } from '../../coach/i18n/i18n';
import type { ScoreLevel, ShotType, Swing } from '../../coach/model/types';
import { levelUpSuggestion, MIN_SWINGS_PER_UNIT, scoreCurves } from '../../coach/storage/scoreHistory';
import { updateSettings } from '../../coach/storage/settings';

/**
 * Swing-score progress (Swing-Score rules §4.6, review W7): median score per practice day, one curve per measuring
 * profile (view + shot type), every value on the player's current level. Drawn as labelled rows (date, swings, median
 * and a thin bar on a 0–100 scale) – readable in the sun and without a tooltip.
 */
export function ScoreCurveCard({ swings, level, shotType }: { swings: Swing[]; level: ScoreLevel; shotType?: ShotType }) {
  const curves = useMemo(() => scoreCurves(swings, level, shotType), [swings, level, shotType]);
  return (
    <section className="card score-curve">
      <h2>{t('history.curve.title')}</h2>
      {curves.length === 0 ? (
        <p className="muted small">{t('history.curve.empty', { n: MIN_SWINGS_PER_UNIT })}</p>
      ) : (
        <>
          <p className="muted small">{t('history.curve.hint', { n: MIN_SWINGS_PER_UNIT, level })}</p>
          {curves.map((c) => (
            <div key={`${c.shotType}|${c.view}`} className="score-curve-profile">
              <div className="eyebrow">
                {t(`common.shot.${c.shotType}`)} · {t(`common.viewShort.${c.view}`)}
              </div>
              <ul className="score-curve-rows">
                {c.units.map((u) => (
                  <li key={u.day} title={`${u.day}: ${num(u.median)}`}>
                    <span className="day">{new Date(u.start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                    <span className="bar" aria-hidden="true">
                      <span className={`fill score-${scoreColor(u.median)}`} style={{ width: `${Math.max(2, Math.min(100, u.median))}%` }} />
                    </span>
                    <strong className="val">{num(u.median)}</strong>
                    <span className="muted small n">{t('history.curve.row', { n: u.n })}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

/** Level-up suggestion (§3): shown only when levelUpSuggestion() says so; the player confirms, nothing is automatic. */
export function LevelUpCard({ swings, level }: { swings: Swing[]; level: ScoreLevel }) {
  const [dismissed, setDismissed] = useState(false);
  const sug = useMemo(() => levelUpSuggestion(swings, level), [swings, level]);
  if (!sug || dismissed) return null;
  return (
    <section className="card level-up" role="status">
      <h2>{t('history.levelUp.title', { to: sug.to })}</h2>
      <p className="small" style={{ margin: 0 }}>
        {t('history.levelUp.text', { units: sug.units.length, m: num(sug.median), from: sug.from, to: sug.to })}
      </p>
      <div className="fx-actions">
        <button className="btn-secondary" onClick={() => setDismissed(true)}>
          {t('history.levelUp.later')}
        </button>
        <button className="btn-primary" onClick={() => void updateSettings({ scoreLevel: sug.to })}>
          {t('history.levelUp.accept', { to: sug.to })}
        </button>
      </div>
    </section>
  );
}
