import { useState } from 'react';
import { loc, t } from '../../coach/i18n/i18n';
import { getFaultDef } from '../../coach/faults/catalog';
import { formatValue, metricName, positionName, unitOf } from '../../coach/faults/format';
import type { Fault } from '../../coach/model/types';
import { DrillSheet } from './DrillSheet';
import '../styles/faults.css';

/**
 * One correction card (US-1.4): title, benefit prominent, ball effect, cause, correction, Drills, "Train this".
 * Tapping the title jumps the video to the fault's key position.
 */
export function FaultCard({
  fault,
  rank,
  onShow,
  onTrain,
}: {
  fault: Fault;
  rank?: number;
  onShow?: (fault: Fault) => void;
  onTrain?: (fault: Fault) => void;
}) {
  const [drills, setDrills] = useState(false);
  const def = getFaultDef(fault.defId);
  if (!def) return null;
  return (
    <div className="fx-fault">
      <button className="fx-fault-head" onClick={() => onShow?.(fault)} aria-label={`${loc(def.name)} – ${t('faults.card.show')}`}>
        {rank !== undefined && <span className="rank">{rank}</span>}
        <h3>{loc(def.name)}</h3>
        <span className="fx-muted">▶ {positionName(def.marker)}</span>
      </button>
      <div className="fx-benefit">{loc(def.benefit)}</div>
      <div className="fx-dl">
        <div>
          <span className="lbl">{t('faults.card.effect')}</span>
          {loc(def.ballEffect)}
        </div>
        <div>
          <span className="lbl">{t('faults.card.cause')}</span>
          {loc(def.cause)}
        </div>
        <div>
          <span className="lbl">{t('faults.card.correction')}</span>
          {loc(def.correction)}
        </div>
        {fault.measured.length > 0 && (
          <div className="fx-muted">
            {fault.measured.map((m) => (
              <div key={`${m.metric}@${m.at}`}>
                {metricName(m.metric)} ({positionName(m.at)}):{' '}
                {t('faults.card.measured', { v: formatValue(m.value, unitOf(m.metric)), t: formatValue(m.threshold, unitOf(m.metric)) })}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="fx-actions">
        <button className="btn-secondary" onClick={() => setDrills(true)}>
          {t('faults.card.drills')}
        </button>
        <button className="btn-primary" onClick={() => onTrain?.(fault)}>
          {t('faults.card.train')}
        </button>
      </div>
      {drills && <DrillSheet faultId={fault.defId} onClose={() => setDrills(false)} />}
    </div>
  );
}
