import { useEffect, useState } from 'react';
import { APP_NAME, MODULE_NAME } from '../../coach/model/constants';
import { t } from '../../coach/i18n/i18n';
import type { Swing } from '../../coach/model/types';
import { getStore } from '../../coach/storage';
import { levelFromSettings } from '../../coach/faults/score';
import { displayScore } from '../../coach/storage/scoreHistory';
import { useSettings } from '../../coach/storage/settings';
import { faultName, formatWhen, topFault } from '../components/HistoryModel';
import { go, type ScreenName } from '../nav';
import { ScoreBadge } from './HistoryScreen';
import '../styles/history.css';

const TILES: { ico: string; key: string; to: ScreenName; primary?: boolean }[] = [
  { ico: '🎥', key: 'analyze', to: 'capture', primary: true },
  { ico: '🎯', key: 'train', to: 'training' },
  { ico: '📈', key: 'history', to: 'history' },
  { ico: '🔍', key: 'diagnose', to: 'diagnose' },
];

export function HomeScreen() {
  const [latest, setLatest] = useState<Swing | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void getStore()
      .then((s) => s.listSwings({ limit: 1 }))
      .then((l) => alive && setLatest(l[0] ?? null))
      .catch(() => alive && setLatest(null));
    return () => {
      alive = false;
    };
  }, []);

  // score on the CURRENT level, like Analysis/History/Compare (review W7)
  const level = levelFromSettings(useSettings());
  const f = latest ? topFault(latest) : undefined;
  const uncertain = latest && !f && latest.checkedFaultIds.length === 0;

  return (
    <div className="screen">
      <div className="topbar">
        <div className="brand" style={{ flex: 1 }}>
          {APP_NAME} <span>{MODULE_NAME}</span>
        </div>
        <button className="icon-btn" onClick={() => go('settings')} aria-label={t('common.home.settings')}>
          ⚙
        </button>
      </div>

      {latest === null && <p className="muted" style={{ margin: 0 }}>{t('common.home.welcome')}</p>}

      {latest && (
        <button className="card home-latest" onClick={() => go('analysis', { swingId: latest.id })}>
          <ScoreBadge score={displayScore(latest, level)?.total} level={level} />
          <span className="grow">
            <span className="eyebrow">{t('common.home.latest')}</span>
            <span className={`title${f ? '' : uncertain ? ' muted' : ' status-ok'}`}>
              {f ? t('common.home.workOn', { fault: faultName(f.defId) }) : uncertain ? t('common.home.notReliable') : t('common.home.noFault')}
            </span>
            <span className="small muted">
              {formatWhen(latest.createdAt)} · {t(`common.shot.${latest.shotType}`)}
            </span>
          </span>
          <span className="muted" aria-hidden="true" style={{ fontSize: 22 }}>
            ›
          </span>
        </button>
      )}

      <div className="home-tiles">
        {TILES.map((x) => (
          <button key={x.key} className={`home-tile${x.primary ? ' primary' : ''}`} onClick={() => go(x.to)}>
            <span className="ico">{x.ico}</span>
            <span>
              <span className="t">{t(`common.home.${x.key}`)}</span>
              <span className="s">{t(`common.home.${x.key}Sub`)}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="spacer" />
      <p className="muted small">
        {t('common.home.prototype')} · {__BUILD_TIME__.slice(0, 16).replace('T', ' ')}
      </p>
    </div>
  );
}
