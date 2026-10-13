import { useEffect, useRef, useState } from 'react';
import type { AnalysisContext } from '../../coach/analysis/context';
import { t } from '../../coach/i18n/i18n';
import { openCamera, type CameraHandle, type Facing } from '../../coach/live/camera';
import { cameraTilted, IssueDebouncer, LIVE_ISSUE_ORDER, liveFrameIssues, type LiveIssue } from '../../coach/live/frameCheck';
import { startPoseLoop, type LiveFrame } from '../../coach/live/poseLoop';
import { ClipRecorder } from '../../coach/live/recorder';
import { SwingTrigger, type TriggerState } from '../../coach/live/swingTrigger';
import { SHOT_TYPES, SKELETON } from '../../coach/model/constants';
import { getPoseProviderFor } from '../../coach/pose/mediapipe';
import { CaptureSilhouette } from './CaptureGuide';
import '../styles/capture.css';

/**
 * Live viewfinder with automatic recording (US-1.0). OWNER: agent "capture-pose".
 * Camera → pose (lite model) → SwingTrigger. The recorder starts when the player stands still at address and stops
 * after the finish + post-roll; the clip is handed to the parent with the swing window in video time.
 * No touch needed. A manual Record/Stop button and upload remain as fallbacks.
 */
export interface CapturedClip {
  blob: Blob;
  /** swing window in video time (ms), null = whole clip (manual recording) */
  window: { startMs: number; endMs: number } | null;
  practice: boolean;
}

interface Props {
  ctx: AnalysisContext;
  onClip: (clip: CapturedClip) => void;
  onUpload: () => void;
  onClose: () => void;
}

type Phase = 'starting' | 'model' | 'live' | 'error';
// REVIEW(golf): 1 s before the takeaway and 0.7 s after the finish (US-1.0 "[X] seconds pre/post-roll")
const PRE_ROLL_MS = 1200;
const POST_ROLL_MS = 800;
/** restart a recording that waits at address for too long (memory) */
const MAX_IDLE_RECORDING_MS = 25000;

