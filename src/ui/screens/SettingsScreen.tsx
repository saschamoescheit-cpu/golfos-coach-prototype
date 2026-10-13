import { useEffect, useState } from 'react';
import { levelFromHandicap } from '../../coach/faults/score';
import { num, setLang, t, useLang } from '../../coach/i18n/i18n';
import { ALL_SHOT_TYPES, ALL_VIEWS, APP_NAME, MODULE_NAME } from '../../coach/model/constants';
import type { Handedness, Lang, ScoreLevel } from '../../coach/model/types';
import { getStore } from '../../coach/storage';
import { formatBytes, isStandalone, requestPersist, storageInfo, type StorageInfo } from '../../coach/storage/device';
import { loadSettings, resetSettingsCache, updateSettings, useSettings } from '../../coach/storage/settings';
import { HistoryConfirmSheet } from '../components/HistoryConfirmSheet';
import { clampHeight, clampTolerance, handicapInput, levelInfos, parseHandicap, TOLERANCE_MAX, TOLERANCE_MIN } from '../components/SettingsModel';
import { TopBar } from '../components/TopBar';
import type { Route } from '../nav';
import '../styles/history.css';

const LANGS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'de', label: 'Deutsch' },
];

/** Settings (work package G). Every change is saved immediately – no save button. */
export function SettingsScreen(_props: { route: Route }) {
  const s = useSettings();
  const lang = useLang();

  return (
    <div className="screen settings">
      <TopBar title={t('settings.title')} />

      <section className="settings-section">
        <h2>{t('settings.language')}</h2>
        <div className="segmented">
          {LANGS.map((l) => (
            <button
              key={l.id}
              lang={l.id}
              aria-pressed={lang === l.id}
              onClick={() => {
                setLang(l.id);
                void updateSettings({ lang: l.id });
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2>{t('settings.game.title')}</h2>
        <div className="field">
          <label>{t('settings.game.handedness')}</label>
          <div className="segmented">
            {(['right', 'left'] as Handedness[]).map((h) => (
              <button key={h} aria-pressed={s.handedness === h} onClick={() => void updateSettings({ handedness: h })}>
                {t(`common.hand.${h}`)}
              </button>
            ))}
          </div>
        </div>
        <HandicapField />
        <ScoreLevelPicker />
        <div className="field">
          <label htmlFor="height">{t('settings.game.height')}</label>
          <div className="stepper">
            <button aria-label={t('settings.game.minus')} onClick={() => void updateSettings({ heightCm: clampHeight(s.heightCm - 1) })}>
              −
            </button>
            <HeightInput value={s.heightCm} />
            <span className="muted">{t('settings.game.cm')}</span>
            <button aria-label={t('settings.game.plus')} onClick={() => void updateSettings({ heightCm: clampHeight(s.heightCm + 1) })}>
              +
            </button>
          </div>
          <span className="muted small">{t('settings.game.heightHint')}</span>
        </div>
      </section>

      <section className="settings-section">
        <h2>{t('settings.defaults.title')}</h2>
        <div className="field">
          <label>{t('settings.defaults.shotType')}</label>
          <div className="choice-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            {ALL_SHOT_TYPES.map((x) => (
              <button key={x} className="choice" aria-pressed={s.defaultShotType === x} onClick={() => void updateSettings({ defaultShotType: x })}>
                {t(`common.shot.${x}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>{t('settings.defaults.view')}</label>
          <div className="segmented">
            {ALL_VIEWS.map((v) => (
              <button key={v} aria-pressed={s.defaultView === v} onClick={() => void updateSettings({ defaultView: v })}>
                {t(`common.viewShort.${v}`)}
              </button>
            ))}
          </div>
        </div>
        <span className="muted small">{t('settings.defaults.hint')}</span>
      </section>

      <section className="settings-section">
        <h2>{t('settings.training.title')}</h2>
        <div className="range-row">
          <div className="settings-row" style={{ minHeight: 0 }}>
            <label className="grow" htmlFor="tol">
              {t('settings.training.tolerance')}
            </label>
            <strong>{t('settings.training.toleranceValue', { x: num(s.toleranceScale, 1) })}</strong>
          </div>
          <input
            id="tol"
            type="range"
            min={TOLERANCE_MIN}
            max={TOLERANCE_MAX}
            step={0.1}
            value={s.toleranceScale}
            onChange={(e) => void updateSettings({ toleranceScale: clampTolerance(Number(e.target.value)) })}
          />
          <div className="ends">
            <span>{t('settings.training.stricter')}</span>
            <span>{t('settings.training.forgiving')}</span>
          </div>
          <span className="muted small">{t('settings.training.toleranceHint')}</span>
        </div>
        <div className="settings-row">
          <span className="grow">
            <span>{t('settings.training.sound')}</span>
            <span className="muted small">{t('settings.training.soundHint')}</span>
          </span>
          <button
            className="switch"
            role="switch"
            aria-checked={s.sound}
            aria-label={`${t('settings.training.sound')}: ${s.sound ? t('settings.training.on') : t('settings.training.off')}`}
            onClick={() => void updateSettings({ sound: !s.sound })}
          />
        </div>
      </section>

      <StorageSection />

      <section className="settings-section">
        <h2>{t('settings.about.title')}</h2>
        <p style={{ margin: 0 }}>
          <strong>
            {APP_NAME} {MODULE_NAME}
          </strong>{' '}
          · {t('settings.about.version', { v: __APP_VERSION__ })}
          <br />
          <span className="muted small">{t('settings.about.build', { d: __BUILD_TIME__.slice(0, 16).replace('T', ' ') })}</span>
        </p>
        <p className="muted small" style={{ margin: 0 }}>
          {t('settings.about.offline')}
        </p>
        <p className="card small" style={{ margin: 0 }}>
          {t('settings.about.prototype')}
        </p>
      </section>
    </div>
  );
}

function HeightInput({ value }: { value: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      id="height"
      className="input"
      inputMode="numeric"
      value={text}
      onChange={(e) => setText(e.target.value.replace(/\D/g, '').slice(0, 3))}
      onBlur={() => {
        const n = Number(text);
        if (text && Number.isFinite(n)) void updateSettings({ heightCm: clampHeight(n) });
        else setText(String(value));
      }}
    />
  );
}

function HandicapField() {
  const s = useSettings();
  const lang = useLang();
  const [plus, setPlus] = useState((s.handicap ?? 0) < 0);
  const [text, setText] = useState(handicapInput(s.handicap, lang));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(handicapInput(s.handicap, lang));
    setPlus((s.handicap ?? 0) < 0);
  }, [s.handicap, lang]);

  const commit = (txt: string, isPlus: boolean) => {
    const v = parseHandicap(txt, isPlus);
    if (v === 'invalid') return setInvalid(true);
    setInvalid(false);
    void updateSettings({ handicap: v });
  };

  return (
    <div className="field">
      <label htmlFor="hcp">{t('settings.handicap.label')}</label>
      <div className="settings-row" style={{ minHeight: 0 }}>
        <input
          id="hcp"
          className="input"
          style={{ flex: 1 }}
          inputMode="decimal"
          placeholder={t('settings.handicap.placeholder')}
          value={text}
          aria-invalid={invalid}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => commit(text, plus)}
        />
        <button
          className="choice"
          style={{ flex: 'none' }}
          aria-pressed={plus}
          onClick={() => {
            setPlus(!plus);
            commit(text, !plus);
          }}
        >
          + {t('settings.handicap.plusLabel')}
          <small>{t('settings.handicap.plusHint')}</small>
        </button>
      </div>
      {invalid && <span className="small status-bad">✕ {t('settings.handicap.invalid')}</span>}
    </div>
  );
}

function ScoreLevelPicker() {
  const s = useSettings();
  const chosen = s.scoreLevel ?? 'auto';
  const autoLevel = levelFromHandicap(s.handicap);
  const hasHcp = s.handicap !== null && s.handicap !== undefined;
  const range = (l: ReturnType<typeof levelInfos>[number]) =>
    l.from === null ? t('settings.level.rangeFirst', { to: num(l.to) }) : t('settings.level.range', { from: num(l.from), to: num(l.to) });
  return (
    <div className="field">
      <label>{t('settings.level.title')}</label>
      <div className="level-grid">
        <button className="choice" aria-pressed={chosen === 'auto'} onClick={() => void updateSettings({ scoreLevel: 'auto' })}>
          {t('settings.level.auto')}
          <small>{t('settings.level.n', { n: autoLevel })}</small>
        </button>
        {levelInfos().map((l) => (
          <button key={l.level} className="choice" aria-pressed={chosen === l.level} onClick={() => void updateSettings({ scoreLevel: l.level as ScoreLevel })}>
            {t('settings.level.n', { n: l.level })}
            <small>
              {t(`settings.level.name.${l.level}`)} · {range(l)}
            </small>
          </button>
        ))}
      </div>
      <span className="muted small">
        {chosen === 'auto' && <>{hasHcp ? t('settings.level.autoFrom', { n: autoLevel }) : t('settings.level.autoNoHcp', { n: autoLevel })}. </>}
        {t('settings.level.explain')}
      </span>
    </div>
  );
}

function StorageSection() {
  const [kind, setKind] = useState<'indexeddb' | 'memory' | null>(null);
  const [info, setInfo] = useState<StorageInfo>({});
  const [persistMsg, setPersistMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const lang = useLang();

  const refresh = async () => {
    const store = await getStore();
    setKind(store.kind);
    setInfo(await storageInfo());
  };
  useEffect(() => {
    void refresh();
  }, []);

  const persist = async () => {
    const r = await requestPersist();
    setPersistMsg(r === undefined ? t('settings.storage.persistUnsupported') : r ? null : t('settings.storage.persistDenied'));
    await refresh();
  };

  const deleteAll = async () => {
    const store = await getStore();
    const keepLang = lang;
    await store.clearAll?.();
    resetSettingsCache();
    await loadSettings();
    await updateSettings({ lang: keepLang }); // keep the language the player is reading right now
    setConfirm(false);
    setDeleted(true);
    await refresh();
  };

  const usage = info.usage !== undefined ? formatBytes(info.usage, lang) : null;
  const quota = info.quota ? formatBytes(info.quota, lang) : null;

  return (
    <section className="settings-section">
      <h2>{t('settings.storage.title')}</h2>
      <p className="muted small" style={{ margin: 0 }}>
        {t('settings.storage.where')}
      </p>
      {kind && (
        <p className={`small ${kind === 'indexeddb' ? 'status-ok' : 'card hint-bad'}`} style={{ margin: 0 }}>
          {kind === 'indexeddb' ? t('settings.storage.savedOk') : t('settings.storage.savedNo')}
        </p>
      )}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="small">{usage ? (quota ? t('settings.storage.usedOf', { used: usage, quota }) : t('settings.storage.used', { used: usage })) : t('settings.storage.unknown')}</span>
        {info.usage !== undefined && info.quota ? (
          <div className="storage-meter" aria-hidden="true">
            <span style={{ width: `${Math.max(1, Math.min(100, (info.usage / info.quota) * 100))}%` }} />
          </div>
        ) : null}
        {kind === 'indexeddb' && (
          <>
            <span className={`small ${info.persisted ? 'status-ok' : 'muted'}`}>{info.persisted ? t('settings.storage.persisted') : t('settings.storage.notPersisted')}</span>
            {!info.persisted && (
              <>
                <span className="muted small">{t('settings.storage.persistWhy')}</span>
                <button className="btn-secondary" onClick={() => void persist()}>
                  {t('settings.storage.persistButton')}
                </button>
              </>
            )}
            {persistMsg && <span className="small status-warn">{persistMsg}</span>}
          </>
        )}
      </div>
      {!isStandalone() && <p className="muted small" style={{ margin: 0 }}>{t('settings.storage.homeScreen')}</p>}
      {deleted && <p className="small status-ok" style={{ margin: 0 }}>{t('settings.storage.deleted')}</p>}
      <button className="btn-secondary btn-danger" onClick={() => setConfirm(true)}>
        {t('settings.storage.deleteAll')}
      </button>
      {confirm && (
        <HistoryConfirmSheet
          title={t('settings.storage.deleteTitle')}
          text={t('settings.storage.deleteText')}
          okLabel={t('settings.storage.deleteOk')}
          danger
          onOk={() => void deleteAll()}
          onCancel={() => setConfirm(false)}
        />
      )}
    </section>
  );
}
