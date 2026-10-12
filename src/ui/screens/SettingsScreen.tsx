import type { Route } from '../nav';
import { TopBar } from '../components/TopBar';

/** Placeholder – OWNER see docs/coach/01_PLAN.md (screen "settings"). */
export function SettingsScreen({ route }: { route: Route }) {
  return (
    <div className="screen">
      <TopBar title="Settings" />
      <p className="placeholder-note">TODO: settings {JSON.stringify(route.params)}</p>
    </div>
  );
}
