import { describe, it, expect } from 'vitest';
import { parseAIContent } from './aiContent';

describe('parseAIContent', () => {
  it('returns single text segment for plain text', () => {
    expect(parseAIContent('hello world')).toEqual([
      { kind: 'text', text: 'hello world' },
    ]);
  });

  it('parses a single fenced block with language', () => {
    const input = 'pre\n```javascript\ndb.foo.find()\n```\npost';
    expect(parseAIContent(input)).toEqual([
      { kind: 'text', text: 'pre\n' },
      { kind: 'code', lang: 'javascript', code: 'db.foo.find()' },
      { kind: 'text', text: '\npost' },
    ]);
  });

  it('parses a fenced block without language', () => {
    const input = '```\nraw\n```';
    expect(parseAIContent(input)).toEqual([
      { kind: 'code', lang: '', code: 'raw' },
    ]);
  });

  it('parses multiple interleaved blocks in order', () => {
    const input = 'a\n```js\nx\n```\nb\n```py\ny\n```\nc';
    expect(parseAIContent(input)).toEqual([
      { kind: 'text', text: 'a\n' },
      { kind: 'code', lang: 'js', code: 'x' },
      { kind: 'text', text: '\nb\n' },
      { kind: 'code', lang: 'py', code: 'y' },
      { kind: 'text', text: '\nc' },
    ]);
  });

  it('emits trailing unclosed fence as text (streaming)', () => {
    const input = 'before\n```javascript\ndb.foo';
    expect(parseAIContent(input)).toEqual([
      { kind: 'text', text: 'before\n```javascript\ndb.foo' },
    ]);
  });

  it('emits empty code body as literal text', () => {
    const input = '```\n```';
    expect(parseAIContent(input)).toEqual([
      { kind: 'text', text: '```\n```' },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(parseAIContent('')).toEqual([]);
  });
});
