import type { FaultProgressRecord, Session, Settings, ShotType, Swing, TrainingTarget } from '../model/types';
import { defaultSettings } from './memory';
import type { CoachStore } from './Store';

/**
 * IndexedDB implementation of CoachStore (work package F). Plain IndexedDB API, no runtime dependency.
 *
 * Schema (DB_NAME, version DB_VERSION):
 *   swings    keyPath id        indexes shotType, createdAt, sessionId
 *   videos    out-of-line key   value = VideoRecord (Blob, or ArrayBuffer + type where Blobs cannot be stored)
 *   sessions  keyPath id        index createdAt
 *   targets   keyPath id
 *   progress  keyPath id        indexes faultId, ts, swingId (swingId → cascade delete)
 *   settings  out-of-line key   single row SETTINGS_KEY
 *
 * Upgrades: add a new `if (oldVersion < N)` block in `upgrade()` – never edit an old block. Every block must be able to run
 * on top of the previous version so users with old data keep it.
 */
export const DB_NAME = 'golfos-coach';
export const DB_VERSION = 1;
const SETTINGS_KEY = 'settings';

type StoreName = 'swings' | 'videos' | 'sessions' | 'targets' | 'progress' | 'settings';
const ALL_STORES: StoreName[] = ['swings', 'videos', 'sessions', 'targets', 'progress', 'settings'];

/**
 * How a video is stored. Older iOS Safari (≤ 12/13) failed with DataCloneError or lost the data when a Blob was put into
 * IndexedDB, so we fall back to the raw bytes.
 */
type VideoRecord = { kind: 'blob'; blob: Blob } | { kind: 'bytes'; bytes: ArrayBuffer; type: string };

export function upgrade(db: IDBDatabase, oldVersion: number, tx: IDBTransaction | null) {
  void tx; // available for data migrations in later versions (tx.objectStore(...))
  if (oldVersion < 1) {
    const swings = db.createObjectStore('swings', { keyPath: 'id' });
    swings.createIndex('shotType', 'shotType');
    swings.createIndex('createdAt', 'createdAt');
    swings.createIndex('sessionId', 'sessionId');
    db.createObjectStore('videos');
    const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
    sessions.createIndex('createdAt', 'createdAt');
    db.createObjectStore('targets', { keyPath: 'id' });
    const progress = db.createObjectStore('progress', { keyPath: 'id' });
    progress.createIndex('faultId', 'faultId');
    progress.createIndex('ts', 'ts');
    progress.createIndex('swingId', 'swingId');
    db.createObjectStore('settings');
  }
  // if (oldVersion < 2) { … }
}

/** Promise wrapper for one request. */
function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** Resolves when the transaction has committed (writes are durable only then). */
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/**
 * Open (and create/upgrade) the database. Rejects when IndexedDB is missing or blocked (e.g. some private modes) and
 * after `timeoutMs` – a few iOS versions never fire any event on the very first open.
 */
export function openCoachDb(factory: IDBFactory | undefined = globalThis.indexedDB, timeoutMs = 4000): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!factory) return reject(new Error('IndexedDB not available'));
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('IndexedDB open timed out'));
      }
    }, timeoutMs);
    let r: IDBOpenDBRequest;
    try {
      r = factory.open(DB_NAME, DB_VERSION);
    } catch (e) {
      clearTimeout(timer);
      return reject(e);
    }
    r.onupgradeneeded = (ev) => upgrade(r.result, ev.oldVersion, r.transaction);
    r.onsuccess = () => {
      clearTimeout(timer);
      const db = r.result;
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      // another tab with a newer app version wants to upgrade → let it
      db.onversionchange = () => db.close();
      resolve(db);
    };
    r.onerror = () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(r.error ?? new Error('IndexedDB open failed'));
      }
    };
    r.onblocked = () => {
      // an old tab keeps the DB open; the open continues once it closes – the timeout covers the worst case
    };
  });
}

async function blobToBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Response(blob).arrayBuffer();
}

export interface IdbStoreOptions {
  /** store videos as ArrayBuffer + type right away (tests, or a platform known to break Blobs in IndexedDB) */
  forceBytes?: boolean;
}

export class IdbStore implements CoachStore {
  readonly kind = 'indexeddb' as const;
  /** null = not probed yet; false after the first Blob write failed → bytes from then on */
  private blobsWork: boolean | null;

  constructor(
    private db: IDBDatabase,
    opts: IdbStoreOptions = {},
  ) {
    this.blobsWork = opts.forceBytes ? false : null;
  }

  static async open(factory?: IDBFactory, opts?: IdbStoreOptions): Promise<IdbStore> {
    const db = await openCoachDb(factory);
    const s = new IdbStore(db, opts);
    // smoke test: some private modes open the DB but every transaction fails
    await s.getSettings();
    return s;
  }

  /** How videos are written at the moment – shown nowhere, but handy when debugging on an old iPhone. */
  get videoMode(): 'blob' | 'bytes' | 'unknown' {
    return this.blobsWork === null ? 'unknown' : this.blobsWork ? 'blob' : 'bytes';
  }

  close() {
    this.db.close();
  }

  private tx(stores: StoreName | StoreName[], mode: IDBTransactionMode = 'readonly') {
    return this.db.transaction(stores, mode);
  }

  private async put(store: StoreName, value: unknown, key?: IDBValidKey) {
    const tx = this.tx(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    await done(tx);
  }

  private async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    return (await req(this.tx(store).objectStore(store).get(key))) as T | undefined;
  }

  // ---------------------------------------------------------------- swings

  async saveSwing(swing: Swing) {
    await this.put('swings', swing);
  }

