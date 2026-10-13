import type { Swing } from '../model/types';
import { requestPersist, storageInfo } from './device';
import { getStore } from './index';
import { progressRecordsFor } from './progress';

/** Store an analysed swing with its video and its progress rows (used by capture and training). */
export async function persistSwing(swing: Swing, video?: Blob): Promise<Swing> {
  const store = await getStore();
  let s = swing;
  if (video) {
    const key = `video:${swing.id}`;
    try {
      await store.saveVideo(key, video);
      s = { ...swing, videoKey: key };
    } catch {
      // storage full / private mode: keep the analysis without the video
    }
  }
  await store.saveSwing(s);
  await store.addProgress(progressRecordsFor(s));
  if (store.kind === 'indexeddb') askPersistOnce();
  return s;
}

let persistAsked = false;
/** The first stored swing is the moment the data becomes worth keeping → ask the browser once to protect it (no prompt in Safari). */
function askPersistOnce() {
  if (persistAsked) return;
  persistAsked = true;
  void storageInfo()
    .then((i) => (i.persisted === false ? requestPersist() : undefined))
    .catch(() => {});
}

export function newId(prefix = ''): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix ? `${prefix}_${r}` : r;
}
