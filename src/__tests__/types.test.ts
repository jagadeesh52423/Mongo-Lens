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

});

describe('EditorTab type', () => {
  it('should allow savedScriptId and savedScriptTags as optional fields', () => {
    const tabWithSavedScript: EditorTab = {
      id: 'script:abc-123',
      title: 'My Script',
      content: 'db.users.find({})',
      isDirty: false,
      type: 'script',
      connectionId: 'conn-1',
      database: 'testdb',
      savedScriptId: 'abc-123',
      savedScriptTags: 'query,users',
    };

    expect(tabWithSavedScript.savedScriptId).toBe('abc-123');
    expect(tabWithSavedScript.savedScriptTags).toBe('query,users');
  });

  it('should allow EditorTab without savedScriptId', () => {
    const tabWithoutSavedScript: EditorTab = {
      id: 'script:new-1',
      title: 'Untitled',
      content: '',
      isDirty: false,
      type: 'script',
    };

    expect(tabWithoutSavedScript.savedScriptId).toBeUndefined();
    expect(tabWithoutSavedScript.savedScriptTags).toBeUndefined();
  });
});