  async getSwing(id: string) {
    return this.get<Swing>('swings', id);
  }

  /** Newest first. Filters use the indexes; the combination of filters is applied in memory (small data). */
  async listSwings(f: { shotType?: ShotType; sessionId?: string; limit?: number } = {}): Promise<Swing[]> {
    const os = this.tx('swings').objectStore('swings');
    let list: Swing[];
    if (f.sessionId) list = (await req(os.index('sessionId').getAll(f.sessionId))) as Swing[];
    else if (f.shotType) list = (await req(os.index('shotType').getAll(f.shotType))) as Swing[];
    else list = (await req(os.index('createdAt').getAll())) as Swing[];
    if (f.shotType) list = list.filter((s) => s.shotType === f.shotType);
    list.sort((a, b) => b.createdAt - a.createdAt);
    return f.limit ? list.slice(0, f.limit) : list;
  }

  /**
   * Deletes the swing, its video and its progress rows in one transaction. Callback style on purpose: older Safari
   * versions commit a transaction when the next request is issued from a promise continuation.
   */
  async deleteSwing(id: string) {
    const tx = this.tx(['swings', 'videos', 'progress'], 'readwrite');
    const swings = tx.objectStore('swings');
    const progress = tx.objectStore('progress');
    const get = swings.get(id);
    get.onsuccess = () => {
      const s = get.result as Swing | undefined;
      if (s?.videoKey) tx.objectStore('videos').delete(s.videoKey);
      swings.delete(id);
    };
    const keys = progress.index('swingId').getAllKeys(id);
    keys.onsuccess = () => {
      for (const k of keys.result) progress.delete(k);
    };
    await done(tx);
  }

  // ---------------------------------------------------------------- videos

  async saveVideo(key: string, blob: Blob) {
    if (this.blobsWork !== false) {
      try {
        await this.put('videos', { kind: 'blob', blob } satisfies VideoRecord, key);
        if (this.blobsWork === null) this.blobsWork = await this.verifyBlob(key, blob.size);
        if (this.blobsWork) return;
      } catch {
        this.blobsWork = false; // DataCloneError on old Safari
      }
    }
    const bytes = await blobToBytes(blob);
    await this.put('videos', { kind: 'bytes', bytes, type: blob.type } satisfies VideoRecord, key);
  }

  /** Old iOS Safari stored Blobs "successfully" but returned empty/unreadable ones – read the first write back once. */
  private async verifyBlob(key: string, size: number): Promise<boolean> {
    try {
      const rec = await this.get<VideoRecord>('videos', key);
      if (!rec || rec.kind !== 'blob' || rec.blob.size !== size) return false;
      if (size > 0) await blobToBytes(rec.blob.slice(0, Math.min(size, 16)));
      return true;
    } catch {
      return false;
    }
  }

  async getVideo(key: string): Promise<Blob | undefined> {
    const rec = await this.get<VideoRecord | Blob>('videos', key);
    if (!rec) return undefined;
    if (typeof Blob !== 'undefined' && rec instanceof Blob) return rec; // tolerate a bare Blob
    const r = rec as VideoRecord;
    if (r.kind === 'blob') return r.blob;
    return new Blob([r.bytes], { type: r.type });
  }

  // ---------------------------------------------------------------- sessions

  async saveSession(session: Session) {
    await this.put('sessions', session);
  }

  async getSession(id: string) {
    return this.get<Session>('sessions', id);
  }

  async listSessions(limit?: number): Promise<Session[]> {
    const list = (await req(this.tx('sessions').objectStore('sessions').getAll())) as Session[];
    list.sort((a, b) => b.createdAt - a.createdAt);
    return limit ? list.slice(0, limit) : list;
  }

  // ---------------------------------------------------------------- targets

  async saveTarget(target: TrainingTarget) {
    await this.put('targets', target);
  }

  async listTargets(): Promise<TrainingTarget[]> {
    return (await req(this.tx('targets').objectStore('targets').getAll())) as TrainingTarget[];
  }

  async deleteTarget(id: string) {
    const tx = this.tx('targets', 'readwrite');
    tx.objectStore('targets').delete(id);
    await done(tx);
  }

  // ---------------------------------------------------------------- progress

  async addProgress(records: FaultProgressRecord[]) {
    if (!records.length) return;
    const tx = this.tx('progress', 'readwrite');
    const os = tx.objectStore('progress');
    for (const r of records) os.put(r); // put: re-analysing a swing replaces its rows (id = swingId:faultId)
    await done(tx);
  }

  /** Oldest first (time series order). */
  async listProgress(f: { faultId?: string; shotType?: ShotType } = {}): Promise<FaultProgressRecord[]> {
    const os = this.tx('progress').objectStore('progress');
    let list = (await req(f.faultId ? os.index('faultId').getAll(f.faultId) : os.getAll())) as FaultProgressRecord[];
    if (f.shotType) list = list.filter((p) => p.shotType === f.shotType);
    return list.sort((a, b) => a.ts - b.ts);
  }

  // ---------------------------------------------------------------- settings

  async getSettings(): Promise<Settings> {
    const s = await this.get<Partial<Settings>>('settings', SETTINGS_KEY);
    // merge: settings added in later versions get their default
    return { ...defaultSettings(), ...(s ?? {}) };
  }

  async saveSettings(settings: Settings) {
    await this.put('settings', { ...settings }, SETTINGS_KEY);
  }

  // ---------------------------------------------------------------- maintenance

  async clearAll() {
    const tx = this.tx(ALL_STORES, 'readwrite');
    for (const s of ALL_STORES) tx.objectStore(s).clear();
    await done(tx);
  }
}
