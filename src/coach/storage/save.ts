import type { Swing } from '../model/types';
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
  return s;
}

export function newId(prefix = ''): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix ? `${prefix}_${r}` : r;
}
