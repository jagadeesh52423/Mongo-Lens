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

export function serializeKeyCombo(combo: KeyCombo): string {
  const parts: string[] = [];
  if (combo.cmd) parts.push('cmd');
  if (combo.ctrl) parts.push('ctrl');
  if (combo.shift) parts.push('shift');
  if (combo.alt) parts.push('alt');
  parts.push(combo.key.toLowerCase());
  return parts.join('+');
}

export function deserializeKeyCombo(s: string): KeyCombo {
  const parts = s.split('+').map((p) => p.trim().toLowerCase()).filter((p) => p.length > 0);
  const combo: KeyCombo = { key: '' };
  for (const p of parts) {
    if (p === 'cmd') combo.cmd = true;
    else if (p === 'ctrl') combo.ctrl = true;
    else if (p === 'shift') combo.shift = true;
    else if (p === 'alt') combo.alt = true;
    else combo.key = p;
  }
  return combo;
}

export class KeyboardService {
  private _registry = new Map<string, ShortcutDef>();
  private _defaults = new Map<string, KeyCombo>();
  private _pendingOverrides: Record<string, string> = {};

  register(def: ShortcutDef): () => void {
    if (!this._defaults.has(def.id)) {
      this._defaults.set(def.id, def.keys);
    }
    this._registry.set(def.id, def);
    const pending = this._pendingOverrides[def.id];
    if (pending) {
      this._registry.set(def.id, { ...def, keys: deserializeKeyCombo(pending) });
    }
    return () => {
      this._registry.delete(def.id);
      this._defaults.delete(def.id);
    };
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

  getShortcuts(): ShortcutDef[] {
    return Array.from(this._registry.values());
  }

  applyOverrides(overrides: Record<string, string>): void {
    this._pendingOverrides = { ...overrides };
    for (const [id, def] of this._registry.entries()) {
      const defaults = this._defaults.get(id);
      if (defaults) {
        this._registry.set(id, { ...def, keys: defaults });
      }
    }
    for (const [id, serialized] of Object.entries(overrides)) {
      const def = this._registry.get(id);
      if (!def) continue;
      this._registry.set(id, { ...def, keys: deserializeKeyCombo(serialized) });
    }
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
