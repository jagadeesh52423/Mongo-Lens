import { describe, it, expect } from 'vitest';
import { validateManifest } from '../plugins/manifest';

const base = {
  id: 'acme.foo', name: 'Foo', version: '1.0.0',
  engines: { mongolens: '^1.0.0' }, main: 'dist/main.js',
};

describe('manifest.contributes.configuration', () => {
  it('accepts a well-formed configuration block', () => {
    const v = validateManifest({
      ...base,
      contributes: {
        configuration: {
          title: 'Foo',
          properties: {
            'foo.url':      { type: 'string', title: 'URL' },
            'foo.password': { type: 'string', 'x-secret': true },
            'foo.timeout':  { type: 'integer', minimum: 0, maximum: 1000, default: 30 },
            'foo.enabled':  { type: 'boolean' },
            'foo.mode':     { type: 'string', enum: ['fast', 'slow'] },
          },
          required: ['foo.url'],
        },
      },
    });
    expect(v.ok).toBe(true);
  });

  it('accepts activation.requireConfig', () => {
    const v = validateManifest({ ...base, activation: { requireConfig: true } });
    expect(v.ok).toBe(true);
  });

  it('rejects unknown keyword under a configuration property', () => {
    const v = validateManifest({
      ...base,
      contributes: {
        configuration: {
          title: 'Foo',
          properties: { 'foo.bad': { type: 'string', bogusKeyword: 1 } as never },
        },
      },
    });
    expect(v.ok).toBe(false);
    expect(v.errors?.join(' ')).toMatch(/bogusKeyword|additional/i);
  });

  it('rejects a property with no type', () => {
    const v = validateManifest({
      ...base,
      contributes: { configuration: { title: 'Foo', properties: { 'foo.x': { title: 'x' } as never } } },
    });
    expect(v.ok).toBe(false);
  });
});
