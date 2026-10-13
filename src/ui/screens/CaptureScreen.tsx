import { useEffect, useRef, useState } from 'react';
import { buildSwing } from '../../coach/analysis/analyze';
import type { AnalysisContext } from '../../coach/analysis/context';
import { t } from '../../coach/i18n/i18n';
import { cameraSupported } from '../../coach/live/camera';
import { ClipRecorder } from '../../coach/live/recorder';
import { ALL_SHOT_TYPES, ALL_VIEWS } from '../../coach/model/constants';
import type { CameraView, Handedness, Session, ShotType } from '../../coach/model/types';
import { analyzeVideo, reanalyze, VideoAnalysisError, type VideoAnalysisOutput, type VideoStage } from '../../coach/pipeline/videoAnalysis';
import { getStore } from '../../coach/storage';
import { newId, persistSwing } from '../../coach/storage/save';
import { CaptureGuide } from '../components/CaptureGuide';
import { CaptureLive, type CapturedClip } from '../components/CaptureLive';
import { TopBar } from '../components/TopBar';
import { replace, type Route } from '../nav';
import '../styles/capture.css';

/**
 * Capture screen (US-1.0, brief B). OWNER: agent "capture-pose".
 * setup (shot type, view, handedness, camera guide) → live viewfinder with automatic recording, or upload
 * → analysis with progress → save → analysis screen.
 * Params: shotType?, view? (preselect).
 */
type Phase =
  | { k: 'setup' }
  | { k: 'live' }
  | { k: 'analysing'; stage: VideoStage; ratio: number }
  | { k: 'slowmo'; out: VideoAnalysisOutput; blob: Blob; source: 'live' | 'upload'; factor: number }
  | { k: 'error'; msg: string };

const STAGE_WEIGHT: Record<VideoStage, [number, number]> = {
  load: [0, 0.05],
  model: [0.05, 0.15],
  scan: [0.15, 0.35],
  pose: [0.35, 0.95],
  analyse: [0.95, 1],
};

