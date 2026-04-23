import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import type { Logger } from './logger';
import { NoopLogger } from './logger/NoopLogger';

export interface KeyCombo {
  cmd?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  key: string;
}

// implement this interface and call defineShortcut() to register a new shortcut
export interface ShortcutDefinition {
  id: string;
  keys: KeyCombo;
  label: string;
  scope: string;
  showInContextMenu?: boolean;
}

export interface ShortcutDef {
  id: string;
  keys: KeyCombo;
  label: string;
  action: () => void;
  showInContextMenu?: boolean;
  scope?: string;
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

const noop = (): void => {};

export class KeyboardService {
  // Permanent registry — survives component unmount, source of truth for settings UI.
  private definitions = new Map<string, ShortcutDefinition>();
  // Ephemeral — bound to component lifecycle; dispatch fires from here only.
  private handlers = new Map<string, () => void>();
  private _defaults = new Map<string, KeyCombo>();
  private _pendingOverrides: Record<string, string> = {};
  private logger: Logger = new NoopLogger();

  setLogger(logger: Logger): void {
    this.logger = logger;
  }

  private resolveScopes(el: Element | null): string[] {
    const scopes: string[] = [];
    let node: Element | null = el;
    while (node) {
      const s = node.getAttribute('data-keyboard-scope');
      if (s) scopes.push(s);
      node = node.parentElement;
    }
    return scopes;
  }

  defineShortcut(def: ShortcutDefinition): void {
    if (this.definitions.has(def.id)) return;
    this._defaults.set(def.id, def.keys);
    const pending = this._pendingOverrides[def.id];
    const finalDef = pending ? { ...def, keys: deserializeKeyCombo(pending) } : def;
    this.definitions.set(def.id, finalDef);
    this.logger.debug('shortcut registered', { id: def.id, scope: def.scope });
  }

  register(id: string, handler: () => void): () => void {
    this.handlers.set(id, handler);
    return () => {
      if (this.handlers.get(id) === handler) {
        this.handlers.delete(id);
      }
    };
  }

  dispatch(e: KeyboardEvent): void {
    const scopes = this.resolveScopes(document.activeElement);
    for (const [id, handler] of this.handlers.entries()) {
      const def = this.definitions.get(id);
      if (!def) continue;
      if (def.scope !== 'global' && !scopes.includes(def.scope)) continue;
      const k = def.keys;
      if (
        e.key.toLowerCase() === k.key.toLowerCase() &&
        !!e.metaKey === !!k.cmd &&
        !!e.ctrlKey === !!k.ctrl &&
        !!e.shiftKey === !!k.shift &&
        !!e.altKey === !!k.alt
      ) {
        e.preventDefault();
        e.stopPropagation();
        handler();
        return;
      }
    }
  }

  getDefinitions(): ShortcutDefinition[] {
    return Array.from(this.definitions.values());
  }

  getShortcuts(): ShortcutDef[] {
    return Array.from(this.definitions.values()).map((def) => ({
      id: def.id,
      keys: def.keys,
      label: def.label,
      scope: def.scope,
      showInContextMenu: def.showInContextMenu,
      action: this.handlers.get(def.id) ?? noop,
    }));
  }

  applyOverrides(overrides: Record<string, string>): void {
    this._pendingOverrides = { ...overrides };
    for (const [id, def] of this.definitions.entries()) {
      const defaults = this._defaults.get(id);
      if (defaults) {
        this.definitions.set(id, { ...def, keys: defaults });
      }
    }
    for (const [id, serialized] of Object.entries(overrides)) {
      const def = this.definitions.get(id);
      if (!def) continue;
      this.definitions.set(id, { ...def, keys: deserializeKeyCombo(serialized) });
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
