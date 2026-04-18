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
    ...overrides,
  } as unknown as KeyboardEvent;
}

describe('KeyboardService', () => {
  it('calls registered action on matching keydown', () => {
    const action = vi.fn();
    svc.register({ id: 'test', keys: { cmd: true, key: 'c' }, label: 'Copy', action });
    svc.dispatch(makeKeyEvent({ key: 'c', metaKey: true }));
    expect(action).toHaveBeenCalledOnce();
  });

  it('does not fire on non-matching event', () => {
    const action = vi.fn();
    svc.register({ id: 'test', keys: { cmd: true, key: 'c' }, label: 'Copy', action });
    svc.dispatch(makeKeyEvent({ key: 'v', metaKey: true }));
    expect(action).not.toHaveBeenCalled();
  });

  it('calls preventDefault when a shortcut matches', () => {
    const e = makeKeyEvent({ key: 'c', metaKey: true });
    svc.register({ id: 'test', keys: { cmd: true, key: 'c' }, label: 'Copy', action: vi.fn() });
    svc.dispatch(e);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('requires all modifiers to match', () => {
    const action = vi.fn();
    svc.register({ id: 'test', keys: { cmd: true, shift: true, key: 'c' }, label: 'Copy', action });
    svc.dispatch(makeKeyEvent({ key: 'c', metaKey: true, shiftKey: false }));
    expect(action).not.toHaveBeenCalled();
  });

  it('unregisters via returned function', () => {
    const action = vi.fn();
    const unregister = svc.register({ id: 'test', keys: { cmd: true, key: 'c' }, label: 'Copy', action });
    unregister();
    svc.dispatch(makeKeyEvent({ key: 'c', metaKey: true }));
    expect(action).not.toHaveBeenCalled();
  });

  it('getAll returns registered shortcuts', () => {
    svc.register({ id: 'a', keys: { cmd: true, key: 'c' }, label: 'A', action: vi.fn(), showInContextMenu: true });
    svc.register({ id: 'b', keys: { cmd: true, key: 'v' }, label: 'B', action: vi.fn() });
    expect(svc.getAll()).toHaveLength(2);
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
