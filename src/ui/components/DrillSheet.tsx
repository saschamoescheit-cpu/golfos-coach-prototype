import { useEffect } from 'react';
import { loc, t } from '../../coach/i18n/i18n';
import { drillsFor, getFaultDef } from '../../coach/faults/catalog';
import type { Handedness } from '../../coach/model/types';
import '../styles/faults.css';

/** Drills of one fault as a bottom sheet (US-1.5: placeholder tiles, "video / tutorial follows"). */
/** handedness: side words in the texts ({lead}, {right} …) – default: settings. */
export function DrillSheet({ faultId, onClose, handedness }: { faultId: string; onClose: () => void; handedness?: Handedness }) {
  const L = (x: Parameters<typeof loc>[0]) => loc(x, undefined, handedness);
  const def = getFaultDef(faultId);
  const drills = drillsFor(faultId);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fx-sheet-backdrop" onClick={onClose} role="presentation">
      <div className="fx-sheet" role="dialog" aria-modal="true" aria-label={t('faults.drills.title')} onClick={(e) => e.stopPropagation()}>
        <div className="fx-sheet-head">
          <h2>
            {t('faults.drills.title')}: {L(def?.name)}
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('faults.drills.close')}>
            ✕
          </button>
        </div>
        {drills.map((d) => (
          <div key={d.id} className="fx-drill">
            <div className="eyebrow">{t(d.kind === 'feel' ? 'faults.drills.feel' : 'faults.drills.real')}</div>
            <h3 style={{ margin: 0 }}>{L(d.name)}</h3>
            <div className="fx-ph">▶ {t('faults.drills.placeholder')}</div>
            <div className="fx-dl">
              <div>
                <span className="lbl">{t('faults.drills.goal')}</span>
                {L(d.goal)}
              </div>
              <div>
                <span className="lbl">{t('faults.drills.equipment')}</span>
                {L(d.equipment)}
              </div>
              <div>
                <span className="lbl">{t('faults.drills.steps')}</span>
                <ol>
                  {d.steps.map((s, i) => (
                    <li key={i}>{L(s)}</li>
                  ))}
                </ol>
              </div>
              <div>
                <span className="lbl">{t('faults.drills.reps')}</span>
                {L(d.reps)}
              </div>
            </div>
            {d.draft && <div className="fx-muted">{t('faults.drills.draft')}</div>}
          </div>
        ))}
        <button className="btn-secondary" onClick={onClose}>
          {t('faults.drills.close')}
        </button>
      </div>
    </div>
  );
}
