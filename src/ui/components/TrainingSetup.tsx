import { formatValue, metricName, positionName } from '../../coach/faults/format';
import { loc, num, t } from '../../coach/i18n/i18n';
import { cameraSupported } from '../../coach/live/camera';
import type { Settings, TrainingTarget } from '../../coach/model/types';
import { supportsMirror, withTolerance } from '../../coach/training/targets';
import type { TrainingMode } from './LiveTraining';
import '../styles/training.css';

/**
 * Training set-up (OWNER: agent "training"): mode, tolerance per criterion, short camera hint, start.
 */
interface Props {
  target: TrainingTarget;
  settings: Settings;
  mode: TrainingMode;
  ballGoal: number | null;
  onTarget: (t: TrainingTarget) => void;
  onMode: (m: TrainingMode) => void;
  onBallGoal: (n: number | null) => void;
  onStart: () => void;
  onChangeTarget: () => void;
}

const GOALS: (number | null)[] = [5, 10, 20, null];
const STEP = 1.25;

export function TrainingSetup({ target, settings, mode, ballGoal, onTarget, onMode, onBallGoal, onStart, onChangeTarget }: Props) {
  const mirrorOk = supportsMirror(target);
  const canCamera = cameraSupported();
  const digits = (u: string) => (u === 'ratio' ? 1 : 0);

  return (
    <div className="training-setup">
      <div className="card training-target">
        <div className="eyebrow">{t('training.setup.target')}</div>
        <div className="training-target-title">{loc(target.label)}</div>
        <div className="muted small">
          {t(`common.shot.${target.shotType}`)} · {t(`common.view.${target.view}`)} · {t(`common.pos.${target.position}`)}
        </div>
        <button className="btn-ghost" onClick={onChangeTarget}>
          {t('training.pick.heading')}
        </button>
      </div>

      <section className="training-section">
        <h2>{t('training.setup.mode')}</h2>
        <div className="choice-grid">
          <button className="choice" aria-pressed={mode === 'mirror'} disabled={!mirrorOk} onClick={() => onMode('mirror')}>
            🪞 {t('training.setup.mirror')}
            <small>{t('training.setup.mirrorSub')}</small>
          </button>
          <button className="choice" aria-pressed={mode === 'series'} onClick={() => onMode('series')}>
            ⛳ {t('training.setup.series')}
            <small>{t('training.setup.seriesSub')}</small>
          </button>
        </div>
        {!mirrorOk && <p className="muted small">{t('training.setup.mirrorUnavailable')}</p>}
      </section>

      {mode === 'series' && (
        <section className="training-section">
          <h2>{t('training.setup.balls')}</h2>
          <div className="segmented">
            {GOALS.map((g) => (
              <button key={String(g)} aria-pressed={ballGoal === g} onClick={() => onBallGoal(g)}>
                {g ?? t('training.setup.ballsOpen')}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="training-section">
        <h2>{t('training.setup.tolerance')}</h2>
        <ul className="list">
          {target.criteria.map((c, i) => (
            <li key={i} className="card training-crit">
              <div className="grow">
                <div className="title">{metricName(c.metric)}</div>
                <div className="muted small">{positionName(c.at)}</div>
                <div className="training-crit-val">
                  {formatValue(c.target, c.unit)} ± {num(c.tolerance * settings.toleranceScale, digits(c.unit))}
                </div>
              </div>
              <div className="training-steps">
                <button className="btn-secondary" onClick={() => onTarget(withTolerance(target, i, c.tolerance / STEP))} aria-label={t('training.setup.tighter')}>
                  −
                </button>
                <button className="btn-secondary" onClick={() => onTarget(withTolerance(target, i, c.tolerance * STEP))} aria-label={t('training.setup.wider')}>
                  +
                </button>
              </div>
            </li>
          ))}
        </ul>
        <p className="muted small" style={{ margin: 0 }}>
          {t('training.setup.toleranceHint')}
          {settings.toleranceScale !== 1 && ` ${t('training.setup.global', { v: num(settings.toleranceScale, 2) })}`}
        </p>
      </section>

      <section className="training-section">
        <h2>{t('training.setup.camera')}</h2>
        <ul className="training-guide">
          <li>
            <b>{t(`common.view.${target.view}`)}</b> – {t(`capture.viewHint.${target.view}`)}
          </li>
          <li>{t('capture.guide.common.upright')}</li>
          <li>{t('capture.guide.common.distance')}</li>
          <li>{t('capture.guide.common.whole')}</li>
          <li>{settings.sound ? t('training.setup.silent') : t('training.setup.soundOff')}</li>
        </ul>
      </section>

      {!canCamera && <div className="training-note">{t('training.setup.noCamera')}</div>}
      <button className="btn-primary training-start" disabled={!canCamera} onClick={onStart}>
        ▶ {t('training.setup.start')}
      </button>
    </div>
  );
}
