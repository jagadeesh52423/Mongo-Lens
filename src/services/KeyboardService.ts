import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';

export interface KeyCombo {
  cmd?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  key: string;
}

export interface ShortcutDef {
  id: string;
  keys: KeyCombo;
  label: string;
  action: () => void;
  showInContextMenu?: boolean;
}

export function formatKeyCombo(keys: KeyCombo): string {
  const parts: string[] = [];
  if (keys.ctrl) parts.push('⌃');
  if (keys.shift) parts.push('⇧');
  if (keys.alt) parts.push('⌥');
  if (keys.cmd) parts.push('⌘');
  parts.push(keys.key.toUpperCase());
  return parts.join('');
}

export class KeyboardService {
  private _registry = new Map<string, ShortcutDef>();

  register(def: ShortcutDef): () => void {
    this._registry.set(def.id, def);
    return () => this._registry.delete(def.id);
  }

  dispatch(e: KeyboardEvent): void {
    for (const def of this._registry.values()) {
      const k = def.keys;
      if (
        e.key.toLowerCase() === k.key.toLowerCase() &&
        !!e.metaKey === !!k.cmd &&
        !!e.ctrlKey === !!k.ctrl &&
        !!e.shiftKey === !!k.shift &&
        !!e.altKey === !!k.alt
      ) {
        e.preventDefault();
        def.action();
        return;
      }
    }
  }

  getAll(): ShortcutDef[] {
    return Array.from(this._registry.values());
  }
}

export const keyboardService = new KeyboardService();

export const KeyboardServiceContext = createContext<KeyboardService>(keyboardService);

export function KeyboardServiceProvider({
  svc,
  children,
}: {
  svc?: KeyboardService;
  children: ReactNode;
}) {
  const value = useMemo(() => svc ?? new KeyboardService(), [svc]);
  return createElement(KeyboardServiceContext.Provider, { value }, children);
}

export function useKeyboardService(): KeyboardService {
  return useContext(KeyboardServiceContext);
}
