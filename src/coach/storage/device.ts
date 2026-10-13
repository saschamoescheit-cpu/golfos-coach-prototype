/**
 * Browser storage quota and "persistent storage" (navigator.storage). Why it matters on the iPhone: Safari may delete the
 * data of a website that has not been used for a while (7-day rule for sites in the browser tab) or when the phone runs
 * out of space. Apps added to the home screen are treated better, and a granted persist() request asks the browser not
 * to evict the data automatically. All functions degrade gracefully when the API is missing (older iOS).
 */

export interface StorageInfo {
  /** bytes used by this app (all origins' storage the browser counts for us), undefined when unknown */
  usage?: number;
  /** bytes the browser would allow, undefined when unknown */
  quota?: number;
  /** true = browser promised not to evict; undefined = API missing */
  persisted?: boolean;
}

function storageManager(): StorageManager | undefined {
  return typeof navigator !== 'undefined' ? navigator.storage : undefined;
}

export async function storageInfo(): Promise<StorageInfo> {
  const sm = storageManager();
  const info: StorageInfo = {};
  try {
    if (sm?.estimate) {
      const e = await sm.estimate();
      info.usage = e.usage;
      info.quota = e.quota;
    }
  } catch {
    /* unknown */
  }
  try {
    if (sm?.persisted) info.persisted = await sm.persisted();
  } catch {
    /* unknown */
  }
  return info;
}

/** Ask the browser to keep our data. Returns the new state (undefined when the API is missing). */
export async function requestPersist(): Promise<boolean | undefined> {
  const sm = storageManager();
  if (!sm?.persist) return undefined;
  try {
    return await sm.persist();
  } catch {
    return false;
  }
}

/** True when the app runs from the home screen (standalone) – then Safari keeps the data much more reliably. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/** "12.4 MB" style – plain bytes formatting for the settings screen. */
export function formatBytes(bytes: number, lang: 'en' | 'de' = 'en'): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  const digits = i === 0 || v >= 100 ? 0 : 1;
  return `${v.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${units[i]}`;
}
