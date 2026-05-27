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
