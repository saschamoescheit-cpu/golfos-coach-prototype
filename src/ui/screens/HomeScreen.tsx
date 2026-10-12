import { APP_NAME, MODULE_NAME } from '../../coach/model/constants';
import { t } from '../../coach/i18n/i18n';
import { go, type ScreenName } from '../nav';

const TILES: { ico: string; key: string; to: ScreenName; primary?: boolean }[] = [
  { ico: '🎥', key: 'analyze', to: 'capture', primary: true },
  { ico: '🎯', key: 'train', to: 'training' },
  { ico: '📈', key: 'history', to: 'history' },
  { ico: '🔍', key: 'diagnose', to: 'diagnose' },
];

export function HomeScreen() {
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
