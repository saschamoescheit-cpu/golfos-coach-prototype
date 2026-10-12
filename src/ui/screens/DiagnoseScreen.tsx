import type { Route } from '../nav';
import { TopBar } from '../components/TopBar';

/** Placeholder – OWNER see docs/coach/01_PLAN.md (screen "diagnose"). */
export function DiagnoseScreen({ route }: { route: Route }) {
  return (
    <div className="screen">
      <TopBar title="Diagnose" />
      <p className="placeholder-note">TODO: diagnose {JSON.stringify(route.params)}</p>
    </div>
  );
}
