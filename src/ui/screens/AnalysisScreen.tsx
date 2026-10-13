import { useCallback, useEffect, useMemo, useState } from 'react';
import { loc, num, t } from '../../coach/i18n/i18n';
import { QUALITY_MIN, SHOT_TYPES } from '../../coach/model/constants';
import type { Fault, KeyPosition, Swing, SwingScore } from '../../coach/model/types';
import { getStore } from '../../coach/storage';
import { classifyValues, getFaultDef, skeletonStatus, topFaults } from '../../coach/faults/engine';
import { formatValue, metricName, positionName } from '../../coach/faults/format';
import { levelFromSettings, rescore } from '../../coach/faults/score';
import { go, type Route } from '../nav';
import { TopBar } from '../components/TopBar';
import { SwingPlayer } from '../components/SwingPlayer';
import { FaultCard } from '../components/FaultCard';
import { ScoreCard } from '../components/ScoreCard';
import '../styles/faults.css';

const STATUS_SYMBOL = { ok: '✓', bad: '✕', info: '·', uncertain: '?' } as const;
const STATUS_CLASS = { ok: 'fx-ok', bad: 'fx-bad', info: 'fx-grey', uncertain: 'fx-warn' } as const;

/** Analysis result (US-1.3, 1.4, 1.5, 1.6, 1.13). params.swingId */
export function AnalysisScreen({ route }: { route: Route }) {
  const swingId = route.params.swingId;
  const [swing, setSwing] = useState<Swing | null | undefined>(undefined);
  const [videoUrl, setVideoUrl] = useState<string | undefined>();
  const [score, setScore] = useState<SwingScore | null>(null);
  const [seekTo, setSeekTo] = useState<KeyPosition | undefined>();
  const [showValues, setShowValues] = useState(false);

  useEffect(() => {
    let url: string | undefined;
    let alive = true;
    (async () => {
      const store = await getStore();
      const s = swingId ? await store.getSwing(swingId) : undefined;
      if (!alive) return;
      setSwing(s ?? null);
      if (!s) return;
      // show the score on the player's current level (stored raw criteria → rescore, spec 4.5)
      let sc = s.score;
      try {
        const level = levelFromSettings(await store.getSettings());
        if (sc && sc.criteria && sc.level !== level) sc = rescore(sc, s, { level });
      } catch {
        /* settings unavailable – keep stored score */
      }
      if (alive) setScore(sc);
      if (s.videoKey) {
        const blob = await store.getVideo(s.videoKey);
        if (blob && alive && typeof URL !== 'undefined') {
          url = URL.createObjectURL(blob);
          setVideoUrl(url);
        }
      }
    })();
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [swingId]);

  const lineStatus = useCallback((i: number) => (swing ? skeletonStatus(swing, i) : {}), [swing]);
  const shown = useMemo(() => (swing ? topFaults(swing.faults) : []), [swing]);
  const values = useMemo(() => (swing ? classifyValues(swing) : []), [swing]);

  if (swing === undefined)
    return (
      <div className="screen">
        <TopBar title={t('analysis.title')} />
        <p className="muted">{t('analysis.loading')}</p>
      </div>
    );
  if (swing === null)
    return (
      <div className="screen">
        <TopBar title={t('analysis.title')} />
        <p>{t('analysis.notFound')}</p>
      </div>
    );

  const lowQuality = swing.quality.score < QUALITY_MIN;
  const tempo = swing.metrics.values.find((v) => v.id === 'tempo_ratio' && v.at === 'swing');
  const tempoCfg = SHOT_TYPES[swing.shotType].tempo;
  const full = swing.shotType === 'driver' || swing.shotType === 'iron' || swing.shotType === 'bunker';
  const tempoState = tempo
    ? tempo.value < tempoCfg.target - tempoCfg.tolerance
      ? 'fast'
      : tempo.value > tempoCfg.target + tempoCfg.tolerance
        ? 'slow'
        : 'ok'
    : null;

  const seek = (f: Fault) => {
    setSeekTo(undefined);
    // re-trigger even when the same position is tapped twice
    setTimeout(() => setSeekTo(f.marker), 0);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const train = (f: Fault) => go('training', { faultId: f.defId, swingId: swing.id });

  return (
    <div className="screen">
      <TopBar title={t('analysis.title')} />
      <div className="muted small">
        {t(`common.shot.${swing.shotType}`)} · {t(`common.view.${swing.view}`)}
      </div>
      <SwingPlayer
        swing={swing}
        videoUrl={videoUrl}
        seekTo={seekTo}
        lineStatus={lineStatus}
        onManualLineChange={(line) => {
          // visual marker only (decision 06.10.2026) – stored with the swing, never used for metrics
          const next = { ...swing, manualNeutralLine: line };
          setSwing(next);
          getStore().then((st) => st.saveSwing(next)).catch(() => {});
        }}
      />
      {!swing.videoKey && <div className="fx-muted">{t('analysis.noVideo')}</div>}

      {lowQuality && (
        <div className="fx-quality fx-section">
          <h2>⚠ {t('analysis.quality.title')}</h2>
          <div>{t('analysis.quality.intro')}</div>
          {swing.quality.issues.length > 0 && (
            <div>
              <strong>{t('analysis.quality.reasons')}</strong>
              <ul>
                {swing.quality.issues.map((i) => (
                  <li key={i}>{t(`analysis.quality.issue.${i}`)}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <strong>{t('analysis.quality.tipsTitle')}</strong>
            <ul>
              {['t1', 't2', 't3', 't4', 't5'].map((k) => (
                <li key={k}>{t(`analysis.quality.tips.${k}`)}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {!lowQuality && score && (
        <div className="fx-section">
          <ScoreCard score={score} />
        </div>
      )}

      {tempo && (
        <div className="fx-section">
          <div className="fx-tempo">
            <span className="big">
              {t('analysis.tempo.line', { v: num(tempo.value, 1) })}{' '}
              <span className="fx-muted">
                {full ? t('analysis.tempo.ref', { t: num(tempoCfg.target, 0) }) : t('analysis.tempo.refShort', { t: num(tempoCfg.target, 0) })}
              </span>{' '}
              <span className={tempoState === 'ok' ? 'fx-ok' : 'fx-bad'}>{tempoState === 'ok' ? '✓' : '✕'}</span>
            </span>
            <span className="fx-muted">{t(`analysis.tempo.${tempoState}`)}</span>
          </div>
        </div>
      )}

      {!lowQuality && (
        <div className="fx-section">
          <h2>{t('analysis.faults.title')}</h2>
          {shown.length === 0 ? (
            <p className="fx-ok">✓ {t('analysis.faults.none')}</p>
          ) : (
            <>
              <div className="fx-muted">{t('analysis.faults.count', { n: swing.faults.length, m: swing.checkedFaultIds.length })}</div>
              {shown.map((f, i) => (
                <FaultCard key={f.defId} fault={f} rank={i + 1} onShow={seek} onTrain={train} handedness={swing.handedness} />
              ))}
            </>
          )}
        </div>
      )}

      {values.length > 0 && (
        <div className="fx-section">
          <button className="btn-secondary" onClick={() => setShowValues(!showValues)} aria-expanded={showValues}>
            {showValues ? t('analysis.values.hide') : t('analysis.values.show')}
          </button>
          {showValues && (
            <div className="fx-values">
              {values.map(({ value, status }) => (
                <div key={`${value.id}@${value.at}`} className="fx-value">
                  <span>{metricName(value.id)}</span>
                  <span className={STATUS_CLASS[status]}>
                    {formatValue(value.value, value.unit)} {STATUS_SYMBOL[status]}
                  </span>
                  <span className="sub">
                    {positionName(value.at)} · {t(`analysis.values.${status}`)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {swing.uncertainFaultIds.length > 0 && (
        <div className="fx-section">
          <h2>{t('analysis.uncertain.title')}</h2>
          <div className="fx-muted">{t('analysis.uncertain.intro')}</div>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {swing.uncertainFaultIds.map((id) => (
              <li key={id}>
                <span className="fx-warn">?</span> {loc(getFaultDef(id)?.name) || id}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
