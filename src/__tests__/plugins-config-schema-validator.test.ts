import { describe, it, expect } from 'vitest';
import { validateConfig } from '../plugins/config/schemaValidator';
import type { ConfigurationContribution } from '../plugins/manifest';

const schema: ConfigurationContribution = {
  title: 'X',
  properties: {
    url:     { type: 'string', minLength: 1, format: 'uri' },
    secret:  { type: 'string', 'x-secret': true },
    count:   { type: 'integer', minimum: 0, maximum: 10 },
    mode:    { type: 'string', enum: ['a', 'b'] },
    enabled: { type: 'boolean' },
  },
  required: ['url'],
};

describe('validateConfig', () => {
  it('returns no errors for valid values', () => {
    expect(validateConfig(schema, {
      url: 'https://x', secret: 's', count: 5, mode: 'a', enabled: true,
    })).toEqual([]);
  });

  it('flags missing required keys', () => {
    const errs = validateConfig(schema, {});
    expect(errs.some(e => e.key === 'url')).toBe(true);
  });

  it('flags type mismatch', () => {
    const errs = validateConfig(schema, { url: 'x', count: 'not-a-number' as unknown });
    expect(errs.some(e => e.key === 'count')).toBe(true);
  });

  it('flags enum mismatch', () => {
    const errs = validateConfig(schema, { url: 'x', mode: 'c' });
    expect(errs.some(e => e.key === 'mode')).toBe(true);
  });

  it('flags minimum/maximum violation', () => {
    const errs = validateConfig(schema, { url: 'x', count: 99 });
    expect(errs.some(e => e.key === 'count' && /max/i.test(e.message))).toBe(true);
  });

  it('flags minLength violation', () => {
    const errs = validateConfig(schema, { url: '' });
    expect(errs.some(e => e.key === 'url')).toBe(true);
  });
});
