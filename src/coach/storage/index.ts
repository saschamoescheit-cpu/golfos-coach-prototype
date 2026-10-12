import { MemoryStore } from './memory';
import type { CoachStore } from './Store';

/**
 * OWNER: agent "history-i18n-offline" (work package F) replaces the body with: try IndexedDB (storage/idb.ts),
 * fall back to MemoryStore. Everybody else just calls getStore().
 */
let store: CoachStore | null = null;

export async function getStore(): Promise<CoachStore> {
  if (!store) store = new MemoryStore();
  return store;
}

/** Tests: inject a fresh store. */
export function setStore(s: CoachStore | null) {
  store = s;
}
