import type { Route } from '../nav';
import { TopBar } from '../components/TopBar';

/** Placeholder – OWNER see docs/coach/01_PLAN.md (screen "compare"). */
export function CompareScreen({ route }: { route: Route }) {
  return (
    <div className="screen">
      <TopBar title="Compare" />
      <p className="placeholder-note">TODO: compare {JSON.stringify(route.params)}</p>
    </div>
  );
}
