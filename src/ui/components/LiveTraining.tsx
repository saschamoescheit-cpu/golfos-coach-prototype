import { useEffect, useMemo, useRef, useState } from 'react';
import { buildSwing } from '../../coach/analysis/analyze';
import type { AnalysisContext } from '../../coach/analysis/context';
import { criterionText, formatValue, metricName } from '../../coach/faults/format';
import { t } from '../../coach/i18n/i18n';
import { startErrorText } from './startError';
import { openCamera, type CameraHandle, type Facing } from '../../coach/live/camera';
import { startPoseLoop, type LiveFrame } from '../../coach/live/poseLoop';
import { ClipRecorder } from '../../coach/live/recorder';
import { SwingTrigger, type TriggerState } from '../../coach/live/swingTrigger';
import type { Landmark, PoseFrame, TrainingTarget } from '../../coach/model/types';
import { getPoseProviderFor } from '../../coach/pose/mediapipe';
import { newId, persistSwing } from '../../coach/storage/save';
import { getTrainingAudio } from '../../coach/training/audio';
import { alignGhost, ghostToRaw } from '../../coach/training/ghost';
import { evaluateLiveFrame, liveMetricsAvailable, mirrorCriteria, StillnessDetector } from '../../coach/training/live';
import { MirrorMachine, type MirrorState } from '../../coach/training/mirror';
import { modelGhost } from '../../coach/training/modelGhost';
import { colorForProximity, COLORS, type Evaluation } from '../../coach/training/proximity';
import { SeriesSession, shiftResult, type SeriesOutcome, type SeriesTally } from '../../coach/training/series';
import { drawTrainingOverlay } from './LiveOverlay';
import '../styles/training.css';

/**
 * Live camera view of the training mode (OWNER: agent "training").
 * Mirror: camera → pose (lite) → address reference (still) → per-frame proximity → MirrorMachine → tones + colours.
 * Series: camera → pose (lite) → SwingTrigger → SeriesSession ('impact' → judge → tone; 'swing' → save video + swing).
 * Wiring of camera, recorder and trigger follows CaptureLive (agent capture-pose).
 */
export type TrainingMode = 'mirror' | 'series';

export interface SeriesShotRecord {
  n: number;
  swingId: string | null;
  outcome: SeriesOutcome;
  proximity: number | null;
  /** first criterion's measured value (for the list) */
  value: number | null;
  createdAt: number;
}

export interface LiveTrainingResult {
  shots: SeriesShotRecord[];
  tally: SeriesTally;
  mirror: { reached: number; held: number };
}

interface Props {
  target: TrainingTarget;
  mode: TrainingMode;
  ctx: AnalysisContext;
  toleranceScale: number;
  sound: boolean;
  /** end the series automatically after this many judged swings (null = open end) */
  ballGoal: number | null;
  sessionId: string;
  onProgress: (r: LiveTrainingResult) => void;
  onEnd: (r: LiveTrainingResult) => void;
}

type Phase = 'starting' | 'model' | 'live' | 'error';
// REVIEW(golf): same pre/post-roll as the capture screen
const PRE_ROLL_MS = 1200;
const POST_ROLL_MS = 800;
const MAX_IDLE_RECORDING_MS = 25000;
const RESULT_SHOW_MS = 3500;

interface MirrorUi {
  state: MirrorState;
  holdProgress: number;
  ev: Evaluation | null;
}

// probe with the precomputed model ghosts (address + top) – no synthetic generator in the bundle
const metricsReady = () =>
  liveMetricsAvailable(() => ({
    seq: {
      width: 1080,
      height: 1920,
      fps: 30,
      mirrored: false,
      frames: [
        { t: 0, lm: modelGhost('iron', 'face_on', 'address') },
        { t: 800, lm: modelGhost('iron', 'face_on', 'top') },
      ],
    },
    top: 1,
    address: 0,
  }));

