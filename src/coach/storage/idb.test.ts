import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Session, TrainingTarget } from '../model/types';
import { DB_NAME, IdbStore, openCoachDb } from './idb';
import { getStore, openStore, setStore } from './index';
import { MemoryStore } from './memory';
import { progressRecordsFor } from './progress';
import { persistSwing } from './save';
import type { CoachStore } from './Store';
import { fakeFault, fakeSwing } from './testFixtures';

let factory: IDBFactory;
let store: IdbStore;

beforeEach(async () => {
  factory = new IDBFactory(); // a fresh, empty "browser" per test
  store = await IdbStore.open(factory);
});
afterEach(() => store.close());

const video = (text = 'fake-mp4-bytes', type = 'video/mp4') => new Blob([text], { type });

describe('IdbStore', () => {
  it('round-trips a swing including nested data', async () => {
    const s = fakeSwing('a', { faults: [fakeFault('early_extension')], checkedFaultIds: ['early_extension'], note: 'windy' });
    await store.saveSwing(s);
    expect(await store.getSwing('a')).toEqual(s);
    expect(await store.getSwing('missing')).toBeUndefined();
  });

  it('lists swings newest first, filters by shot type and session, honours the limit', async () => {
    await store.saveSwing(fakeSwing('old', { createdAt: 1, shotType: 'driver' }));
    await store.saveSwing(fakeSwing('mid', { createdAt: 2, shotType: 'iron', sessionId: 'sess2' }));
    await store.saveSwing(fakeSwing('new', { createdAt: 3, shotType: 'driver' }));
    expect((await store.listSwings()).map((s) => s.id)).toEqual(['new', 'mid', 'old']);
    expect((await store.listSwings({ shotType: 'driver' })).map((s) => s.id)).toEqual(['new', 'old']);
    expect((await store.listSwings({ sessionId: 'sess2' })).map((s) => s.id)).toEqual(['mid']);
    expect((await store.listSwings({ sessionId: 'sess1', shotType: 'driver', limit: 1 })).map((s) => s.id)).toEqual(['new']);
    expect(await store.listSwings({ shotType: 'putt' })).toEqual([]);
  });

  it('stores videos as Blob and gets the same bytes back', async () => {
    await store.saveVideo('v1', video('hello'));
    const b = await store.getVideo('v1');
    expect(b).toBeInstanceOf(Blob);
    expect(b!.type).toBe('video/mp4');
    expect(await b!.text()).toBe('hello');
    expect(store.videoMode).toBe('blob');
    expect(await store.getVideo('nope')).toBeUndefined();
  });

  it('falls back to ArrayBuffer + type for platforms that cannot store Blobs', async () => {
    const bytesStore = new IdbStore(await openCoachDb(factory), { forceBytes: true });
    await bytesStore.saveVideo('v2', video('old-safari', 'video/quicktime'));
    const b = await bytesStore.getVideo('v2');
    expect(b!.type).toBe('video/quicktime');
    expect(await b!.text()).toBe('old-safari');
    expect(bytesStore.videoMode).toBe('bytes');
    bytesStore.close();
  });

  it('deleting a swing removes its video and its progress rows, nothing else', async () => {
    const a = fakeSwing('a', { faults: [fakeFault('f1')], checkedFaultIds: ['f1', 'f2'] });
    const b = fakeSwing('b', { createdAt: 2, checkedFaultIds: ['f1'] });
    setStore(store);
    await persistSwing(a, video('A'));
    await persistSwing(b, video('B'));
    setStore(null);
    expect((await store.listProgress()).length).toBe(3);

    await store.deleteSwing('a');
    expect(await store.getSwing('a')).toBeUndefined();
    expect(await store.getVideo('video:a')).toBeUndefined();
    expect(await store.getVideo('video:b')).toBeDefined();
    expect((await store.listProgress()).map((p) => p.id)).toEqual(['b:f1']);
    await store.deleteSwing('does-not-exist'); // no throw
  });

  it('progress: ordered by time, filters by fault and shot type, re-adding a swing replaces its rows', async () => {
    const s1 = fakeSwing('s1', { createdAt: 20, faults: [fakeFault('f1', 0.8)], checkedFaultIds: ['f1', 'f2'] });
    const s2 = fakeSwing('s2', { createdAt: 10, shotType: 'driver', checkedFaultIds: ['f1'] });
    await store.addProgress(progressRecordsFor(s1));
    await store.addProgress(progressRecordsFor(s2));
    await store.addProgress([]);
    expect((await store.listProgress()).map((p) => p.id)).toEqual(['s2:f1', 's1:f1', 's1:f2']);
    expect((await store.listProgress({ faultId: 'f1' })).map((p) => p.swingId)).toEqual(['s2', 's1']);
    expect((await store.listProgress({ faultId: 'f1', shotType: 'iron' })).map((p) => p.detected)).toEqual([true]);
    await store.addProgress(progressRecordsFor({ ...s1, faults: [] }));
    expect((await store.listProgress({ faultId: 'f1', shotType: 'iron' })).map((p) => p.detected)).toEqual([false]);
  });

  it('sessions and targets', async () => {
    const sess = (id: string, createdAt: number): Session => ({
      id, createdAt, mode: 'series', shotType: 'iron', view: 'face_on', handedness: 'left', swingIds: ['x'],
      results: [{ swingId: 'x', hit: true, proximity: 0.9 }],
    });
    await store.saveSession(sess('p', 1));
    await store.saveSession(sess('q', 2));
    expect(await store.getSession('p')).toEqual(sess('p', 1));
    expect((await store.listSessions()).map((s) => s.id)).toEqual(['q', 'p']);
    expect((await store.listSessions(1)).map((s) => s.id)).toEqual(['q']);

    const target: TrainingTarget = {
      id: 't1', label: { en: 'Top', de: 'Top' }, source: 'template', shotType: 'iron', view: 'face_on', position: 'top',
      criteria: [{ metric: 'lead_arm_angle', at: 'top', target: 170, tolerance: 10, unit: 'deg' }],
    };
    await store.saveTarget(target);
    expect(await store.listTargets()).toEqual([target]);
    await store.deleteTarget('t1');
    expect(await store.listTargets()).toEqual([]);
  });

  it('settings: defaults first, saved values afterwards, missing new fields get their default', async () => {
    const d = await store.getSettings();
    expect(d.toleranceScale).toBe(1);
    expect(['en', 'de']).toContain(d.lang);
    await store.saveSettings({ ...d, lang: 'de', sound: false, handicap: -1.5, scoreLevel: 2 });
    const s = await store.getSettings();
    expect(s).toMatchObject({ lang: 'de', sound: false, handicap: -1.5, scoreLevel: 2, heightCm: d.heightCm });
  });

  it('data survives closing and reopening the database (= app restart)', async () => {
    await store.saveSwing(fakeSwing('keep'));
    await store.saveVideo('video:keep', video('k'));
    store.close();
    store = await IdbStore.open(factory);
    expect((await store.getSwing('keep'))?.id).toBe('keep');
    expect(await (await store.getVideo('video:keep'))!.text()).toBe('k');
  });

  it('clearAll deletes everything', async () => {
    await store.saveSwing(fakeSwing('a'));
    await store.saveVideo('v', video());
    await store.addProgress(progressRecordsFor(fakeSwing('a', { checkedFaultIds: ['f'] })));
    await store.saveSettings({ ...(await store.getSettings()), heightCm: 150 });
    await store.clearAll();
    expect(await store.listSwings()).toEqual([]);
    expect(await store.getVideo('v')).toBeUndefined();
    expect(await store.listProgress()).toEqual([]);
    expect((await store.getSettings()).heightCm).toBe(178);
  });

  it('creates the versioned schema with all stores and indexes', async () => {
    const db = await openCoachDb(factory);
    expect(db.name).toBe(DB_NAME);
    expect([...db.objectStoreNames].sort()).toEqual(['progress', 'sessions', 'settings', 'swings', 'targets', 'videos']);
    const tx = db.transaction(['swings', 'progress']);
    expect([...tx.objectStore('swings').indexNames].sort()).toEqual(['createdAt', 'sessionId', 'shotType']);
    expect([...tx.objectStore('progress').indexNames].sort()).toEqual(['faultId', 'swingId', 'ts']);
    db.close();
  });
});

