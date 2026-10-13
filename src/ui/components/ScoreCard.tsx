import { useState } from 'react';
import { t } from '../../coach/i18n/i18n';
import { formatValue, metricName, positionName, unitOf } from '../../coach/faults/format';
import { scoreColor } from '../../coach/faults/score';
import type { ScoreCriterion, SwingScore } from '../../coach/model/types';
import '../styles/faults.css';

const SYMBOL = { green: '✓', yellow: '~', red: '✕', grey: '–' } as const;

function scoreWord(total: number): string {
  const k = total >= 90 ? 'excellent' : total >= 80 ? 'good' : total >= 65 ? 'solid' : total >= 50 ? 'work' : 'potential';
  return t(`analysis.score.word.${k}`);
}

function CriterionLine({ c }: { c: ScoreCriterion }) {
  const unit = unitOf(c.metric);
  const statusClass = c.status === 'green' ? 'fx-ok' : c.status === 'red' ? 'fx-bad' : c.status === 'yellow' ? 'fx-warn' : 'fx-grey';
  const target =
    c.mode === 'min' ? t('analysis.score.atLeast', { v: formatValue(c.target, unit) }) : `${formatValue(c.target, unit)} ± ${formatValue(c.tolerance, unit)}`;
  return (
    <div>
      <strong>{metricName(c.metric)}</strong> · {positionName(c.at)}
      <br />
      {c.measured !== null && c.points !== null ? (
        <>
          {t('analysis.score.measured')} {formatValue(c.measured, unit)} · {t('analysis.score.target')} {target} ·{' '}
          <span className={statusClass}>
            {SYMBOL[c.status === 'not_measured' ? 'grey' : c.status]} {t('analysis.score.points', { n: Math.round(c.points) })}
          </span>
        </>
      ) : (
        <span className="fx-grey">
          {t('analysis.score.notMeasured')}
          {c.reason ? ` – ${t(`analysis.score.reason.${c.reason}`)}` : ''}
        </span>
      )}
    </div>
  );
}

/** Swing score: big number + word + level badge, six bars (tap → measured vs target). */
export function ScoreCard({ score }: { score: SwingScore }) {
  const [open, setOpen] = useState<string | null>(null);
  const color = scoreColor(score.total);
  return (
    <div className="fx-score">
      <div className="fx-score-head">
        <div className={`fx-score-num ${color}`}>{score.total ?? '–'}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2>{score.total !== null ? scoreWord(score.total) : t('analysis.score.title')}</h2>
          <div>
            {score.level && <span className="fx-badge">{t('analysis.score.level', { n: score.level })}</span>}{' '}
            {score.tourTotal !== null && score.tourTotal !== undefined && score.level !== 1 && (
              <span className="fx-muted">{t('analysis.score.tour', { n: score.tourTotal })}</span>
            )}
          </div>
        </div>
      </div>
      {score.total === null && score.noTotalReason && <div className="fx-muted">{t(`analysis.score.noTotal.${score.noTotalReason}`)}</div>}
      {score.noTotalReason !== 'shot_type' && (
        <>
          <div className="fx-bars">
            {score.parts.map((p) => {
              const c = scoreColor(p.score);
              return (
                <div key={p.id}>
                  <button className="fx-bar" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
                    <span>
                      {t(`analysis.score.part.${p.id}`)} <span className="fx-muted">{Math.round(p.weight * 100)} %</span>
                    </span>
                    <span className="track">
                      <span className={`fill ${c}`} style={{ width: `${p.score ?? 0}%`, display: 'block' }} />
                    </span>
                    <span className={`val ${c === 'green' ? 'fx-ok' : c === 'red' ? 'fx-bad' : c === 'yellow' ? 'fx-warn' : 'fx-grey'}`}>
                      {p.score ?? '–'} {SYMBOL[c]}
                    </span>
                  </button>
                  {open === p.id && (
                    <div className="fx-bar-detail">
                      {(score.criteria ?? [])
                        .filter((c2) => c2.part === p.id)
                        .map((c2) => (
                          <CriterionLine key={`${c2.metric}@${c2.at}`} c={c2} />
                        ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="fx-muted">{t('analysis.score.tapHint')}</div>
        </>
      )}
    </div>
  );
}
