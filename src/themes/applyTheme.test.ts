import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyTheme } from './applyTheme';
import { registerTheme } from './registry';
import { hydrateOverrides, setVariable } from './overrides';

const TEST_THEME_ID = 'test-theme';
const OTHER_THEME_ID = 'other-theme';

const baseVariables: Record<string, string> = {
  '--bg': '#000000',
  '--fg': '#ffffff',
  '--accent': '#ff0000',
};

beforeEach(() => {
  registerTheme({ id: TEST_THEME_ID, name: 'Test Theme', variables: baseVariables });
  registerTheme({ id: OTHER_THEME_ID, name: 'Other Theme', variables: { '--bg': '#cccccc' } });
  hydrateOverrides({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('applyTheme — base variables (no overrides)', () => {
  it('calls setProperty for every base variable with the base value', () => {
    const spy = vi.spyOn(document.documentElement.style, 'setProperty');

    applyTheme(TEST_THEME_ID);

    for (const [key, value] of Object.entries(baseVariables)) {
      expect(spy).toHaveBeenCalledWith(key, value);
    }
    expect(spy).toHaveBeenCalledTimes(Object.keys(baseVariables).length);
  });
});

describe('applyTheme — with overrides', () => {
  it('applies the overridden value for --bg and the base value for unoverridden vars', () => {
    setVariable(TEST_THEME_ID, '--bg', '#111111');
    const spy = vi.spyOn(document.documentElement.style, 'setProperty');

    applyTheme(TEST_THEME_ID);

    expect(spy).toHaveBeenCalledWith('--bg', '#111111');
    expect(spy).toHaveBeenCalledWith('--fg', '#ffffff');
    expect(spy).toHaveBeenCalledWith('--accent', '#ff0000');
  });

  it('applies an override key that is not in the base theme', () => {
    setVariable(TEST_THEME_ID, '--unknown-var', '#abcdef');
    const spy = vi.spyOn(document.documentElement.style, 'setProperty');

    applyTheme(TEST_THEME_ID);

    expect(spy).toHaveBeenCalledWith('--unknown-var', '#abcdef');
  });

  it('does NOT apply overrides set for a different themeId', () => {
    setVariable(OTHER_THEME_ID, '--bg', '#999999');
    const spy = vi.spyOn(document.documentElement.style, 'setProperty');

    applyTheme(TEST_THEME_ID);

    expect(spy).toHaveBeenCalledWith('--bg', '#000000');
    expect(spy).not.toHaveBeenCalledWith('--bg', '#999999');
  });
});

describe('applyTheme — unknown themeId', () => {
  it('is a no-op and does not call setProperty', () => {
    const spy = vi.spyOn(document.documentElement.style, 'setProperty');

    applyTheme('nonexistent-theme');

    expect(spy).not.toHaveBeenCalled();
  });
});
