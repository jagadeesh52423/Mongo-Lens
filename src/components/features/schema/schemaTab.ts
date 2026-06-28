import type { EditorTab } from '../../../types';

/** Deterministic id so a second "Analyze Schema" focuses the existing tab. */
export function schemaTabId(connectionId: string, database: string, collection: string): string {
  return `schema:${connectionId}:${database}:${collection}`;
}

export function newSchemaTab(connectionId: string, database: string, collection: string): EditorTab {
  return {
    id: schemaTabId(connectionId, database, collection),
    title: `⚛ ${collection}`,
    content: '',
    isDirty: false,
    type: 'schema',
    connectionId,
    database,
    collection,
  };
}