export function LiveTraining({ target, mode, ctx, toleranceScale, sound, ballGoal, sessionId, onProgress, onEnd }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const [facing, setFacing] = useState<Facing>('user');
  const [phase, setPhase] = useState<Phase>('starting');
  const [errMsg, setErrMsg] = useState('');
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [soundOn, setSoundOn] = useState(sound);
  const [seen, setSeen] = useState(false);
  // mirror
  const [mui, setMui] = useState<MirrorUi>({ state: 'out', holdProgress: 0, ev: null });
  const [hasAddress, setHasAddress] = useState(target.position === 'address');
  const [counts, setCounts] = useState({ reached: 0, held: 0 });
  // series
  const [trig, setTrig] = useState<TriggerState>('idle');
  const [tally, setTally] = useState<SeriesTally>({ hits: 0, judged: 0, unknown: 0, practice: 0 });
  const [last, setLast] = useState<{ kind: SeriesOutcome | 'practice'; at: number } | null>(null);
  const [saving, setSaving] = useState(0);

  const criteria = useMemo(() => (mode === 'mirror' ? mirrorCriteria(target) : target.criteria), [mode, target]);
  const noMetrics = useMemo(() => !metricsReady(), []);

  const live = useRef({
    cam: null as CameraHandle | null,
    rec: new ClipRecorder(),
    stopping: false,
    trigger: null as SwingTrigger | null,
    series: null as SeriesSession | null,
    mirror: new MirrorMachine(),
    still: null as StillnessDetector | null,
    address: null as PoseFrame | null,
    offset: 0,
    lastUi: 0,
    shots: [] as SeriesShotRecord[],
    counts: { reached: 0, held: 0 },
    ended: false,
    soundOn: sound,
    lastEval: null as Evaluation | null,
    lastEvalAt: -Infinity,
  });
  live.current.soundOn = soundOn;

  const audio = getTrainingAudio();
  audio.enabled = soundOn;

  const result = (): LiveTrainingResult => {
    const L = live.current;
    return {
      shots: [...L.shots],
      tally: L.series?.tally ?? { hits: 0, judged: 0, unknown: 0, practice: 0 },
      mirror: { ...L.counts },
    };
  };

  // fit the video box (contain) into the view
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const fit = () => {
      const v = videoRef.current;
      const a = v && v.videoWidth ? v.videoWidth / v.videoHeight : 9 / 16;
      const W = el.clientWidth;
      const H = el.clientHeight;
      const width = Math.min(W, H * a);
      const height = width / a;
      setBox({ left: (W - width) / 2, top: (H - height) / 2, width, height });
    };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    const v = videoRef.current;
    v?.addEventListener('loadedmetadata', fit);
    return () => {
      ro?.disconnect();
      v?.removeEventListener('loadedmetadata', fit);
    };
  }, [phase]);

  useEffect(() => {
    let cancelled = false;
    let stopLoop: (() => void) | null = null;
    const L = live.current;
    const video = videoRef.current!;
    const dims = () => ({ width: video.videoWidth || 1080, height: video.videoHeight || 1920 });
    const aspect = () => {
      const d = dims();
      return d.width / d.height;
    };
    const ghostRaw = target.ghost ? ghostToRaw(target.ghost, ctx.handedness) : null;

    const play = (k: Parameters<typeof audio.play>[0]) => {
      if (L.soundOn) audio.play(k);
    };

    const saveShot = async (shot: NonNullable<ReturnType<SeriesSession['push']>['completed']>, dt: number) => {
      setSaving((s) => s + 1);
      const blob = L.rec.recording ? await stopRecorder() : null;
      const id = newId('sw');
      let swingId: string | null = null;
      try {
        const r = shiftResult(shot.full ?? shot.judged, blob ? dt : -shot.startT);
        const sw = buildSwing(r, { id, sessionId, ctx, source: 'training' });
        await persistSwing(sw, blob ?? undefined);
        swingId = id;
      } catch {
        swingId = null;
      }
      const c0 = shot.evaluation.criteria[0];
      const rec: SeriesShotRecord = {
        n: shot.n,
        swingId,
        outcome: shot.outcome,
        proximity: shot.proximity,
        value: c0?.value ?? null,
        createdAt: Date.now(),
      };
      L.shots = [...L.shots.filter((s) => s.n !== shot.n), rec];
      setSaving((s) => s - 1);
      if (!cancelled) onProgress(result());
      const tl = L.series!.tally;
      if (ballGoal && tl.judged + tl.unknown >= ballGoal && !L.ended) {
        L.ended = true;
        setTimeout(() => !cancelled && onEnd(result()), 1500);
      }
    };

    const stopRecorder = async (): Promise<Blob | null> => {
      L.stopping = true;
      try {
        return await L.rec.stop();
      } finally {
        L.stopping = false;
      }
    };

    const onSeriesFrame = (f: LiveFrame) => {
      const tr = L.trigger!;
      const events = tr.push(f.canonical);
      const up = L.series!.push(f.canonical, events);
      setTrig(tr.state);
      for (const e of events) {
        if (e.type === 'address' && !L.rec.recording && !L.stopping && L.cam && ClipRecorder.supported()) {
          try {
            L.rec.start(L.cam.stream);
          } catch {
            // recording not possible → swings are saved without video
          }
        } else if (e.type === 'lost' && L.rec.recording) L.rec.discard();
      }
      if (up.judged) {
        const o = up.judged.outcome;
        play(o === 'hit' ? 'hit' : o === 'miss' ? 'miss' : 'unknown');
        L.lastEval = up.judged.evaluation;
        L.lastEvalAt = f.raw.t;
        setLast({ kind: o, at: f.raw.t });
        setTally(L.series!.tally);
      }
      if (up.retracted || up.practiceIgnored) {
        if (L.rec.recording) L.rec.discard();
        if (up.retracted) L.shots = L.shots.filter((s) => s.n !== up.retracted!.n);
        setLast({ kind: 'practice', at: f.raw.t });
        setTally(L.series!.tally);
      }
      if (up.completed) {
        const dt = L.offset - L.rec.startedAt;
        void saveShot(up.completed, dt);
      }
      if (L.rec.recording && L.rec.elapsed() > MAX_IDLE_RECORDING_MS && (tr.state === 'present' || tr.state === 'address')) {
        L.rec.discard();
        if (tr.state === 'address' && L.cam) {
          try {
            L.rec.start(L.cam.stream);
          } catch {
            /* recorder refused to restart (review K4) – the next address tries again */
          }
        }
      }
      const showEval = f.raw.t - L.lastEvalAt < RESULT_SHOW_MS ? L.lastEval : null;
      drawTrainingOverlay(canvasRef.current, {
        live: f.raw.lm,
        ghost: null,
        criteria,
        results: showEval?.criteria ?? null,
        toleranceScale,
        mirrored: ctx.handedness === 'left',
      });
    };

    const onMirrorFrame = (f: LiveFrame) => {
      const d = dims();
      if (!L.address && target.position !== 'address') {
        L.still ??= new StillnessDetector(aspect());
        if (L.still.push(f.canonical)) {
          L.address = f.canonical;
          setHasAddress(true);
        }
      }
      let ev: Evaluation | null = null;
      if (L.address || target.position === 'address') {
        ev = evaluateLiveFrame(target, L.address, f.canonical, { ...d, fps: 30 }, ctx, toleranceScale);
        const u = L.mirror.update(f.raw.t, ev.maxDistance);
        for (const e of u.events) {
          if (e === 'reach') {
            play('reach');
            L.counts.reached++;
          } else if (e === 'held') {
            play('held');
            L.counts.held++;
          }
        }
        if (u.events.length) setCounts({ ...L.counts });
        if (u.events.length || f.raw.t - L.lastUi > 100) {
          L.lastUi = f.raw.t;
          setMui({ state: u.state, holdProgress: u.holdProgress, ev });
        }
      }
      let ghost: Landmark[] | null = null;
      if (ghostRaw && f.raw.lm) ghost = alignGhost(ghostRaw, f.raw.lm, aspect());
      drawTrainingOverlay(canvasRef.current, {
        live: f.raw.lm,
        ghost,
        criteria,
        results: ev?.criteria ?? null,
        toleranceScale,
        mirrored: ctx.handedness === 'left',
      });
    };

    const onFrame = (f: LiveFrame) => {
      if (cancelled) return;
      if (f.wallMs !== undefined) L.offset = f.wallMs - f.raw.t;
      const vis = !!f.raw.lm;
      setSeen((s) => (s === vis ? s : vis));
      if (mode === 'series') onSeriesFrame(f);
      else onMirrorFrame(f);
    };

    (async () => {
      try {
        setPhase('starting');
        const cam = await openCamera(video, facing, mode === 'series' ? 60 : 30);
        if (cancelled) return cam.stop();
        L.cam = cam;
        setPhase('model');
        const provider = getPoseProviderFor('lite');
        await provider.init('lite');
        provider.resetTracking();
        if (cancelled) return;
        const d = dims();
        L.trigger = new SwingTrigger({
          shotType: target.shotType,
          view: target.view,
          aspect: d.width / d.height,
          preRollMs: PRE_ROLL_MS,
          postRollMs: POST_ROLL_MS,
        });
        L.series ??= new SeriesSession({
          target,
          ctx,
          width: d.width,
          height: d.height,
          toleranceScale,
          preRollMs: PRE_ROLL_MS,
        });
        stopLoop = startPoseLoop(video, provider, ctx.handedness, onFrame);
        setPhase('live');
      } catch (e) {
        if (cancelled) return;
        setErrMsg(startErrorText(e)); // never the raw browser message (review K3)
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
      stopLoop?.();
      L.rec.discard();
      L.cam?.stop();
      L.cam = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing]);

  // the big result banner of the series stays for a few seconds, then the status returns to "ready"
  useEffect(() => {
    if (!last) return;
    const id = setTimeout(() => setLast(null), RESULT_SHOW_MS);
    return () => clearTimeout(id);
  }, [last]);

  const newAddress = () => {
    const L = live.current;
    L.address = null;
    L.still?.reset();
    L.mirror.reset();
    setHasAddress(target.position === 'address');
    setMui({ state: 'out', holdProgress: 0, ev: null });
  };

  // ---------------------------------------------------------------- big status
  let status: { cls: string; sym: string; text: string; sub?: string };
  if (phase === 'error') status = { cls: 'bad', sym: '✕', text: t('training.live.error'), sub: errMsg };
  else if (phase === 'starting') status = { cls: '', sym: '…', text: t('training.live.starting') };
  else if (phase === 'model') status = { cls: '', sym: '…', text: t('training.live.loadingModel') };
  else if (!seen) status = { cls: 'warn', sym: '!', text: t('training.live.lookingForPlayer') };
  else if (mode === 'mirror') {
    if (!hasAddress) status = { cls: 'warn', sym: '…', text: t('training.live.address') };
    else if (mui.state === 'held') status = { cls: 'ok', sym: '✓', text: t('training.live.held') };
    else if (mui.state === 'in') status = { cls: 'ok', sym: '✓', text: t('training.live.inPosition'), sub: t('training.live.hold') };
    else if (!mui.ev || mui.ev.proximity == null) status = { cls: 'unknown', sym: '?', text: t('training.live.notVisible') };
    else status = { cls: 'bad', sym: '✕', text: t('training.live.notYet'), sub: t('training.live.moveInto', { pos: t(`common.pos.${target.position}`) }) };
  } else {
    const recent = last;
    if (recent && recent.kind !== 'practice' && trig !== 'backswing' && trig !== 'downswing') {
      status =
        recent.kind === 'hit'
          ? { cls: 'ok', sym: '✓', text: t('training.live.reached') }
          : recent.kind === 'miss'
            ? { cls: 'bad', sym: '✕', text: t('training.live.missed') }
            : { cls: 'unknown', sym: '?', text: t('training.live.unknown') };
    } else if (recent?.kind === 'practice') status = { cls: 'unknown', sym: '–', text: t('training.live.practice') };
    else if (trig === 'address') status = { cls: 'ok', sym: '✓', text: t('training.live.ready') };
    else if (trig === 'backswing' || trig === 'downswing' || trig === 'follow' || trig === 'post') status = { cls: '', sym: '●', text: t('training.live.swinging') };
    else status = { cls: '', sym: '…', text: t('training.live.takeAddress') };
  }

  const prox = mui.ev?.proximity ?? null;
  const mirrorView = facing === 'user';
  return (
    <div className="training-live">
      <div className={`training-view${mirrorView ? ' mirror' : ''}`} ref={viewRef}>
        <div className="training-stage" style={{ ...box }}>
          <video ref={videoRef} muted playsInline autoPlay />
          <canvas ref={canvasRef} />
        </div>
        <div className="training-hud" aria-live="polite">
          <div className={`training-status ${status.cls}`}>
            <span className="sym">{status.sym}</span>
            <span className="txt">
              {status.text}
              {status.sub && <small>{status.sub}</small>}
            </span>
          </div>
          {mode === 'mirror' && hasAddress && (
            <>
              <div className="training-meter" aria-hidden>
                <span style={{ width: `${Math.round((prox ?? 0) * 100)}%`, background: colorForProximity(prox) }} />
                <i style={{ left: `${(2 / 3) * 100}%` }} />
              </div>
              {(mui.state === 'in' || mui.state === 'held') && (
                <div className="training-hold" aria-hidden>
                  <span style={{ width: `${Math.round(mui.holdProgress * 100)}%` }} />
                </div>
              )}
              <ul className="training-values">
                {criteria.map((c, i) => {
                  const r = mui.ev?.criteria[i];
                  return (
                    <li key={i} style={{ borderColor: colorForProximity(r?.proximity ?? null) }}>
                      <span>{metricName(c.metric)}</span>
                      <b>{r?.value != null ? formatValue(r.value, c.unit) : '–'}</b>
                      <span className="tgt">
                        → {criterionText(c, toleranceScale)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {mode === 'series' && (
            <div className="training-count" aria-label={t('training.summary.rate', { hits: tally.hits, n: tally.judged })}>
              <b style={{ color: tally.judged ? (tally.hits / tally.judged >= 0.5 ? COLORS.green : COLORS.yellow) : undefined }}>{tally.hits}</b>
              <span>/</span>
              <b>{tally.judged}</b>
              {ballGoal ? <small>({ballGoal})</small> : null}
            </div>
          )}
          {mode === 'series' && saving > 0 && <div className="training-hint small">{t('training.live.saving')}</div>}
          {noMetrics && phase === 'live' && <div className="training-hint small">{t('training.live.noMetrics')}</div>}
        </div>
      </div>
      <div className="training-bar">
        <button onClick={() => onEnd(result())}>
          <span className="ico">■</span>
          {t('training.live.end')}
        </button>
        {mode === 'mirror' ? (
          <button onClick={newAddress} disabled={target.position === 'address'}>
            <span className="ico">↺</span>
            {t('training.live.newAddress')}
          </button>
        ) : (
          <button onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}>
            <span className="ico">⟲</span>
            {t('capture.switchCamera')}
          </button>
        )}
        <button
          aria-pressed={soundOn}
          onClick={() => {
            void audio.unlock();
            setSoundOn((s) => !s);
          }}
        >
          <span className="ico">{soundOn ? '🔊' : '🔇'}</span>
          {soundOn ? t('training.live.soundOn') : t('training.live.soundOff')}
        </button>
      </div>
      {mode === 'mirror' && (counts.held > 0 || counts.reached > 0) && (
        <div className="training-sub">{t('training.live.heldCount', { n: counts.held })}</div>
      )}
    </div>
  );
}
