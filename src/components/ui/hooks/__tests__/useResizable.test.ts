import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useResizable } from '../useResizable';

// jsdom in this project exposes `localStorage` as a plain `{}`. Install a
// minimal Storage-compatible shim so persistence assertions can use real
// getItem/setItem/removeItem semantics.
function installLocalStorageShim() {
  const store = new Map<string, string>();
  const shim = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: shim, configurable: true, writable: true });
  Object.defineProperty(window, 'localStorage', { value: shim, configurable: true, writable: true });
}
installLocalStorageShim();

type PointerLike = {
  clientX: number; clientY: number; pointerId: number;
  target: { setPointerCapture: (id: number) => void };
};
function ev(x: number, y = 0): PointerLike {
  return {
    clientX: x, clientY: y, pointerId: 1,
    target: { setPointerCapture: () => {} },
  };
}

describe('useResizable', () => {
  beforeEach(() => {
    localStorage.removeItem('test.width');
  });

  it('grows when dragged in the natural direction (horizontal, invert=false)', () => {
    const { result } = renderHook(() =>
      useResizable({ initial: 200, min: 100, max: 400, direction: 'horizontal' }),
    );
    act(() => result.current.handlers.onPointerDown(ev(100) as never));
    act(() => result.current.handlers.onPointerMove(ev(150) as never));
    // dragged +50 right => size grows by 50
    expect(result.current.size).toBe(250);
  });

  it('grows when dragged in the inverted direction (invert=true)', () => {
    const { result } = renderHook(() =>
      useResizable({ initial: 200, min: 100, max: 400, direction: 'horizontal', invert: true }),
    );
    act(() => result.current.handlers.onPointerDown(ev(500) as never));
    // dragged LEFT by 80 — for an edge-docked panel that should INCREASE width
    act(() => result.current.handlers.onPointerMove(ev(420) as never));
    expect(result.current.size).toBe(280);
  });

  it('clamps to min/max regardless of invert', () => {
    const { result } = renderHook(() =>
      useResizable({ initial: 200, min: 150, max: 250, direction: 'horizontal', invert: true }),
    );
    act(() => result.current.handlers.onPointerDown(ev(500) as never));
    // dragged way LEFT — would exceed max
    act(() => result.current.handlers.onPointerMove(ev(0) as never));
    expect(result.current.size).toBe(250);
    // dragged way RIGHT — would go below min
    act(() => result.current.handlers.onPointerMove(ev(1000) as never));
    expect(result.current.size).toBe(150);
  });

  it('persists size to localStorage when storageKey set', () => {
    const { result } = renderHook(() =>
      useResizable({
        initial: 200, min: 100, max: 400, direction: 'horizontal',
        storageKey: 'test.width',
      }),
    );
    act(() => result.current.handlers.onPointerDown(ev(0) as never));
    act(() => result.current.handlers.onPointerMove(ev(50) as never));
    act(() => result.current.handlers.onPointerUp());
    expect(localStorage.getItem('test.width')).toBe('250');
  });

  it('rehydrates from localStorage on mount', () => {
    localStorage.setItem('test.width', '300');
    const { result } = renderHook(() =>
      useResizable({
        initial: 200, min: 100, max: 400, direction: 'horizontal',
        storageKey: 'test.width',
      }),
    );
    expect(result.current.size).toBe(300);
  });

  it('ignores stale storage outside [min,max]', () => {
    localStorage.setItem('test.width', '999');
    const { result } = renderHook(() =>
      useResizable({
        initial: 200, min: 100, max: 400, direction: 'horizontal',
        storageKey: 'test.width',
      }),
    );
    expect(result.current.size).toBe(200);
  });
});
