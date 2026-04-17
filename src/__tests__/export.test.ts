import { describe, it, expect } from 'vitest';
import { toCsv, toJsonText } from '../utils/export';

describe('export utils', () => {
  it('builds CSV with header row and escapes commas', () => {
    const csv = toCsv([{ a: 1, b: 'x,y' }, { a: 2, b: 'z' }]);
    expect(csv.split('\n')[0]).toBe('a,b');
    expect(csv.split('\n')[1]).toBe('1,"x,y"');
  });

  it('formats JSON with 2 spaces', () => {
    const s = toJsonText([{ a: 1 }]);
    expect(s).toContain('  "a": 1');
  });
});
