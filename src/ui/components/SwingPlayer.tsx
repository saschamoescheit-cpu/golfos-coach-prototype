import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { t } from '../../coach/i18n/i18n';
import { SHOT_TYPES, SKELETON } from '../../coach/model/constants';
import type { KeyPosition, Line2, Swing, Vec2 } from '../../coach/model/types';
import { toDisplay } from '../../coach/pose/mirror';
import {
  clipLineToFrame,
  clubToDisplay,
  dragLine,
  frameAtTime,
  hitLine,
  lineFromDisplay,
  lineHandles,
  lineToDisplay,
  poseTimeOfVideo,
  videoTimeOfFrame,
  type LineGrab,
} from './PlayerGeometry';
import '../styles/capture.css';

/**
 * Video player with skeleton overlay (US-1.3). CONTRACT used by the analysis, compare and training screens.
 * OWNER: agent "capture-pose": video + canvas overlay, play/pause, slow motion 1/0.5/0.25, single-frame steps,
 * key-position jump bar, toggles skeleton / neutral line, drag + rotate the neutral line with reset.
 *
 * Coordinates: the swing is stored canonical (right-handed); everything is mirrored back for display (toDisplay),
 * so the overlay sits on the video as filmed. The manual neutral line is stored canonical like the AI line.
 * Frame ↔ video time: pose frame t (ms) × swing.pose.videoTimeScale = video time (see PlayerGeometry).
 */
export type LineStatus = 'ok' | 'bad' | 'neutral';

export interface SwingPlayerProps {
  swing: Swing;
  /** object URL of the stored video; without it the player animates the skeleton on a dark background */
  videoUrl?: string;
  /** jump to this key position (changing the value seeks) */
  seekTo?: KeyPosition;
  /** colour of each skeleton line in a frame, key = "a-b" landmark pair as in SKELETON (e.g. "11-23"); default neutral */
  lineStatus?: (frameIndex: number) => Record<string, LineStatus>;
  /** show the key-position buttons under the video (default true) */
  showKeyBar?: boolean;
  /** compact mode for side-by-side compare (smaller controls) */
  compact?: boolean;
  /** called when the player moves to another frame */
  onFrameChange?: (frameIndex: number) => void;
  /** the player dragged/rotated the neutral line (visual only, never used for metrics); null = reset to AI line */
  onManualLineChange?: (line: Line2 | null) => void;
  /** external frame control (compare screen syncs two players); when set, the player shows this frame */
  frameIndex?: number;
  /** (additive) initial visibility of the skeleton / neutral line (default true) */
  initialSkeleton?: boolean;
  initialNeutralLine?: boolean;
  /** (additive) allow dragging the neutral line (default true, false in compact mode) */
  editableLine?: boolean;
}

const COLORS = { ok: '#46c46e', bad: '#ff6b5e', neutral: '#eef2ec', club: '#f2b53d', line: '#5ec8f2', shadow: 'rgba(0,0,0,0.55)' };
const RATES = [1, 0.5, 0.25];

type RvfcVideo = HTMLVideoElement & {
  requestVideoFrameCallback(cb: (now: number, meta: { mediaTime: number }) => void): number;
  cancelVideoFrameCallback(h: number): void;
};