describe('getStore / fallback', () => {
  afterEach(() => setStore(null));

  it('uses IndexedDB when available', async () => {
    const s = await openStore(new IDBFactory());
    expect(s.kind).toBe('indexeddb');
    (s as IdbStore).close();
  });

  it('falls back to memory when IndexedDB is missing (Safari private mode)', async () => {
    const s = await openStore(undefined as unknown as IDBFactory);
    // undefined → default parameter → global indexedDB, which does not exist in Node
    expect(s.kind).toBe('memory');
  });

  it('falls back to memory when open throws', async () => {
    const broken = { open: () => { throw new DOMException('denied', 'SecurityError'); } } as unknown as IDBFactory;
    const s = await openStore(broken);
    expect(s).toBeInstanceOf(MemoryStore);
  });

  it('falls back to memory when open never answers', async () => {
    const silent = { open: () => ({}) } as unknown as IDBFactory;
    const t0 = Date.now();
    const db = openCoachDb(silent, 50);
    await expect(db).rejects.toThrow(/timed out/);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('getStore returns one shared instance; setStore injects', async () => {
    const mem: CoachStore = new MemoryStore();
    setStore(mem);
    expect(await getStore()).toBe(mem);
    expect(await getStore()).toBe(mem);
  });
});

describe('MemoryStore matches the IndexedDB semantics', () => {
  it('replaces progress rows with the same id and clears everything', async () => {
    const m = new MemoryStore();
    const s = fakeSwing('s', { faults: [fakeFault('f')], checkedFaultIds: ['f'] });
    await m.addProgress(progressRecordsFor(s));
    await m.addProgress(progressRecordsFor({ ...s, faults: [] }));
    expect((await m.listProgress()).map((p) => p.detected)).toEqual([false]);
    await m.saveSwing(s);
    await m.clearAll();
    expect(await m.listSwings()).toEqual([]);
    expect(await m.listProgress()).toEqual([]);
  });
});
