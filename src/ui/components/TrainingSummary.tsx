import { formatValue } from '../../coach/faults/format';
import { loc, num, t } from '../../coach/i18n/i18n';
import type { TrainingTarget } from '../../coach/model/types';
import { hitRate } from '../../coach/training/series';
import { go } from '../nav';
import type { LiveTrainingResult, TrainingMode } from './LiveTraining';
import '../styles/training.css';

/** End of a training (OWNER: agent "training"): big hit rate "7 of 10", list of swings green/red, tap opens the swing. */
interface Props {
  target: TrainingTarget;
  mode: TrainingMode;
  result: LiveTrainingResult;
  onAgain: () => void;
  onDone: () => void;
}

export function TrainingSummary({ target, mode, result, onAgain, onDone }: Props) {
  const { tally } = result;
  const rate = hitRate(tally);
  const c0 = target.criteria[0];
  return (
    <div className="training-summary">
      <div className="card training-target">
        <div className="eyebrow">{mode === 'series' ? t('training.summary.title') : t('training.summary.mirrorTitle')}</div>
        <div className="training-target-title">{loc(target.label)}</div>
      </div>

      {mode === 'series' ? (
        <>
          <div className="training-rate">
            {tally.judged ? (
              <>
                <div className="big">
                  <b className={rate! >= 0.5 ? 'status-ok' : 'status-bad'}>{tally.hits}</b> / {tally.judged}
                </div>
                <div className="txt">{t('training.summary.rate', { hits: tally.hits, n: tally.judged })}</div>
                <div className="muted">{num(rate! * 100)} %</div>
              </>
            ) : (
              <div className="txt">{t('training.summary.none')}</div>
            )}
            {tally.unknown > 0 && <div className="muted small">{t('training.summary.unknownN', { n: tally.unknown })}</div>}
            {tally.practice > 0 && <div className="muted small">{t('training.summary.practiceN', { n: tally.practice })}</div>}
          </div>
          {result.shots.length > 0 && (
            <section className="training-section">
              <h2>{t('training.summary.list')}</h2>
              <ul className="list">
                {[...result.shots]
                  .sort((a, b) => a.n - b.n)
                  .map((s) => (
                    <li key={s.n}>
                      <button className={`list-item training-shot ${s.outcome}`} disabled={!s.swingId} onClick={() => s.swingId && go('analysis', { swingId: s.swingId })}>
                        <span className="mark">{s.outcome === 'hit' ? '✓' : s.outcome === 'miss' ? '✕' : '?'}</span>
                        <span className="grow">
                          <span className="title">
                            #{s.n} ·{' '}
                            {s.outcome === 'hit' ? t('training.live.reached') : s.outcome === 'miss' ? t('training.live.missed') : t('training.live.unknown')}
                          </span>
                          <span className="muted small">
                            {new Date(s.createdAt).toLocaleTimeString()}
                            {s.value != null && c0 ? ` · ${formatValue(s.value, c0.unit)} (${formatValue(c0.target, c0.unit)})` : ''}
                          </span>
                        </span>
                        {s.swingId && <span aria-hidden>›</span>}
                      </button>
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </>
      ) : (
        <div className="training-rate">
          <div className="big">
            <b className="status-ok">{result.mirror.held}×</b>
          </div>
          <div className="txt">{t('training.summary.mirrorHeld', { n: result.mirror.held })}</div>
          <div className="muted">{t('training.summary.mirrorReached', { n: result.mirror.reached })}</div>
        </div>
      )}

      <button className="btn-primary" onClick={onAgain}>
        ↻ {t('training.summary.again')}
      </button>
      <button className="btn-secondary" onClick={onDone}>
        {t('training.summary.done')}
      </button>
    </div>
  );
}
