import { t } from '../../coach/i18n/i18n';
import type { CameraView } from '../../coach/model/types';
import '../styles/capture.css';

/**
 * Camera guide: silhouette of a golfer at address for the chosen view (OWNER: agent "capture-pose").
 * `CaptureSilhouette` is also drawn translucent in the live viewfinder ("stand inside the outline", like V1/Sportsbox).
 * Drawn for a right-hander; `mirror` flips it for left-handers.
 */
export function CaptureSilhouette({
  view,
  mirror = false,
  className,
  frame = true,
}: {
  view: CameraView;
  mirror?: boolean;
  className?: string;
  frame?: boolean;
}) {
  const s = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg className={className} viewBox="0 0 90 160" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {frame && <rect x="4" y="4" width="82" height="152" rx="8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="5 4" opacity="0.7" />}
      <g transform={mirror ? 'translate(90 0) scale(-1 1)' : undefined}>
        {view === 'face_on' ? (
          <g {...s} strokeWidth="7">
            <circle cx="45" cy="34" r="8" strokeWidth="5" />
            {/* torso + arms hanging to the hands in front of the body */}
            <path d="M33 50 L57 50 L53 86 L37 86 Z" strokeWidth="5" />
            <path d="M34 52 L42 92 M56 52 L47 92" strokeWidth="5" />
            {/* legs */}
            <path d="M39 88 L30 120 L28 146 M51 88 L60 120 L62 146" />
            {/* club to the ball, right of the hands (target to the image right) */}
            <path d="M45 92 L56 146" strokeWidth="2.5" />
            <circle cx="58" cy="148" r="2.5" fill="currentColor" strokeWidth="0" />
          </g>
        ) : (
          <g {...s} strokeWidth="7">
            {/* side view, player faces image right, bent forward from the hips */}
            <circle cx="56" cy="40" r="8" strokeWidth="5" />
            <path d="M48 52 L32 84" />
            <path d="M47 55 L54 92" strokeWidth="5" />
            <path d="M32 86 L42 116 L36 146" />
            <path d="M54 92 L72 146" strokeWidth="2.5" />
            <circle cx="74" cy="148" r="2.5" fill="currentColor" strokeWidth="0" />
          </g>
        )}
      </g>
    </svg>
  );
}

export function CaptureGuide({ view, mirror }: { view: CameraView; mirror?: boolean }) {
  return (
    <div className="card capture-guide">
      <CaptureSilhouette view={view} mirror={mirror} />
      <ul>
        <li>{t(`capture.guide.${view}`, undefined, undefined, mirror ? 'left' : 'right')}</li>
        <li>{t('capture.guide.common.distance')}</li>
        <li>{t('capture.guide.common.height')}</li>
        <li>{t('capture.guide.common.upright')}</li>
        <li>{t('capture.guide.common.whole')}</li>
      </ul>
    </div>
  );
}
