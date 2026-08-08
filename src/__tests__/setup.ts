import '@testing-library/jest-dom';
import { vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(),
  open: vi.fn(),
}));

// jsdom in this project exposes `localStorage` as a plain `{}` (not a Storage
// instance), so calls like `localStorage.getItem(...)` throw. Install a
// minimal in-memory Storage-compatible shim used by hooks such as
// `useResizable` that persist UI state.
const __lsStore = new Map<string, string>();
const __lsShim: Storage = {
  getItem: (k: string) => (__lsStore.has(k) ? __lsStore.get(k)! : null),
  setItem: (k: string, v: string) => { __lsStore.set(k, String(v)); },
  removeItem: (k: string) => { __lsStore.delete(k); },
  clear: () => { __lsStore.clear(); },
  key: (i: number) => Array.from(__lsStore.keys())[i] ?? null,
  get length() { return __lsStore.size; },
};
Object.defineProperty(globalThis, 'localStorage', { value: __lsShim, configurable: true, writable: true });
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', { value: __lsShim, configurable: true, writable: true });
}

// Shortcut definitions are app-wide boot state: main.tsx defines all of
// DEFAULT_SHORTCUTS before anything renders. Mirror that here so a component
// test sees the same definition map as production. Previously each module
// defined its own slice at import time, which meant a test only had whatever
// definitions its imports happened to drag in — implicit, and wrong whenever a
// component registered a handler for an id defined by some other module.
import { keyboardService } from '../services/KeyboardService';
import { DEFAULT_SHORTCUTS } from '../shortcuts/defaults';

DEFAULT_SHORTCUTS.forEach((def) => keyboardService.defineShortcut(def));