export function SwingPlayer({
  swing,
  videoUrl,
  seekTo,
  lineStatus,
  showKeyBar = true,
  compact = false,
  onFrameChange,
  onManualLineChange,
  frameIndex,
  initialSkeleton = true,
  initialNeutralLine = true,
  editableLine,
}: SwingPlayerProps) {
  const disp = useMemo(() => toDisplay(swing.pose), [swing.pose]);
  const frames = disp.frames;
  const mirrored = swing.pose.mirrored;
  const n = frames.length;
  const keyIndex = useCallback((p: KeyPosition) => swing.keyframes.find((k) => k.position === p)?.frameIndex, [swing.keyframes]);
  const startIndex = frameIndex ?? keyIndex('address') ?? 0;

  const [i, setI] = useState(Math.min(Math.max(0, startIndex), Math.max(0, n - 1)));
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [showSkel, setShowSkel] = useState(initialSkeleton);
  const [showLine, setShowLine] = useState(initialNeutralLine);
  const [manual, setManual] = useState<Line2 | null>(swing.manualNeutralLine ?? null);
  const [videoOk, setVideoOk] = useState(!!videoUrl);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<{ grab: Exclude<LineGrab, null>; start: Vec2; line: Line2; cur: Line2 } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const iRef = useRef(i);
  iRef.current = i;

  const hasVideo = !!videoUrl && videoOk;
  const aspect = swing.pose.width > 0 && swing.pose.height > 0 ? swing.pose.width / swing.pose.height : 9 / 16;
  const isDtl = swing.view === 'down_the_line';
  const aiLine = swing.neutralLine;
  const canonLine = manual ?? aiLine;
  const lineVisible = isDtl && !!canonLine && showLine;
  const canEdit = (editableLine ?? !compact) && lineVisible;

  useEffect(() => setManual(swing.manualNeutralLine ?? null), [swing.id, swing.manualNeutralLine]);
  useEffect(() => setVideoOk(!!videoUrl), [videoUrl]);

  // ---------------------------------------------------------------- frame navigation
  const seekVideo = useCallback(
    (idx: number) => {
      const v = videoRef.current;
      if (v && hasVideo && v.readyState >= 1) v.currentTime = videoTimeOfFrame(swing.pose, idx);
    },
    [hasVideo, swing.pose],
  );

  const goTo = useCallback(
    (idx: number) => {
      const j = Math.max(0, Math.min(n - 1, idx));
      setPlaying(false);
      setI(j);
      seekVideo(j);
    },
    [n, seekVideo],
  );

  useEffect(() => {
    onFrameChange?.(i);
  }, [i]);

  useEffect(() => {
    if (frameIndex === undefined || frameIndex === iRef.current) return;
    goTo(frameIndex);
  }, [frameIndex, goTo]);

  useEffect(() => {
    if (!seekTo) return;
    const k = keyIndex(seekTo);
    if (k !== undefined) goTo(k);
  }, [seekTo, keyIndex, goTo]);

  // ---------------------------------------------------------------- playback
  useEffect(() => {
    const v = videoRef.current;
    if (!playing) {
      v?.pause();
      return;
    }
    let stop = false;
    if (hasVideo && v) {
      v.playbackRate = rate;
      if (iRef.current >= n - 1) v.currentTime = videoTimeOfFrame(swing.pose, 0);
      v.play().catch(() => setPlaying(false));
      const rv = v as RvfcVideo;
      let handle = 0;
      const onFrame = (_: number, meta?: { mediaTime: number }) => {
        if (stop) return;
        const tv = meta ? meta.mediaTime : v.currentTime;
        setI(frameAtTime(frames, poseTimeOfVideo(swing.pose, tv)));
        schedule();
      };
      const schedule = () => {
        if ('requestVideoFrameCallback' in v) handle = rv.requestVideoFrameCallback(onFrame);
        else handle = requestAnimationFrame(() => onFrame(0));
      };
      schedule();
      const onEnd = () => setPlaying(false);
      v.addEventListener('ended', onEnd);
      return () => {
        stop = true;
        v.removeEventListener('ended', onEnd);
        if ('cancelVideoFrameCallback' in v) rv.cancelVideoFrameCallback(handle);
        else cancelAnimationFrame(handle);
      };
    }
    // no video: animate the skeleton on its own clock
    let raf = 0;
    const t0 = performance.now();
    const startIdx = iRef.current >= n - 1 ? 0 : iRef.current;
    const f0 = frames[startIdx]?.t ?? 0;
    const tick = () => {
      if (stop) return;
      const tp = f0 + (performance.now() - t0) * rate;
      const j = frameAtTime(frames, tp);
      setI(j);
      if (j >= n - 1) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
    };
  }, [playing, rate, hasVideo, frames, n, swing.pose]);

  // ---------------------------------------------------------------- overlay size
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---------------------------------------------------------------- drawing
  const displayLine = drag ? drag.cur : lineToDisplay(canonLine, mirrored);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !size.w) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (c.width !== Math.round(size.w * dpr) || c.height !== Math.round(size.h * dpr)) {
      c.width = Math.round(size.w * dpr);
      c.height = Math.round(size.h * dpr);
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);
    const W = size.w;
    const H = size.h;
    const P = (p: Vec2) => [p.x * W, p.y * H] as const;
    const f = frames[i];
    const scale = Math.max(0.6, Math.min(1.4, W / 360));

    const stroke = (pts: (readonly [number, number])[], color: string, width: number, dash: number[] = []) => {
      g.lineCap = 'round';
      g.setLineDash(dash);
      g.strokeStyle = COLORS.shadow;
      g.lineWidth = width + 3;
      g.beginPath();
      g.moveTo(...pts[0]);
      for (const q of pts.slice(1)) g.lineTo(...q);
      g.stroke();
      g.strokeStyle = color;
      g.lineWidth = width;
      g.stroke();
      g.setLineDash([]);
    };

    // neutral line (DTL) with two round handles
    if (lineVisible && displayLine) {
      const clipped = clipLineToFrame(displayLine);
      if (clipped) {
        stroke([P(clipped.a), P(clipped.b)], COLORS.line, 3 * scale, manual || drag ? [] : [12 * scale, 8 * scale]);
        const hs = canEdit ? lineHandles(displayLine) : null;
        if (hs)
          for (const h of hs) {
            const [x, y] = P(h);
            g.beginPath();
            g.arc(x, y, 11 * scale, 0, Math.PI * 2);
            g.fillStyle = 'rgba(14,20,24,0.65)';
            g.fill();
            g.lineWidth = 3;
            g.strokeStyle = COLORS.line;
            g.stroke();
          }
      }
    }

    if (showSkel && f?.lm) {
      // club (dashed when only estimated from the hands)
      const club = clubToDisplay(swing.club[i], mirrored);
      if (club) stroke([P(club.grip), P(club.head)], COLORS.club, 3.5 * scale, club.source === 'hands' ? [8 * scale, 7 * scale] : []);
      const st = lineStatus?.(i) ?? {};
      const lm = f.lm;
      for (const [a, b] of SKELETON) {
        if (lm[a].v < 0.3 || lm[b].v < 0.3) continue;
        const s = st[`${a}-${b}`] ?? st[`${b}-${a}`] ?? 'neutral';
        stroke([P(lm[a]), P(lm[b])], COLORS[s], 4 * scale);
      }
      // head marker
      const nose = lm[0];
      if (nose.v >= 0.3) {
        const [x, y] = P(nose);
        g.beginPath();
        g.arc(x, y, 9 * scale, 0, Math.PI * 2);
        g.lineWidth = 3 * scale;
        g.strokeStyle = COLORS.shadow;
        g.stroke();
        g.lineWidth = 2 * scale;
        g.strokeStyle = COLORS.neutral;
        g.stroke();
      }
      g.fillStyle = COLORS.neutral;
      for (const j of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
        if (lm[j].v < 0.3) continue;
        const [x, y] = P(lm[j]);
        g.beginPath();
        g.arc(x, y, 3.2 * scale, 0, Math.PI * 2);
        g.fill();
      }
    }
  }, [i, size, frames, showSkel, lineVisible, displayLine, canEdit, manual, drag, lineStatus, swing.club, mirrored]);

  // ---------------------------------------------------------------- neutral line dragging
  const local = (e: RPointerEvent): Vec2 => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!canEdit || !displayLine) return;
    const p = local(e);
    const grab = hitLine(displayLine, p, size.w, size.h);
    if (!grab) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setPlaying(false);
    setDrag({ grab, start: p, line: displayLine, cur: displayLine });
  };
  const onPointerMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!drag) return;
    const p = local(e);
    const d = { x: (p.x - drag.start.x) / size.w, y: (p.y - drag.start.y) / size.h };
    setDrag({ ...drag, cur: dragLine(drag.line, drag.grab, d) });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const canon = lineFromDisplay(drag.cur, mirrored);
    setDrag(null);
    setManual(canon);
    onManualLineChange?.(canon);
  };
  const resetLine = () => {
    setManual(null);
    onManualLineChange?.(null);
  };

  // ---------------------------------------------------------------- UI
  const positions = SHOT_TYPES[swing.shotType].positions.filter((p) => keyIndex(p) !== undefined);
  const currentKey = positions.find((p) => keyIndex(p) === i);
  const timeS = n ? (frames[i].t - frames[0].t) / 1000 : 0;

  return (
    <div className={`player${compact ? ' compact' : ''}`}>
      <div className="player-stage" ref={stageRef} style={{ aspectRatio: `${aspect}` }}>
        {hasVideo ? (
          <video
            ref={videoRef}
            className="player-video"
            src={videoUrl}
            muted
            playsInline
            preload="auto"
            onLoadedData={() => seekVideo(iRef.current)}
            onError={() => setVideoOk(false)}
          />
        ) : (
          <div className="player-novideo">{t('player.noVideo')}</div>
        )}
        <canvas
          ref={canvasRef}
          className="player-canvas"
          style={{ touchAction: canEdit ? 'none' : 'auto' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        {currentKey && <div className="player-badge">{t(`common.pos.${currentKey}`)}</div>}
      </div>

      <div className="player-scrub">
        <input
          type="range"
          min={0}
          max={Math.max(0, n - 1)}
          step={1}
          value={i}
          aria-label={t('player.frame')}
          onChange={(e) => goTo(Number(e.target.value))}
        />
        <span className="player-time">{t('player.time', { s: timeS.toFixed(2) })}</span>
      </div>

      <div className="player-controls">
        <button className="player-btn" onClick={() => goTo(i - 1)} aria-label={t('player.prevFrame')} disabled={i <= 0}>
          ◀︎
        </button>
        <button
          className="player-btn primary"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? t('player.pause') : t('player.play')}
          disabled={n < 2}
        >
          {playing ? '❚❚' : '▶︎'} <span className="lbl">{playing ? t('player.pause') : t('player.play')}</span>
        </button>
        <button className="player-btn" onClick={() => goTo(i + 1)} aria-label={t('player.nextFrame')} disabled={i >= n - 1}>
          ▶︎❘
        </button>
        <div className="player-rates" role="group" aria-label={t('player.speed')}>
          {RATES.map((r) => (
            <button key={r} aria-pressed={rate === r} onClick={() => setRate(r)}>
              {r === 1 ? '1×' : r === 0.5 ? '½×' : '¼×'}
            </button>
          ))}
        </div>
      </div>

      {showKeyBar && positions.length > 0 && (
        <div className="player-keybar">
          {positions.map((p) => (
            <button key={p} className="player-key" aria-pressed={currentKey === p} onClick={() => goTo(keyIndex(p)!)}>
              {t(`common.pos.${p}`)}
            </button>
          ))}
        </div>
      )}

      {!compact && (
        <div className="player-toggles">
          <button className="player-toggle" aria-pressed={showSkel} onClick={() => setShowSkel((s) => !s)}>
            {showSkel ? '✓' : '✕'} {t('player.skeleton')}
          </button>
          {isDtl && canonLine && (
            <button className="player-toggle" aria-pressed={showLine} onClick={() => setShowLine((s) => !s)}>
              {showLine ? '✓' : '✕'} {t('player.neutralLine')}
            </button>
          )}
          {isDtl && manual && aiLine && (
            <button className="player-toggle" onClick={resetLine}>
              ↺ {t('player.resetLine')}
            </button>
          )}
        </div>
      )}
      {!compact && (
        <p className="player-hint">
          {canEdit ? t('player.dragHint') : null}
          {swing.club.some((c) => c?.source === 'hands') ? ` ${t('player.clubEstimated')}` : null}
        </p>
      )}
    </div>
  );
}
