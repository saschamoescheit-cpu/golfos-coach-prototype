import type { ProgressPoint } from '../../coach/storage/progress';

/**
 * Tiny bar chart of one fault over the last swings (oldest left). Red tall bar = fault seen (height = severity),
 * short green bar = checked and not seen. Plain SVG; colour is never the only signal (legend text + aria-label).
 */
export function ProgressBars({ points, max = 20, ariaLabel }: { points: ProgressPoint[]; max?: number; ariaLabel: string }) {
  const pts = points.slice(-max);
  const W = 300;
  const H = 44;
  const gap = 3;
  const bw = Math.max(4, Math.min(18, (W - gap * (max - 1)) / max));
  return (
    <svg className="progress-bars" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} preserveAspectRatio="xMinYMid meet">
      <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--line)" strokeWidth="1" />
      {pts.map((p, i) => {
        const h = p.detected ? 14 + 28 * Math.min(1, Math.max(0, p.severity)) : 6;
        return (
          <rect
            key={p.swingId}
            x={i * (bw + gap)}
            y={H - 1 - h}
            width={bw}
            height={h}
            rx="2"
            fill={p.detected ? 'var(--bad)' : 'var(--ok)'}
            opacity={p.detected ? 1 : 0.85}
          />
        );
      })}
    </svg>
  );
}
