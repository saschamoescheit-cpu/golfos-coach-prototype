import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { t } from '../../coach/i18n/i18n';
import { getStore } from '../../coach/storage';

type Hint = { kind: 'ready' | 'update' | 'memory'; update?: () => void };

let registered = false;

/**
 * Registers the service worker and shows one small toast at the bottom:
 * - "Ready to work offline" once the ~28 MB (app + MediaPipe + models) are cached (first visit),
 * - "A new version is ready – Reload" when an update was downloaded (registerType 'prompt', no surprise reloads),
 * - "Private mode: nothing is saved" when the store fell back to memory.
 */
export function OfflineHint() {
  const [hint, setHint] = useState<Hint | null>(null);

  useEffect(() => {
    if (registered || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    registered = true;
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh: () => setHint({ kind: 'update', update: () => void updateSW(true) }),
      onOfflineReady: () => setHint({ kind: 'ready' }),
      onRegisteredSW: (_url, reg) => {
        // look for a new version when the app comes back to the foreground (home-screen apps are rarely reloaded)
        if (!reg) return;
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible' && navigator.onLine) void reg.update().catch(() => {});
        });
      },
    });
  }, []);

  useEffect(() => {
    void getStore().then((s) => {
      if (s.kind === 'memory') setHint((h) => h ?? { kind: 'memory' });
    });
  }, []);

  useEffect(() => {
    if (hint?.kind !== 'ready' && hint?.kind !== 'memory') return;
    const id = setTimeout(() => setHint((h) => (h === hint ? null : h)), 6000);
    return () => clearTimeout(id);
  }, [hint]);

  if (!hint) return null;
  const text = hint.kind === 'ready' ? t('common.offline.ready') : hint.kind === 'update' ? t('common.offline.update') : t('common.offline.notSaved');
  return (
    <div className="toast" role="status">
      <p>{text}</p>
      {hint.kind === 'update' && (
        <button className="btn-primary" onClick={hint.update}>
          {t('common.offline.reload')}
        </button>
      )}
      <button className="icon-btn" aria-label={t('common.close')} onClick={() => setHint(null)}>
        ✕
      </button>
    </div>
  );
}
