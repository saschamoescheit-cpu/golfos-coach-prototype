import { IdbStore } from './idb';
import { MemoryStore } from './memory';
import type { CoachStore } from './Store';

/**
 * The app-wide store. Tries IndexedDB; when that is unavailable (old Safari private mode, blocked storage, an open that
 * never answers) it falls back to the in-memory store. `store.kind === 'memory'` → the UI says "data is not saved in
 * this mode". Everybody else just calls getStore().
 */
let pending: Promise<CoachStore> | null = null;

export function getStore(): Promise<CoachStore> {
  if (!pending) pending = openStore();
  return pending;
}

/** Open IndexedDB (or the given factory) and fall back to memory. Exported for tests. */
export async function openStore(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<CoachStore> {
  try {
    return await IdbStore.open(factory);
  } catch (e) {
    console.warn('[coach] IndexedDB unavailable – data is kept in memory only', e);
    return new MemoryStore();
  }
}

/** Tests: inject a fresh store (null → the next getStore() opens again). */
export function setStore(s: CoachStore | null) {
  pending = s ? Promise.resolve(s) : null;
}
