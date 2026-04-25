import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyboardService, formatKeyCombo } from '../services/KeyboardService';

let svc: KeyboardService;

beforeEach(() => {
  svc = new KeyboardService();
});

function makeKeyEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: 'c',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

describe('KeyboardService', () => {
  it('calls registered action on matching keydown', () => {
    const action = vi.fn();
    svc.defineShortcut({ id: 'test', keys: { cmd: true, key: 'c' }, label: 'Copy', scope: 'global' });
    svc.register('test', action);
    svc.dispatch(makeKeyEvent({ key: 'c', metaKey: true }));
    expect(action).toHaveBeenCalledOnce();
  });

  it('does not fire on non-matching event', () => {
    const action = vi.fn();
    svc.defineShortcut({ id: 'test', keys: { cmd: true, key: 'c' }, label: 'Copy', scope: 'global' });
    svc.register('test', action);
    svc.dispatch(makeKeyEvent({ key: 'v', metaKey: true }));
    expect(action).not.toHaveBeenCalled();
  });

  it('calls preventDefault when a shortcut matches', () => {
    const e = makeKeyEvent({ key: 'c', metaKey: true });
    svc.defineShortcut({ id: 'test', keys: { cmd: true, key: 'c' }, label: 'Copy', scope: 'global' });
    svc.register('test', vi.fn());
    svc.dispatch(e);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('requires all modifiers to match', () => {
    const action = vi.fn();
    svc.defineShortcut({ id: 'test', keys: { cmd: true, shift: true, key: 'c' }, label: 'Copy', scope: 'global' });
    svc.register('test', action);
    svc.dispatch(makeKeyEvent({ key: 'c', metaKey: true, shiftKey: false }));
    expect(action).not.toHaveBeenCalled();
  });

  it('unregisters via returned function', () => {
    const action = vi.fn();
    svc.defineShortcut({ id: 'test', keys: { cmd: true, key: 'c' }, label: 'Copy', scope: 'global' });
    const unregister = svc.register('test', action);
    unregister();
    svc.dispatch(makeKeyEvent({ key: 'c', metaKey: true }));
    expect(action).not.toHaveBeenCalled();
  });

  it('getDefinitions returns defined shortcuts', () => {
    svc.defineShortcut({ id: 'a', keys: { cmd: true, key: 'c' }, label: 'A', scope: 'global', showInContextMenu: true });
    svc.register('a', vi.fn());
    svc.defineShortcut({ id: 'b', keys: { cmd: true, key: 'v' }, label: 'B', scope: 'global' });
    svc.register('b', vi.fn());
    expect(svc.getDefinitions()).toHaveLength(2);
  });

  it('fires scoped shortcut when focused element is inside scope zone', () => {
    const action = vi.fn();
    svc.defineShortcut({ id: 'scoped', keys: { cmd: true, key: 'c' }, label: 'Copy', scope: 'results' });
    svc.register('scoped', action);

    const scopeDiv = document.createElement('div');
    scopeDiv.setAttribute('data-keyboard-scope', 'results');
    const btn = document.createElement('button');
    scopeDiv.appendChild(btn);
    document.body.appendChild(scopeDiv);
    btn.focus();

    svc.dispatch(makeKeyEvent({ key: 'c', metaKey: true }));
    expect(action).toHaveBeenCalledOnce();

    document.body.removeChild(scopeDiv);
  });

  it('does not fire scoped shortcut when focused element is outside any scope zone', () => {
    const action = vi.fn();
    svc.defineShortcut({ id: 'scoped', keys: { cmd: true, key: 'c' }, label: 'Copy', scope: 'results' });
    svc.register('scoped', action);

    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.focus();

    svc.dispatch(makeKeyEvent({ key: 'c', metaKey: true }));
    expect(action).not.toHaveBeenCalled();

    document.body.removeChild(btn);
  });

  it('does not fire scoped shortcut when focused element is inside a different scope zone', () => {
    const action = vi.fn();
    svc.defineShortcut({ id: 'scoped', keys: { cmd: true, key: 'c' }, label: 'Copy', scope: 'results' });
    svc.register('scoped', action);

    const scopeDiv = document.createElement('div');
    scopeDiv.setAttribute('data-keyboard-scope', 'editor');
    const btn = document.createElement('button');
    scopeDiv.appendChild(btn);
    document.body.appendChild(scopeDiv);
    btn.focus();

    svc.dispatch(makeKeyEvent({ key: 'c', metaKey: true }));
    expect(action).not.toHaveBeenCalled();

    document.body.removeChild(scopeDiv);
  });

  it('fires global-scoped shortcut regardless of focused element position', () => {
    const action = vi.fn();
    svc.defineShortcut({ id: 'unscoped', keys: { cmd: true, key: 'c' }, label: 'Copy', scope: 'global' });
    svc.register('unscoped', action);
    svc.dispatch(makeKeyEvent({ key: 'c', metaKey: true }));
    expect(action).toHaveBeenCalledOnce();
  });

  it('does not retain prior scope after focus moves out of the scope zone (no sticky fallback)', () => {
    const navAction = vi.fn();
    const findAction = vi.fn();
    const copyAction = vi.fn();
    svc.defineShortcut({ id: 'cell.navigateRight', keys: { key: 'ArrowRight' }, label: 'Nav', scope: 'results-table' });
    svc.defineShortcut({ id: 'results.findNext', keys: { key: 'F3' }, label: 'Find', scope: 'results' });
    svc.defineShortcut({ id: 'cell.copyValue', keys: { cmd: true, key: 'c' }, label: 'Copy', scope: 'results' });
    svc.register('cell.navigateRight', navAction);
    svc.register('results.findNext', findAction);
    svc.register('cell.copyValue', copyAction);

    // First, fire each shortcut from inside its scope to prove the registration works.
    const tableDiv = document.createElement('div');
    tableDiv.setAttribute('data-keyboard-scope', 'results');
    const innerTable = document.createElement('div');
    innerTable.setAttribute('data-keyboard-scope', 'results-table');
    const cell = document.createElement('button');
    innerTable.appendChild(cell);
    tableDiv.appendChild(innerTable);
    document.body.appendChild(tableDiv);
    cell.focus();
    svc.dispatch(makeKeyEvent({ key: 'ArrowRight' }));
    svc.dispatch(makeKeyEvent({ key: 'F3' }));
    svc.dispatch(makeKeyEvent({ key: 'c', metaKey: true }));
    expect(navAction).toHaveBeenCalledOnce();
    expect(findAction).toHaveBeenCalledOnce();
    expect(copyAction).toHaveBeenCalledOnce();
    navAction.mockClear();
    findAction.mockClear();
    copyAction.mockClear();

    // Move focus to a textarea outside any scope — simulating Monaco. None of
    // the panel-scoped shortcuts should fire, regardless of key type.
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    const e1 = makeKeyEvent({ key: 'ArrowRight' });
    const e2 = makeKeyEvent({ key: 'F3' });
    const e3 = makeKeyEvent({ key: 'c', metaKey: true });
    svc.dispatch(e1);
    svc.dispatch(e2);
    svc.dispatch(e3);
    expect(navAction).not.toHaveBeenCalled();
    expect(findAction).not.toHaveBeenCalled();
    expect(copyAction).not.toHaveBeenCalled();
    expect(e1.preventDefault).not.toHaveBeenCalled();
    expect(e2.preventDefault).not.toHaveBeenCalled();
    expect(e3.preventDefault).not.toHaveBeenCalled();

    document.body.removeChild(tableDiv);
    document.body.removeChild(textarea);
  });

  it('fires scoped shortcut for element inside nested scope zones (ancestor chain)', () => {
    const action = vi.fn();
    svc.defineShortcut({ id: 'results-action', keys: { key: 'F3' }, label: 'View', scope: 'results' });
    svc.register('results-action', action);

    const outer = document.createElement('div');
    outer.setAttribute('data-keyboard-scope', 'results');
    const inner = document.createElement('div');
    inner.setAttribute('data-keyboard-scope', 'results-table');
    const btn = document.createElement('button');
    inner.appendChild(btn);
    outer.appendChild(inner);
    document.body.appendChild(outer);
    btn.focus();

    svc.dispatch(makeKeyEvent({ key: 'F3', metaKey: false }));
    expect(action).toHaveBeenCalledOnce();

    document.body.removeChild(outer);
  });
});

describe('formatKeyCombo', () => {
  it('formats cmd+c as ⌘C', () => {
    expect(formatKeyCombo({ cmd: true, key: 'c' })).toBe('⌘C');
  });

  it('formats ctrl+cmd+c as ⌃⌘C', () => {
    expect(formatKeyCombo({ ctrl: true, cmd: true, key: 'c' })).toBe('⌃⌘C');
  });

  it('formats shift+alt+cmd+c as ⇧⌥⌘C', () => {
    expect(formatKeyCombo({ shift: true, alt: true, cmd: true, key: 'c' })).toBe('⇧⌥⌘C');
  });

  it('formats shift+cmd+c as ⇧⌘C', () => {
    expect(formatKeyCombo({ shift: true, cmd: true, key: 'c' })).toBe('⇧⌘C');
  });
});

import { renderHook } from '@testing-library/react';
import { useKeyboard } from '../hooks/useKeyboard';

describe('useKeyboard', () => {
  it('registers handler on mount and unregisters on unmount', () => {
    const svc2 = new KeyboardService();
    svc2.defineShortcut({ id: 'hook-test', keys: { cmd: true, key: 'z' }, label: 'Test', scope: 'global' });
    const action = vi.fn();
    const { unmount } = renderHook(() =>
      useKeyboard({ id: 'hook-test', keys: { cmd: true, key: 'z' }, label: 'Test', action }, svc2)
    );
    svc2.dispatch(makeKeyEvent({ key: 'z', metaKey: true }));
    expect(action).toHaveBeenCalledOnce();
    unmount();
    action.mockClear();
    svc2.dispatch(makeKeyEvent({ key: 'z', metaKey: true }));
    expect(action).not.toHaveBeenCalled();
  });
});
