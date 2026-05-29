import { describe, it, expect } from 'vitest';
import { buildMonacoSyntaxRules } from './applyTheme';

describe('buildMonacoSyntaxRules', () => {
  it('maps token types to the resolved --syntax-* values (hex without #)', () => {
    const read = (name: string) =>
      ({
        '--syntax-key': '#3ddc84',
        '--syntax-string': '#e3b341',
        '--syntax-number': '#7fb3ff',
        '--syntax-func': '#b39bff',
        '--syntax-punct': '#9aa0a8',
        '--fg': '#e6e8eb',
      })[name] ?? '#000000';

    const rules = buildMonacoSyntaxRules(read);
    expect(rules).toEqual(
      expect.arrayContaining([
        { token: 'keyword', foreground: '3ddc84' },
        { token: 'string', foreground: 'e3b341' },
        { token: 'number', foreground: '7fb3ff' },
        { token: 'identifier', foreground: 'b39bff' },
        { token: 'delimiter', foreground: '9aa0a8' },
      ]),
    );
  });
});
