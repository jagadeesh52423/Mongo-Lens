import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useResizable } from '../useResizable';

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

  it('invert=true: positive delta DECREASES size, negative delta INCREASES size', () => {
    // Positive delta (drag right) → size decreases.
    const { result: posDelta } = renderHook(() =>
      useResizable({ initial: 200, min: 100, max: 400, direction: 'horizontal', invert: true }),
    );
    act(() => posDelta.current.handlers.onPointerDown(ev(100) as never));
    act(() => posDelta.current.handlers.onPointerMove(ev(160) as never)); // delta = +60
    expect(posDelta.current.size).toBe(140); // 200 - 60

    // Negative delta (drag left) → size increases. This is the real-world
    // case for an edge-docked right panel whose handle sits on its left edge.
    const { result: negDelta } = renderHook(() =>
      useResizable({ initial: 200, min: 100, max: 400, direction: 'horizontal', invert: true }),
    );
    act(() => negDelta.current.handlers.onPointerDown(ev(500) as never));
    act(() => negDelta.current.handlers.onPointerMove(ev(420) as never)); // delta = -80
    expect(negDelta.current.size).toBe(280); // 200 + 80
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
