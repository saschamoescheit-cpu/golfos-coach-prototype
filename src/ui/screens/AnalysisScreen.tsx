import type { Route } from '../nav';
import { TopBar } from '../components/TopBar';

/** Placeholder – OWNER see docs/coach/01_PLAN.md (screen "analysis"). */
export function AnalysisScreen({ route }: { route: Route }) {
  return (
    <div className="screen">
      <TopBar title="Analysis" />
      <p className="placeholder-note">TODO: analysis {JSON.stringify(route.params)}</p>
    </div>
  );
}
