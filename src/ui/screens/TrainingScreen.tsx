import type { Route } from '../nav';
import { TopBar } from '../components/TopBar';

/** Placeholder – OWNER see docs/coach/01_PLAN.md (screen "training"). */
export function TrainingScreen({ route }: { route: Route }) {
  return (
    <div className="screen">
      <TopBar title="Training" />
      <p className="placeholder-note">TODO: training {JSON.stringify(route.params)}</p>
    </div>
  );
}
