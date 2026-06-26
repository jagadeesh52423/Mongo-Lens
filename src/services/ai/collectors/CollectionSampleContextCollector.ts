import type { ContextCollectorInterface } from '../ContextCollector';
import { getActiveTarget } from '../activeTarget';
import { browseCollection } from '../../../ipc';
import { safeStringify } from '../schemaUtils';
import { MongoMetaCache, mongoMetaCache } from '../MongoMetaCache';

const SAMPLE_SIZE = 3;

/**
 * Grounds the AI in a few real documents from the active collection (first N via
 * browse_collection) — distinct from ResultsContextCollector, which shows the
 * last query's RESULTS. Emits '' when no active collection or it's empty.
 *
 * ponytail: first-N via the existing browse_collection, not $sample — random
 * sampling isn't worth a new backend path for a 3-doc prompt preview.
 */
export class CollectionSampleContextCollector implements ContextCollectorInterface {
  constructor(private readonly cache: MongoMetaCache = mongoMetaCache) {}

  async collect(): Promise<string> {
    const t = getActiveTarget();
    if (!t.connectionId || !t.database || !t.collection) return '';
    const key = `sample|${t.connectionId}|${t.database}|${t.collection}`;
    return this.cache.get(key, async () => {
      const page = await browseCollection(t.connectionId!, t.database!, t.collection!, 0, SAMPLE_SIZE);
      const docs = page.docs ?? [];
      if (!docs.length) return '';
      return `Sample documents (${docs.length} from ${t.collection}):\n\`\`\`json\n${safeStringify(docs)}\n\`\`\``;
    });
  }
}
