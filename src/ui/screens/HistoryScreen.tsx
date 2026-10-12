import type { Route } from '../nav';
import { TopBar } from '../components/TopBar';

/** Placeholder – OWNER see docs/coach/01_PLAN.md (screen "history"). */
export function HistoryScreen({ route }: { route: Route }) {
  return (
    <div className="screen">
      <TopBar title="History" />
      <p className="placeholder-note">TODO: history {JSON.stringify(route.params)}</p>
    </div>
  );
}
