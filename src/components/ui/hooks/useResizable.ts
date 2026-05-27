import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

interface Options {
  initial: number; min: number; max: number;
  direction: 'horizontal' | 'vertical';
  storageKey?: string;
}

export function useResizable({ initial, min, max, direction, storageKey }: Options) {
  const [size, setSize] = useState(() => {
    if (storageKey) {
      const v = Number(localStorage.getItem(storageKey));
      if (Number.isFinite(v) && v >= min && v <= max) return v;
    }
    return initial;
  });
  const dragRef = useRef<{ startPos: number; startSize: number } | null>(null);

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      startPos: direction === 'horizontal' ? e.clientX : e.clientY,
      startSize: size,
    };
  }, [size, direction]);

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    if (!dragRef.current) return;
    const cur = direction === 'horizontal' ? e.clientX : e.clientY;
    const delta = cur - dragRef.current.startPos;
    const next = Math.max(min, Math.min(max, dragRef.current.startSize + delta));
    setSize(next);
  }, [direction, min, max]);

  const onPointerUp = useCallback(() => {
    if (dragRef.current && storageKey) localStorage.setItem(storageKey, String(size));
    dragRef.current = null;
  }, [size, storageKey]);

  useEffect(() => {
    if (storageKey) localStorage.setItem(storageKey, String(size));
  }, [size, storageKey]);

  return { size, setSize, handlers: { onPointerDown, onPointerMove, onPointerUp } } as const;
}
