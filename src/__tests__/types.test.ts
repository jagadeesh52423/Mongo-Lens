import { describe, it, expect } from 'vitest';
import type { Connection, EditorTab } from '../types';

describe('types smoke', () => {
  it('Connection shape accepts all known fields', () => {
    const c: Connection = {
      id: '1',
      name: 'local',
      host: 'localhost',
      port: 27017,
      createdAt: '2026-04-17T00:00:00Z',
    };
    expect(c.name).toBe('local');
  });

  it('EditorTab allows browse type', () => {
    const tab: EditorTab = {
      id: 't1',
      title: 'users',
      content: '',
      isDirty: false,
      type: 'browse',
      connectionId: 'c1',
      database: 'mydb',
      collection: 'users',
    };
    expect(tab.type).toBe('browse');
  });
});
