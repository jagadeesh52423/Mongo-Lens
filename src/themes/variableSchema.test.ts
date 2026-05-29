import { describe, it, expect } from 'vitest';
import { VARIABLE_SCHEMA, VARIABLE_GROUP_ORDER } from './variableSchema';

const names = VARIABLE_SCHEMA.map((s) => s.name);

describe('VARIABLE_SCHEMA', () => {
  it('includes the new elevation + foreground tokens', () => {
    for (const n of ['--bg-elev-1', '--bg-elev-2', '--bg-elev-3', '--fg-muted', '--border-strong', '--accent-contrast', '--accent-press']) {
      expect(names).toContain(n);
    }
  });

  it('includes the Syntax group with five syntax tokens', () => {
    expect(VARIABLE_GROUP_ORDER).toContain('Syntax');
    const syntax = VARIABLE_SCHEMA.filter((s) => s.group === 'Syntax').map((s) => s.name);
    expect(syntax).toEqual(
      expect.arrayContaining(['--syntax-key', '--syntax-string', '--syntax-number', '--syntax-func', '--syntax-punct']),
    );
  });

  it('only declares color or font kinds (Theme Editor supports no others)', () => {
    for (const s of VARIABLE_SCHEMA) expect(['color', 'font']).toContain(s.kind);
  });

  it('does not expose derived/alpha tokens as editable', () => {
    for (const n of ['--bg-hover', '--bg-active', '--accent-soft', '--focus-ring-color']) {
      expect(names).not.toContain(n);
    }
  });
});
