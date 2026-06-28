import { describe, it, expect } from 'vitest';
import { newSchemaTab, schemaTabId } from '../schemaTab';

describe('schemaTab', () => {
  it('builds a deterministic id so reopening focuses the same tab', () => {
    expect(schemaTabId('c1', 'db', 'coll')).toBe(schemaTabId('c1', 'db', 'coll'));
    expect(newSchemaTab('c1', 'db', 'coll').id).toBe(schemaTabId('c1', 'db', 'coll'));
  });

  it('produces a schema-type tab carrying its target', () => {
    const t = newSchemaTab('c1', 'db', 'coll');
    expect(t.type).toBe('schema');
    expect(t.connectionId).toBe('c1');
    expect(t.database).toBe('db');
    expect(t.collection).toBe('coll');
    expect(t.title).toContain('coll');
  });
});