export function CaptureLive({ ctx, onClip, onUpload, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const [facing, setFacing] = useState<Facing>('user');
  const [phase, setPhase] = useState<Phase>('starting');
  const [errMsg, setErrMsg] = useState('');
  const [trig, setTrig] = useState<TriggerState>('idle');
  const [issues, setIssues] = useState<LiveIssue[]>([]);
  const [recording, setRecording] = useState(false);
  const [manual, setManual] = useState(false);
  const [auto, setAuto] = useState(true);
  const [skipPractice, setSkipPractice] = useState(true);
  const [practiceClip, setPracticeClip] = useState<CapturedClip | null>(null);
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, height: 0 });

  // mutable state for the frame loop (no re-render per frame)
  const live = useRef({
    cam: null as CameraHandle | null,
    rec: new ClipRecorder(),
    trigger: null as SwingTrigger | null,
    deb: new IssueDebouncer<LiveIssue>(),
    tilt: false,
    offset: 0,
    auto: true,
    manual: false,
    skipPractice: true,
    busy: false,
  });
  live.current.auto = auto;
  live.current.manual = manual;
  live.current.skipPractice = skipPractice;

  // tilt from the motion sensor (permission was requested on the setup screen)
  useEffect(() => {
    const on = (e: DeviceOrientationEvent) => {
      live.current.tilt = cameraTilted(e.beta, e.gamma);
    };
    window.addEventListener('deviceorientation', on);
    return () => window.removeEventListener('deviceorientation', on);
  }, []);

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

    const finishClip = async (window: CapturedClip['window'], practice: boolean) => {
      if (L.busy) return;
      L.busy = true;
      const blob = await L.rec.stop();
      setRecording(false);
      L.busy = false;
      if (!blob || cancelled) return;
      const clip = { blob, window, practice };
      if (practice && L.skipPractice) {
        setPracticeClip(clip);
        return;
      }
      onClip(clip);
    };

    const onFrame = (f: LiveFrame) => {
      if (cancelled) return;
      if (f.wallMs !== undefined) L.offset = f.wallMs - f.raw.t;
      drawSkeleton(canvasRef.current, f);
      const fi = liveFrameIssues(f.raw.lm, { people: f.people, needsHeadroom: SHOT_TYPES[ctx.shotType].motion === 'full' });
      if (L.tilt) fi.push('camera_tilted');
      const shown = L.deb.push(fi, f.raw.t);
      setIssues((old) => (sameList(old, shown) ? old : shown));

      const tr = L.trigger!;
      const events = tr.push(f.canonical);
      setTrig(tr.state);
      if (L.manual || L.busy) return;
      const toVideo = (tLoop: number) => tLoop + L.offset - L.rec.startedAt;
      for (const e of events) {
        if (e.type === 'address' && L.auto && !L.rec.recording && L.cam) {
          try {
            L.rec.start(L.cam.stream);
            setRecording(true);
          } catch {
            setAuto(false);
          }
        } else if (e.type === 'swing' && L.rec.recording) {
          void finishClip({ startMs: Math.max(0, toVideo(e.startT)), endMs: toVideo(e.endT) }, e.practice);
        } else if (e.type === 'lost' && L.rec.recording) {
          L.rec.discard();
          setRecording(false);
        }
      }
      // waiting at address for a long time: start a fresh recording (memory)
      if (L.rec.recording && L.rec.elapsed() > MAX_IDLE_RECORDING_MS && (tr.state === 'present' || tr.state === 'address')) {
        L.rec.discard();
        if (tr.state === 'address' && L.cam) L.rec.start(L.cam.stream);
        setRecording(L.rec.recording);
      }
      if (!L.auto && L.rec.recording) {
        L.rec.discard();
        setRecording(false);
      }
    };

    (async () => {
      try {
        setPhase('starting');
        const cam = await openCamera(video, facing, 60);
        if (cancelled) return cam.stop();
        L.cam = cam;
        setPhase('model');
        const provider = getPoseProviderFor('lite');
        await provider.init('lite');
        provider.resetTracking();
        if (cancelled) return;
        L.trigger = new SwingTrigger({
          shotType: ctx.shotType,
          view: ctx.view,
          aspect: video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 9 / 16,
          preRollMs: PRE_ROLL_MS,
          postRollMs: POST_ROLL_MS,
        });
        L.deb.reset();
        stopLoop = startPoseLoop(video, provider, ctx.handedness, onFrame);
        setPhase('live');
      } catch (e) {
        if (cancelled) return;
        setErrMsg(String((e as Error)?.message ?? e));
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
      stopLoop?.();
      L.rec.discard();
      L.cam?.stop();
      L.cam = null;
      setRecording(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing, ctx.shotType, ctx.view, ctx.handedness]);

  const toggleManual = async () => {
    const L = live.current;
    if (manual) {
      setManual(false);
      const blob = await L.rec.stop();
      setRecording(false);
      if (blob) onClip({ blob, window: null, practice: false });
      return;
    }
    if (!L.cam || !ClipRecorder.supported()) return;
    L.rec.discard();
    L.rec.start(L.cam.stream);
    setManual(true);
    setRecording(true);
  };

  // ---------------------------------------------------------------- status line
  const issue = LIVE_ISSUE_ORDER.find((i) => issues.includes(i));
  let pill: { cls: string; sym: string; text: string };
  if (phase === 'starting') pill = { cls: '', sym: '…', text: t('capture.status.starting') };
  else if (phase === 'model') pill = { cls: '', sym: '…', text: t('capture.status.loadingModel') };
  else if (manual) pill = { cls: 'rec', sym: '●', text: t('capture.status.manual') };
  else if (trig === 'backswing' || trig === 'downswing' || trig === 'follow' || trig === 'post')
    pill = { cls: 'rec', sym: '●', text: t('capture.status.swinging') };
  else if (trig === 'address') pill = { cls: 'ok', sym: '✓', text: t('capture.status.readyFull') };
  else if (trig === 'present') pill = { cls: 'ok', sym: '✓', text: t('capture.status.playerDetected') };
  else pill = { cls: 'warn', sym: '!', text: t('capture.status.lookingForPlayer') };

  const mirrorView = facing === 'user';
  return (
    <div className="capture-live">
      <div className={`capture-view${mirrorView ? ' mirror' : ''}`} ref={viewRef}>
        <div style={{ position: 'absolute', ...box }}>
          <video ref={videoRef} muted playsInline autoPlay style={{ objectFit: 'fill' }} />
          <canvas ref={canvasRef} />
          {phase === 'live' && trig === 'idle' && (
            <CaptureSilhouette view={ctx.view} mirror={ctx.handedness === 'left'} className="capture-guide-overlay" />
          )}
        </div>
        <div className="capture-status" aria-live="polite">
          {phase === 'error' ? (
            <div className="capture-pill bad">
              <span className="sym">✕</span>
              <span>{t('capture.error.camera')}</span>
            </div>
          ) : (
            <div className={`capture-pill ${pill.cls}`}>
              <span className="sym">{pill.sym}</span>
              <span>{pill.text}</span>
            </div>
          )}
          {recording && !manual && (
            <div className="capture-pill rec small">
              <span className="sym">●</span>
              <span>{t('capture.status.recording')}</span>
            </div>
          )}
          {issue && phase === 'live' && (
            <div className="capture-pill warn small">
              <span className="sym">!</span>
              <span>{t(`capture.issue.${issue}`)}</span>
            </div>
          )}
          {practiceClip && (
            <button className="capture-pill small" style={{ border: 0 }} onClick={() => onClip({ ...practiceClip, practice: false })}>
              <span className="sym">↻</span>
              <span>
                {t('capture.status.practiceSkipped')} – {t('capture.status.analyseAnyway')}
              </span>
            </button>
          )}
          {phase === 'error' && errMsg && <div className="capture-pill small">{errMsg}</div>}
        </div>
      </div>
      <div className="capture-bar">
        <button onClick={onClose}>
          <span className="ico">✕</span>
          {t('capture.close')}
        </button>
        <button className={manual ? 'rec-on' : 'rec'} onClick={toggleManual} disabled={phase !== 'live'}>
          <span className="ico">{manual ? '■' : '●'}</span>
          {manual ? t('capture.stop') : t('capture.record')}
        </button>
        <button onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} disabled={manual}>
          <span className="ico">⟲</span>
          {t('capture.switchCamera')}
        </button>
      </div>
      <div className="capture-sub">
        <button aria-pressed={auto} onClick={() => setAuto((a) => !a)}>
          {auto ? t('capture.autoOn') : t('capture.autoOff')}
        </button>
        <button aria-pressed={skipPractice} onClick={() => setSkipPractice((s) => !s)}>
          {skipPractice ? t('capture.practiceIgnore') : t('capture.practiceKeep')}
        </button>
        <button onClick={onUpload}>{t('capture.upload')}</button>
      </div>
    </div>
  );
}

function sameList(a: string[], b: string[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function drawSkeleton(c: HTMLCanvasElement | null, f: LiveFrame) {
  if (!c) return;
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
  if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr);
  const g = c.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const lm = f.raw.lm;
  if (!lm) return;
  g.lineCap = 'round';
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(238,242,236,0.85)';
  for (const [a, b] of SKELETON) {
    if (lm[a].v < 0.4 || lm[b].v < 0.4) continue;
    g.beginPath();
    g.moveTo(lm[a].x * w, lm[a].y * h);
    g.lineTo(lm[b].x * w, lm[b].y * h);
    g.stroke();
  }
}
