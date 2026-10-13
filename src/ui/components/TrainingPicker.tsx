import { useEffect, useMemo, useState } from 'react';
import { FAULTS } from '../../coach/faults/catalog';
import { metricName } from '../../coach/faults/format';
import { loc, t } from '../../coach/i18n/i18n';
import type { KeyPosition, MetricId, Settings, Swing, TrainingTarget } from '../../coach/model/types';
import { getStore } from '../../coach/storage';
import {
  referenceCandidates,
  referencePositions,
  supportsMirror,
  targetFromFault,
  targetFromReference,
  targetFromTemplate,
  TEMPLATES,
  trainableFaults,
} from '../../coach/training/targets';
import '../styles/training.css';

/**
 * Choose what to train (OWNER: agent "training"): a correction of the catalog, a position of one of my own swings,
 * a template position, or a recently trained target.
 */
interface Props {
  settings: Settings;
  /** pre-select this swing for "hit a position of my swing again" */
  initialSwingId?: string;
  onPick: (t: TrainingTarget) => void;
}

export function TrainingPicker({ settings, initialSwingId, onPick }: Props) {
  const [saved, setSaved] = useState<TrainingTarget[]>([]);
  const [swings, setSwings] = useState<Swing[]>([]);
  const [allFaults, setAllFaults] = useState(false);
  const [swing, setSwing] = useState<Swing | null>(null);
  const [pos, setPos] = useState<KeyPosition | null>(null);
  const [chosen, setChosen] = useState<MetricId[]>([]);

  useEffect(() => {
    let off = false;
    void (async () => {
      const store = await getStore();
      const [tg, sw] = await Promise.all([store.listTargets(), store.listSwings({ limit: 12 })]);
      if (off) return;
      setSaved(tg.slice(-8).reverse());
      const withKf = sw.filter((s) => s.keyframes.length > 0);
      setSwings(withKf);
      if (initialSwingId) {
        const s = withKf.find((x) => x.id === initialSwingId) ?? (await store.getSwing(initialSwingId));
        if (s && !off) setSwing(s);
      }
    })();
    return () => {
      off = true;
    };
  }, [initialSwingId]);

  const faults = useMemo(() => {
    const list = trainableFaults(FAULTS);
    return allFaults ? list : list.filter((f) => f.shotTypes.includes(settings.defaultShotType));
  }, [allFaults, settings.defaultShotType]);

  const candidates = swing && pos ? referenceCandidates(swing, pos) : [];
  useEffect(() => {
    setChosen(candidates.slice(0, 1).map((c) => c.metric));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swing?.id, pos]);

  const removeSaved = async (id: string) => {
    await (await getStore()).deleteTarget(id);
    setSaved((s) => s.filter((x) => x.id !== id));
  };

  return (
    <div className="training-pick">
      <h2>{t('training.pick.heading')}</h2>

      {saved.length > 0 && (
        <section className="training-section">
          <div className="eyebrow">{t('training.pick.saved')}</div>
          <ul className="list">
            {saved.map((x) => (
              <li key={x.id} className="training-row">
                <button className="list-item" onClick={() => onPick(x)}>
                  <span className="grow">
                    <span className="title">{loc(x.label)}</span>
                    <span className="muted small">
                      {t(`common.pos.${x.position}`)} · {t(`common.view.${x.view}`)}
                    </span>
                  </span>
                  <span aria-hidden>›</span>
                </button>
                <button className="icon-btn" aria-label={t('training.pick.delete')} onClick={() => void removeSaved(x.id)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="training-section">
        <div className="eyebrow">{t('training.pick.templates')}</div>
        <ul className="list">
          {TEMPLATES.map((tpl) => (
            <li key={tpl.id}>
              <button className="list-item" onClick={() => onPick(targetFromTemplate(tpl))}>
                <span className="grow">
                  <span className="title">{loc(tpl.label)}</span>
                  <span className="muted small">
                    {t(`common.view.${tpl.view}`)} · {tpl.criteria.map((c) => metricName(c.metric)).join(', ')}
                  </span>
                </span>
                <span aria-hidden>›</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="training-section">
        <div className="eyebrow">{t('training.pick.corrections')}</div>
        <ul className="list">
          {faults.map((f) => {
            const tg = targetFromFault(f, { shotType: settings.defaultShotType, view: settings.defaultView, withGhost: false });
            if (!tg) return null;
            return (
              <li key={f.id}>
                <button className="list-item" onClick={() => onPick(targetFromFault(f, { shotType: settings.defaultShotType, view: settings.defaultView })!)}>
                  <span className="grow">
                    <span className="title">{loc(f.name)}</span>
                    <span className="muted small">
                      {t(`common.pos.${tg.position}`)} · {t(`common.view.${tg.view}`)}
                      {!supportsMirror(tg) && ` · ${t('training.pick.seriesOnly')}`}
                    </span>
                  </span>
                  <span aria-hidden>›</span>
                </button>
              </li>
            );
          })}
        </ul>
        {!allFaults && (
          <button className="btn-ghost" onClick={() => setAllFaults(true)}>
            {t('training.pick.showAll')}
          </button>
        )}
      </section>

      <section className="training-section">
        <div className="eyebrow">{t('training.pick.fromSwing')}</div>
        <p className="muted small" style={{ margin: 0 }}>
          {t('training.pick.fromSwingSub')}
        </p>
        {swings.length === 0 && !swing && <p className="muted small">{t('training.pick.noSwings')}</p>}
        {!swing && (
          <ul className="list">
            {swings.map((s) => (
              <li key={s.id}>
                <button className="list-item" onClick={() => setSwing(s)}>
                  <span className="grow">
                    <span className="title">
                      {t(`common.shot.${s.shotType}`)} · {t(`common.view.${s.view}`)}
                    </span>
                    <span className="muted small">
                      {new Date(s.createdAt).toLocaleString()}
                      {s.score?.total != null ? ` · ${s.score.total}` : ''}
                    </span>
                  </span>
                  <span aria-hidden>›</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {swing && (
          <div className="card training-ref">
            <div className="muted small">
              {t(`common.shot.${swing.shotType}`)} · {t(`common.view.${swing.view}`)} · {new Date(swing.createdAt).toLocaleString()}
            </div>
            <div className="field">
              <label>{t('training.pick.choosePosition')}</label>
              <div className="choice-grid">
                {referencePositions(swing).map((p) => (
                  <button key={p} className="choice" aria-pressed={pos === p} onClick={() => setPos(p)}>
                    {t(`common.pos.${p}`)}
                  </button>
                ))}
              </div>
            </div>
            {pos && candidates.length > 0 && (
              <div className="field">
                <label>{t('training.pick.chooseValues')}</label>
                <div className="choice-grid">
                  {candidates.map((c) => (
                    <button
                      key={c.metric}
                      className="choice"
                      aria-pressed={chosen.includes(c.metric)}
                      onClick={() => setChosen((x) => (x.includes(c.metric) ? x.filter((m) => m !== c.metric) : [...x, c.metric].slice(-3)))}
                    >
                      {metricName(c.metric)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {pos && candidates.length === 0 && <p className="muted small">{t('common.notReliable')}</p>}
            <button
              className="btn-primary"
              disabled={!pos || chosen.length === 0}
              onClick={() => {
                const tg = pos && targetFromReference(swing, pos, chosen);
                if (tg) onPick(tg);
              }}
            >
              {t('training.pick.useThis')}
            </button>
            <button
              className="btn-ghost"
              onClick={() => {
                setSwing(null);
                setPos(null);
              }}
            >
              {t('common.back')}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
