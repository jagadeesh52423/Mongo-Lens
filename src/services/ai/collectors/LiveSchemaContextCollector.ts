import type { ContextCollectorInterface } from '../ContextCollector';
import { getActiveTarget } from '../activeTarget';
import { browseCollection } from '../../../ipc';
import { mergeSchema, formatMergedSchema } from '../schemaUtils';
import { MongoMetaCache, mongoMetaCache } from '../MongoMetaCache';

const SCHEMA_SAMPLE_SIZE = 25;

/**
 * Grounds the AI in the active collection's actual shape by sampling the first
 * N docs (via browse_collection) and merging them into `field: type | type`.
 * Unlike the result-inferred SchemaContextCollector, this works before the user
 * has run any query. Emits '' when there is no active collection.
 */
export class LiveSchemaContextCollector implements ContextCollectorInterface {
  constructor(private readonly cache: MongoMetaCache = mongoMetaCache) {}

  async collect(): Promise<string> {
    const t = getActiveTarget();
    if (!t.connectionId || !t.database || !t.collection) return '';
    const key = `schema|${t.connectionId}|${t.database}|${t.collection}`;
    return this.cache.get(key, async () => {
      const page = await browseCollection(t.connectionId!, t.database!, t.collection!, 0, SCHEMA_SAMPLE_SIZE);
      const docs = (page.docs ?? []) as Array<Record<string, unknown>>;
      const body = formatMergedSchema(mergeSchema(docs));
      return body ? `Live schema (sampled ${docs.length} docs from ${t.collection}):\n${body}` : '';
    });
  }
}
