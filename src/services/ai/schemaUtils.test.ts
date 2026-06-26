import { describe, it, expect } from 'vitest';
import { inferType, mergeSchema, formatMergedSchema, safeStringify } from './schemaUtils';

describe('inferType', () => {
  it('classifies primitives and BSON-ish hints', () => {
    expect(inferType(null)).toBe('null');
    expect(inferType([1, 2])).toBe('array');
    expect(inferType(new Date())).toBe('Date');
    expect(inferType({ $oid: 'x' })).toBe('ObjectId');
    expect(inferType({ $date: 1 })).toBe('Date');
    expect(inferType(5)).toBe('number');
    expect(inferType('s')).toBe('string');
  });
});

describe('mergeSchema', () => {
  it('unions sorted unique types per field across docs', () => {
    expect(mergeSchema([{ a: 1 }, { a: 'x', b: null }])).toEqual({
      a: ['number', 'string'],
      b: ['null'],
    });
  });
  it('ignores non-object entries', () => {
    expect(mergeSchema([null as unknown as Record<string, unknown>, { a: 1 }])).toEqual({ a: ['number'] });
  });
});

describe('formatMergedSchema', () => {
  it('formats lines, empty for no fields', () => {
    expect(formatMergedSchema({})).toBe('');
    expect(formatMergedSchema({ a: ['number', 'string'] })).toBe('- a: number | string');
  });
});

describe('safeStringify', () => {
  it('serializes Date to ISO', () => {
    expect(safeStringify({ d: new Date('2020-01-01T00:00:00Z') })).toContain('2020-01-01T00:00:00.000Z');
  });
});