export function CaptureScreen({ route }: { route: Route }) {
  const [shotType, setShotType] = useState<ShotType>((route.params.shotType as ShotType) ?? 'iron');
  const [view, setView] = useState<CameraView>((route.params.view as CameraView) ?? 'face_on');
  const [hand, setHand] = useState<Handedness>('right');
  const [phase, setPhase] = useState<Phase>({ k: 'setup' });
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const canCamera = cameraSupported();

  useEffect(() => {
    let alive = true;
    getStore()
      .then((s) => s.getSettings())
      .then((st) => {
        if (!alive) return;
        setHand(st.handedness);
        if (!route.params.shotType && st.defaultShotType) setShotType(st.defaultShotType);
        if (!route.params.view && st.defaultView) setView(st.defaultView);
      })
      .catch(() => {});
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, [route.params.shotType, route.params.view]);

  const ctx: AnalysisContext = { shotType, view, handedness: hand };

  const startCamera = async () => {
    // iOS asks for the motion sensor only from a tap (used for the "phone tilted" hint)
    const DOE = (globalThis as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    try {
      await DOE?.requestPermission?.();
    } catch {
      // no sensor permission → no tilt hint
    }
    if (!ClipRecorder.supported()) {
      setPhase({ k: 'error', msg: t('capture.error.noRecorder') });
      return;
    }
    setPhase({ k: 'live' });
  };

  const save = async (out: VideoAnalysisOutput, blob: Blob, source: 'live' | 'upload') => {
    const store = await getStore();
    const swingId = newId('swing');
    if (!sessionRef.current) {
      sessionRef.current = {
        id: newId('session'),
        createdAt: Date.now(),
        mode: 'analysis',
        shotType,
        view,
        handedness: hand,
        swingIds: [],
      };
    }
    const session = { ...sessionRef.current, swingIds: [...sessionRef.current.swingIds, swingId] };
    sessionRef.current = session;
    await persistSwing(buildSwing(out.result, { id: swingId, sessionId: session.id, ctx, source }), blob);
    try {
      await store.saveSession(session);
    } catch {
      // the swing is saved; a missing session row is not critical
    }
    replace('analysis', { swingId });
  };

  const analyse = async (blob: Blob, window: CapturedClip['window'], source: 'live' | 'upload') => {
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase({ k: 'analysing', stage: 'load', ratio: 0 });
    try {
      const out = await analyzeVideo(
        blob,
        ctx,
        (p) => setPhase({ k: 'analysing', stage: p.stage, ratio: p.ratio }),
        { window: window ?? undefined, signal: ac.signal },
      );
      if (ac.signal.aborted) return;
      if (out.slowMotionSuggested && source === 'upload') {
        setPhase({ k: 'slowmo', out, blob, source, factor: out.slowMotionSuggested });
        return;
      }
      await save(out, blob, source);
    } catch (e) {
      if (e instanceof VideoAnalysisError && e.code === 'aborted') {
        setPhase({ k: 'setup' });
        return;
      }
      const code = e instanceof VideoAnalysisError ? e.code : null;
      setPhase({ k: 'error', msg: code ? t(`capture.error.${code}`) : t('capture.error.generic', { msg: String((e as Error)?.message ?? e) }) });
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void analyse(f, null, 'upload');
  };
  const pickFile = () => fileRef.current?.click();

  const fileInput = <input ref={fileRef} className="capture-file" type="file" accept="video/*" onChange={onFile} tabIndex={-1} aria-hidden="true" />;

  if (phase.k === 'live')
    return (
      <>
        {fileInput}
        <CaptureLive
          ctx={ctx}
          onClip={(c) => void analyse(c.blob, c.window, 'live')}
          onUpload={pickFile}
          onClose={() => setPhase({ k: 'setup' })}
        />
      </>
    );

  if (phase.k === 'analysing') {
    const [a, b] = STAGE_WEIGHT[phase.stage];
    const pct = Math.round((a + (b - a) * phase.ratio) * 100);
    return (
      <div className="screen">
        <TopBar title={t('capture.title')} />
        <div className="capture-progress" aria-live="polite">
          <div className="stage">{t('capture.analysing')}</div>
          <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="muted">
            {t(`capture.stage.${phase.stage}`)} · {pct} %
          </div>
        </div>
        <button className="btn-secondary" onClick={() => abortRef.current?.abort()}>
          {t('capture.cancel')}
        </button>
      </div>
    );
  }

  if (phase.k === 'slowmo') {
    const { out, blob, source, factor } = phase;
    return (
      <div className="screen">
        <TopBar title={t('capture.slowmo.title')} />
        <div className="card capture-dialog">
          <p>{t('capture.slowmo.text', { f: factor })}</p>
          <button className="btn-primary" onClick={() => void save(reanalyze(out, ctx, factor), blob, source)}>
            {t('capture.slowmo.yes')} (×{factor})
          </button>
          <button className="btn-secondary" onClick={() => void save(out, blob, source)}>
            {t('capture.slowmo.no')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <TopBar title={t('capture.title')} />
      {fileInput}
      {phase.k === 'error' && (
        <div className="capture-note" role="alert">
          ✕ {phase.msg}
        </div>
      )}

      <section className="capture-section">
        <h2>{t('capture.shotType')}</h2>
        <div className="capture-choice-grid">
          {ALL_SHOT_TYPES.map((s) => (
            <button key={s} className="choice" aria-pressed={shotType === s} onClick={() => {
                setShotType(s);
                // putts can only be timed face-on (the putter moves along the camera axis from behind) – DECISIONS L3
                if (s === 'putt') setView('face_on');
              }}>
              {t(`common.shot.${s}`)}
            </button>
          ))}
        </div>
      </section>

      <section className="capture-section">
        <h2>{t('capture.view')}</h2>
        <div className="choice-grid">
          {ALL_VIEWS.map((v) => (
            <button key={v} className="choice" aria-pressed={view === v} onClick={() => setView(v)}>
              {t(`common.view.${v}`)}
              <small>{t(`capture.viewHint.${v}`)}</small>
            </button>
          ))}
        </div>
        {shotType === 'putt' && view === 'down_the_line' && <p className="muted small">⚠ {t('capture.puttFaceOn')}</p>}
      </section>

      <section className="capture-section">
        <h2>{t('capture.hand')}</h2>
        <div className="segmented">
          {(['right', 'left'] as Handedness[]).map((h) => (
            <button key={h} aria-pressed={hand === h} onClick={() => setHand(h)}>
              {t(`common.hand.${h}`)}
            </button>
          ))}
        </div>
      </section>

      <section className="capture-section">
        <h2>{t('capture.guideTitle')}</h2>
        <CaptureGuide view={view} mirror={hand === 'left'} />
      </section>

      <div className="capture-actions">
        {canCamera ? (
          <button className="btn-primary" onClick={startCamera}>
            🎥 {t('capture.startCamera')}
          </button>
        ) : (
          <div className="capture-note">{t('capture.noCamera')}</div>
        )}
        <button className={canCamera ? 'btn-secondary' : 'btn-primary'} onClick={pickFile}>
          ⬆ {t('capture.upload')}
        </button>
        <p className="muted small" style={{ margin: 0 }}>
          {t('capture.uploadSub')}
        </p>
      </div>
    </div>
  );
}
