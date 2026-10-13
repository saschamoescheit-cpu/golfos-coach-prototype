import { useState } from 'react';
import { loc, t } from '../../coach/i18n/i18n';
import { getFaultDef } from '../../coach/faults/catalog';
import { formatValue, metricName, positionName, unitOf } from '../../coach/faults/format';
import type { Fault, Handedness } from '../../coach/model/types';
import { isTrainable } from '../../coach/training/targets';
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
  handedness,
}: {
  fault: Fault;
  rank?: number;
  onShow?: (fault: Fault) => void;
  onTrain?: (fault: Fault) => void;
  /** the swing's handedness for side words in the texts (default: settings) */
  handedness?: Handedness;
}) {
  const L = (x: Parameters<typeof loc>[0]) => loc(x, undefined, handedness);
  const [drills, setDrills] = useState(false);
  const def = getFaultDef(fault.defId);
  if (!def) return null;
  return (
    <div className="fx-fault">
      <button className="fx-fault-head" onClick={() => onShow?.(fault)} aria-label={`${L(def.name)} – ${t('faults.card.show')}`}>
        {rank !== undefined && <span className="rank">{rank}</span>}
        <h3>{L(def.name)}</h3>
        <span className="fx-muted">▶ {positionName(def.marker)}</span>
      </button>
      <div className="fx-benefit">{L(def.benefit)}</div>
      <div className="fx-dl">
        <div>
          <span className="lbl">{t('faults.card.effect')}</span>
          {L(def.ballEffect)}
        </div>
        <div>
          <span className="lbl">{t('faults.card.cause')}</span>
          {L(def.cause)}
        </div>
        <div>
          <span className="lbl">{t('faults.card.correction')}</span>
          {L(def.correction)}
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
        {onTrain && isTrainable(def) && (
          <button className="btn-primary" onClick={() => onTrain(fault)}>
            {t('faults.card.train')}
          </button>
        )}
      </div>
      {drills && <DrillSheet faultId={fault.defId} onClose={() => setDrills(false)} handedness={handedness} />}
    </div>
  );
}
