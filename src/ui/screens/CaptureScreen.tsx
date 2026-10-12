import type { Route } from '../nav';
import { TopBar } from '../components/TopBar';

/** Placeholder – OWNER see docs/coach/01_PLAN.md (screen "capture"). */
export function CaptureScreen({ route }: { route: Route }) {
  return (
    <div className="screen">
      <TopBar title="Capture" />
      <p className="placeholder-note">TODO: capture {JSON.stringify(route.params)}</p>
    </div>
  );
}
