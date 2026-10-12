import { useEffect, useRef } from 'react';
import { SKELETON } from '../../coach/model/constants';
import type { KeyPosition, Line2, Swing } from '../../coach/model/types';
import { toDisplay } from '../../coach/pose/mirror';

/**
 * Video player with skeleton overlay (US-1.3). CONTRACT used by the analysis, compare and training screens.
 * OWNER: agent "capture-pose" implements the full player (video + canvas overlay, play/pause, slow motion 1/0.5/0.25,
 * single-frame steps, key-position jump bar, toggles skeleton / neutral line, drag + rotate the neutral line with reset).
 * This baseline only draws the skeleton of the current frame so other screens can already use it.
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
}

export function SwingPlayer({ swing, lineStatus, frameIndex }: SwingPlayerProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const i = frameIndex ?? swing.keyframes.find((k) => k.position === 'top')?.frameIndex ?? 0;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d');
    if (!g) return;
    const disp = toDisplay(swing.pose);
    const f = disp.frames[Math.min(i, disp.frames.length - 1)];
    g.fillStyle = '#0e1418';
    g.fillRect(0, 0, c.width, c.height);
    if (!f?.lm) return;
    const st = lineStatus?.(i) ?? {};
    g.lineWidth = 4;
    for (const [a, b] of SKELETON) {
      const s = st[`${a}-${b}`] ?? 'neutral';
      g.strokeStyle = s === 'ok' ? '#46c46e' : s === 'bad' ? '#ff6b5e' : '#eef2ec';
      g.beginPath();
      g.moveTo(f.lm[a].x * c.width, f.lm[a].y * c.height);
      g.lineTo(f.lm[b].x * c.width, f.lm[b].y * c.height);
      g.stroke();
    }
  }, [swing, i, lineStatus]);
  const aspect = swing.pose.width / swing.pose.height || 9 / 16;
  return <canvas ref={ref} width={360} height={Math.round(360 / aspect)} style={{ width: '100%', borderRadius: 12 }} />;
}
