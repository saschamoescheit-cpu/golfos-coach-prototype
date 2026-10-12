import { useSyncExternalStore } from 'react';

/**
 * Minimal navigation (no router dependency): a stack of screens with params.
 * Screens: home, capture {mode?}, analysis {swingId}, training {targetId? | faultId? | swingId?}, history {shotType?},
 * compare {a, b}, diagnose, settings.
 */
export type ScreenName = 'home' | 'capture' | 'analysis' | 'training' | 'history' | 'compare' | 'diagnose' | 'settings';
export interface Route {
  name: ScreenName;
  params: Record<string, string | undefined>;
}

let stack: Route[] = [{ name: 'home', params: {} }];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function go(name: ScreenName, params: Route['params'] = {}) {
  stack = [...stack, { name, params }];
  emit();
}
/** Replace the current screen (e.g. capture → analysis, so "back" returns home). */
export function replace(name: ScreenName, params: Route['params'] = {}) {
  stack = [...stack.slice(0, -1), { name, params }];
  emit();
}
export function back() {
  if (stack.length > 1) stack = stack.slice(0, -1);
  emit();
}
export function home() {
  stack = [{ name: 'home', params: {} }];
  emit();
}
export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => stack[stack.length - 1],
  );
}
