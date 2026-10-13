import { useEffect, useMemo, useState } from 'react';
import { loc, t } from '../../coach/i18n/i18n';
import type { BallFlight, Swing } from '../../coach/model/types';
import { getStore } from '../../coach/storage';
import { getBallFlight, getFaultDef } from '../../coach/faults/catalog';
import { ballFlightGroups, diagnose, MIN_SWINGS_FOR_DIAGNOSIS, type DiagnosisCause } from '../../coach/faults/diagnosis';
import { go, type Route } from '../nav';
import { TopBar } from '../components/TopBar';
import { DrillSheet } from '../components/DrillSheet';
import { isTrainable } from '../../coach/training/targets';
import '../styles/faults.css';

/** Swings considered for the personal ranking (most recent first). */
const HISTORY_LIMIT = 100;

function CauseCard({ c, rank }: { c: DiagnosisCause; rank: number }) {
  const [open, setOpen] = useState(false);
  const [drills, setDrills] = useState(false);
  const def = getFaultDef(c.faultId);
  if (!def) return null;
  const freq =
    c.frequency === null
      ? t('diagnose.notChecked', { view: c.views.map((v) => t(`common.view.${v}`)).join(' / ') })
      : c.detected > 0
        ? t('diagnose.frequency', { d: c.detected, c: c.checked })
        : t('diagnose.notFound');
  return (
    <div className="fx-fault">
      <div className="fx-fault-head" style={{ cursor: 'default' }}>
        <span className="rank">{rank}</span>
        <h3>{loc(c.text)}</h3>
      </div>
      <div className={`fx-cause-freq ${c.detected > 0 ? 'fx-bad' : 'fx-grey'}`}>
        {c.detected > 0 ? '✕ ' : ''}
        {freq}
      </div>
      <div className="fx-muted">{loc(def.name)}</div>
      {open && (
        <div className="fx-dl">
          <div className="fx-benefit">{loc(def.benefit)}</div>
          <div>
            <span className="lbl">{t('faults.card.correction')}</span>
            {loc(def.correction)}
          </div>
        </div>
      )}
      <div className="fx-actions">
        <button className="btn-secondary" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? t('diagnose.hideCorrection') : t('diagnose.showCorrection')}
        </button>
        {isTrainable(def) && (
          <button className="btn-primary" onClick={() => go('training', { faultId: c.faultId })}>
            {t('diagnose.train')}
          </button>
        )}
      </div>
      {open && (
        <button className="btn-ghost" onClick={() => setDrills(true)}>
          {t('faults.card.drills')}
        </button>
      )}
      {drills && <DrillSheet faultId={c.faultId} onClose={() => setDrills(false)} />}
    </div>
  );
}

/** "My miss" → likely causes in my swings (US-1.12). Optional params.flight preselects a ball flight. */
export function DiagnoseScreen({ route }: { route: Route }) {
  const [flight, setFlight] = useState<BallFlight | null>((route.params.flight as BallFlight) ?? null);
  const [history, setHistory] = useState<Swing[]>([]);

  useEffect(() => {
    let alive = true;
    getStore()
      .then((s) => s.listSwings({ limit: HISTORY_LIMIT }))
      .then((list) => alive && setHistory(list))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const result = useMemo(() => (flight ? diagnose(flight, history) : null), [flight, history]);

  if (!flight || !result)
    return (
      <div className="screen">
        <TopBar title={t('diagnose.title')} />
        <p className="muted">{t('diagnose.intro')}</p>
        {ballFlightGroups().map((g) => (
          <div key={g.group} className="fx-section">
            <h2>{t(`diagnose.group.${g.group}`)}</h2>
            <div className="fx-flights">
              {g.flights.map((b) => (
                <button key={b.id} className="fx-flight" onClick={() => setFlight(b.id)}>
                  <span className="t">{loc(b.name)}</span>
                  <span className="s">{loc(b.what)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    );

  const def = getBallFlight(flight)!;
  return (
    <div className="screen">
      <TopBar title={loc(def.name)} />
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div>{loc(def.what)}</div>
        <div className="fx-muted">
          <strong>{t('diagnose.physics')}:</strong> {loc(def.physics)}
        </div>
      </div>
      <button className="btn-secondary" onClick={() => setFlight(null)} style={{ marginTop: 10 }}>
        {t('diagnose.change')}
      </button>

      <div className="fx-section">
        <h2>{t('diagnose.causesTitle')}</h2>
        <div className="fx-muted">
          {result.enoughData ? t('diagnose.basedOn', { n: result.swings }) : t('diagnose.noData', { n: MIN_SWINGS_FOR_DIAGNOSIS })}
        </div>
        {result.enoughData && result.top.every((c) => c.detected === 0) && <div className="fx-muted">{t('diagnose.noneOccurring')}</div>}
        {result.top.map((c, i) => (
          <CauseCard key={c.faultId} c={c} rank={i + 1} />
        ))}
      </div>

      {result.unmeasurable.length > 0 && (
        <div className="fx-section">
          <h2>{t('diagnose.unmeasurableTitle')}</h2>
          <div className="fx-muted">{t('diagnose.unmeasurableIntro')}</div>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {result.unmeasurable.map((c, i) => (
              <li key={i}>{loc(c.text)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
