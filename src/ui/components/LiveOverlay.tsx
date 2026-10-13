import { SKELETON } from '../../coach/model/constants';
import type { Landmark, TargetCriterion } from '../../coach/model/types';
import { mirrorIndex } from '../../coach/pose/mirror';
import { METRIC_SEGMENTS } from '../../coach/training/metricInfo';
import { colorForProximity, type CriterionResult } from '../../coach/training/proximity';

/**
 * Canvas drawing for the training live view (OWNER: agent "training"). Everything is drawn in RAW camera coordinates;
 * the container is mirrored by CSS for the front camera, so text never goes onto this canvas.
 * Readable from 3–4 m: thick lines, strong colours. Lines that belong to a trained criterion are coloured by its
 * proximity (red → yellow → green), the rest of the body stays white.
 */
export interface OverlayInput {
  live: Landmark[] | null;
  /** ghost already aligned onto the live player (raw coordinates) */
  ghost: Landmark[] | null;
  criteria: TargetCriterion[];
  results: CriterionResult[] | null;
  toleranceScale: number;
  /** left-hander: live/ghost landmarks are raw (as filmed), the metric segments canonical → swap sides (review W3) */
  mirrored?: boolean;
}

/** Segments of a metric in the indices of the drawn (raw) landmarks. */
function segmentsOf(metric: TargetCriterion['metric'], mirrored = false): [number, number][] {
  const segs = METRIC_SEGMENTS[metric] ?? [];
  return mirrored ? segs.map(([a, b]) => [mirrorIndex(a), mirrorIndex(b)] as [number, number]) : segs;
}

const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

export function segmentColors(criteria: TargetCriterion[], results: CriterionResult[] | null, mirrored = false): Map<string, string> {
  const m = new Map<string, string>();
  criteria.forEach((c, i) => {
    const r = results?.[i];
    const color = colorForProximity(r ? r.proximity : null);
    for (const [a, b] of segmentsOf(c.metric, mirrored)) {
      // a segment shared by two criteria shows the worse one (red wins over green)
      const k = key(a, b);
      const old = m.get(k);
      if (!old || (r?.proximity ?? 1) < 0.5) m.set(k, color);
    }
  });
  return m;
}

export function drawTrainingOverlay(c: HTMLCanvasElement | null, inp: OverlayInput) {
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
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const unit = Math.max(4, Math.min(w, h) * 0.018);
  const P = (p: Landmark) => ({ x: p.x * w, y: p.y * h });

  // ---- ghost: half-transparent target pose + tolerance fan / band on the trained lines
  if (inp.ghost) {
    const gh = inp.ghost;
    for (const crit of inp.criteria) {
      for (const [a, b] of segmentsOf(crit.metric, inp.mirrored)) {
        const pa = P(gh[a]);
        const pb = P(gh[b]);
        const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
        if (!len) continue;
        g.fillStyle = 'rgba(48, 209, 88, 0.22)';
        g.strokeStyle = 'rgba(48, 209, 88, 0.22)';
        if (crit.unit === 'deg') {
          // fan: ± tolerance around the target line, pivot at the first point (shoulder for the arm, hip for the spine …)
          const half = Math.min(60, crit.tolerance * inp.toleranceScale) * (Math.PI / 180);
          const ang = Math.atan2(pb.y - pa.y, pb.x - pa.x);
          g.beginPath();
          g.moveTo(pa.x, pa.y);
          g.arc(pa.x, pa.y, len * 1.1, ang - half, ang + half);
          g.closePath();
          g.fill();
        } else {
          // band: tolerance in % of the torso → band width around the line
          const torso = torsoPx(gh, w, h);
          const bw = torso ? Math.max(unit * 2, (crit.tolerance * inp.toleranceScale * torso) / 100) * 2 : unit * 3;
          g.lineWidth = bw;
          g.beginPath();
          g.moveTo(pa.x, pa.y);
          g.lineTo(pb.x, pb.y);
          g.stroke();
        }
      }
    }
    g.setLineDash([unit * 1.2, unit * 0.9]);
    g.lineWidth = unit * 0.8;
    g.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    for (const [a, b] of SKELETON) {
      const pa = P(gh[a]);
      const pb = P(gh[b]);
      g.beginPath();
      g.moveTo(pa.x, pa.y);
      g.lineTo(pb.x, pb.y);
      g.stroke();
    }
    g.setLineDash([]);
  }

  // ---- the player: thick lines, trained lines coloured by proximity
  const lm = inp.live;
  if (!lm) return;
  const colors = segmentColors(inp.criteria, inp.results, inp.mirrored);
  for (const pass of [0, 1]) {
    for (const [a, b] of SKELETON) {
      if (lm[a].v < 0.35 || lm[b].v < 0.35) continue;
      const col = colors.get(key(a, b));
      if (pass === 0 && col) continue; // neutral lines first, coloured lines on top
      if (pass === 1 && !col) continue;
      const pa = P(lm[a]);
      const pb = P(lm[b]);
      // dark outline keeps the line readable on bright backgrounds (sky, sun)
      g.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      g.lineWidth = (col ? 2.2 : 1.3) * unit + 4;
      g.beginPath();
      g.moveTo(pa.x, pa.y);
      g.lineTo(pb.x, pb.y);
      g.stroke();
      g.strokeStyle = col ?? 'rgba(255, 255, 255, 0.85)';
      g.lineWidth = (col ? 2.2 : 1.3) * unit;
      g.stroke();
    }
  }
}

function torsoPx(lm: Landmark[], w: number, h: number): number | null {
  const sx = ((lm[11].x + lm[12].x) / 2) * w;
  const sy = ((lm[11].y + lm[12].y) / 2) * h;
  const hx = ((lm[23].x + lm[24].x) / 2) * w;
  const hy = ((lm[23].y + lm[24].y) / 2) * h;
  const l = Math.hypot(sx - hx, sy - hy);
  return l > 0 ? l : null;
}
