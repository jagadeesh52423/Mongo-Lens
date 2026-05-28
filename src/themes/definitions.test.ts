import { describe, it, expect } from 'vitest';
import './definitions'; // side-effect: registers themes
import { getThemes, getTheme } from './registry';
import { VARIABLE_SCHEMA } from './variableSchema';

describe('theme definitions', () => {
  it('registers exactly precision-dark and precision-light', () => {
    const ids = getThemes().map((t) => t.id).sort();
    expect(ids).toEqual(['precision-dark', 'precision-light']);
  });

  it('retires orangy and midnight', () => {
    expect(getTheme('orangy')).toBeUndefined();
    expect(getTheme('midnight')).toBeUndefined();
  });

  it('every schema color/font token has a value in both themes', () => {
    for (const id of ['precision-dark', 'precision-light']) {
      const vars = getTheme(id)!.variables;
      for (const spec of VARIABLE_SCHEMA) {
        expect(vars[spec.name], `${id} missing ${spec.name}`).toBeTruthy();
      }
    }
  });

  it('defines per-theme shadow strings', () => {
    for (const id of ['precision-dark', 'precision-light']) {
      expect(getTheme(id)!.variables['--shadow-3']).toContain('px');
    }
  });
});
