import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getOverrides,
  setVariable,
  resetVariable,
  resetTheme,
  getAllOverrides,
  hydrateOverrides,
  subscribe,
} from './overrides';

beforeEach(() => {
  hydrateOverrides({});
});

describe('getOverrides', () => {
  it('returns the value set by setVariable', () => {
    setVariable('dark', '--color-bg', '#000');
    expect(getOverrides('dark')).toEqual({ '--color-bg': '#000' });
  });

  it('returns {} for an unknown theme', () => {
    expect(getOverrides('unknown')).toEqual({});
  });

  it('returns updated value when setVariable overwrites a previous value', () => {
    setVariable('dark', '--color-bg', '#000');
    setVariable('dark', '--color-bg', '#111');
    expect(getOverrides('dark')['--color-bg']).toBe('#111');
  });
});

describe('resetVariable', () => {
  it('removes the variable key', () => {
    setVariable('dark', '--color-bg', '#000');
    resetVariable('dark', '--color-bg');
    expect(getOverrides('dark')).toEqual({});
  });

  it('removes the theme entry from getAllOverrides when last variable is reset', () => {
    setVariable('dark', '--color-bg', '#000');
    resetVariable('dark', '--color-bg');
    expect(Object.prototype.hasOwnProperty.call(getAllOverrides(), 'dark')).toBe(false);
  });

  it('is a no-op and does not throw when variable does not exist', () => {
    expect(() => resetVariable('dark', '--nonexistent')).not.toThrow();
  });
});

describe('resetTheme', () => {
  it('removes all overrides for the theme without affecting others', () => {
    setVariable('dark', '--color-bg', '#000');
    setVariable('light', '--color-bg', '#fff');
    resetTheme('dark');
    expect(Object.prototype.hasOwnProperty.call(getAllOverrides(), 'dark')).toBe(false);
    expect(getOverrides('light')).toEqual({ '--color-bg': '#fff' });
  });

  it('is a no-op when the theme has no overrides', () => {
    expect(() => resetTheme('nonexistent')).not.toThrow();
  });
});

describe('subscribe', () => {
  it('fires the listener on setVariable', () => {
    const listener = vi.fn();
    subscribe(listener);
    setVariable('dark', '--color-bg', '#000');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('fires the listener on resetVariable when state changes', () => {
    setVariable('dark', '--color-bg', '#000');
    const listener = vi.fn();
    subscribe(listener);
    resetVariable('dark', '--color-bg');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not fire the listener on resetVariable when variable does not exist', () => {
    const listener = vi.fn();
    subscribe(listener);
    resetVariable('dark', '--nonexistent');
    expect(listener).not.toHaveBeenCalled();
  });

  it('fires the listener on resetTheme when state changes', () => {
    setVariable('dark', '--color-bg', '#000');
    const listener = vi.fn();
    subscribe(listener);
    resetTheme('dark');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not fire the listener on resetTheme when theme has no overrides', () => {
    const listener = vi.fn();
    subscribe(listener);
    resetTheme('nonexistent');
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops calling the listener after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    unsubscribe();
    setVariable('dark', '--color-bg', '#000');
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies all subscribers', () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    subscribe(listenerA);
    subscribe(listenerB);
    setVariable('dark', '--color-bg', '#000');
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
  });
});

describe('hydrateOverrides', () => {
  it('replaces in-memory state wholesale', () => {
    setVariable('dark', '--color-bg', '#000');
    hydrateOverrides({ light: { '--color-bg': '#fff' } });
    expect(Object.prototype.hasOwnProperty.call(getAllOverrides(), 'dark')).toBe(false);
    expect(getOverrides('light')).toEqual({ '--color-bg': '#fff' });
  });

  it('does not notify subscribers', () => {
    const listener = vi.fn();
    subscribe(listener);
    hydrateOverrides({ light: { '--color-bg': '#fff' } });
    expect(listener).not.toHaveBeenCalled();
  });
});
