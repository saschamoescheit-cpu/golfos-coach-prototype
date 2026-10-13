import { useSyncExternalStore } from 'react';
import type { Settings } from '../model/types';
import { getStore } from './index';
import { defaultSettings } from './memory';

/**
 * Settings shared by all screens. Usage:
 *   const settings = useSettings();          // React, re-renders on change
 *   const s = await loadSettings();          // anywhere (e.g. before analysing)
 *   await updateSettings({ sound: false });  // saves immediately
 * The first value is the default (phone language) until loadSettings() has read the stored row.
 */
let current: Settings = defaultSettings();
let loaded: Promise<Settings> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function loadSettings(): Promise<Settings> {
  if (!loaded) {
    loaded = getStore()
      .then((s) => s.getSettings())
      .then((st) => {
        current = st;
        emit();
        return st;
      })
      .catch(() => current);
  }
  return loaded;
}

export function currentSettings(): Settings {
  return current;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  await loadSettings();
  current = { ...current, ...patch };
  emit();
  const store = await getStore();
  await store.saveSettings(current);
  return current;
}

/** Tests / "delete all data": forget the cached value. */
export function resetSettingsCache() {
  current = defaultSettings();
  loaded = null;
  emit();
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      void loadSettings();
      return () => listeners.delete(cb);
    },
    () => current,
    () => current,
  );
}
