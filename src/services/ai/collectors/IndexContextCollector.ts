import type { ContextCollectorInterface } from '../ContextCollector';
import { getActiveTarget } from '../activeTarget';
import { listIndexes } from '../../../ipc';
import { MongoMetaCache, mongoMetaCache } from '../MongoMetaCache';

function formatKeys(keys: Record<string, number>): string {
  return Object.entries(keys).map(([f, dir]) => `${f}:${dir}`).join(', ');
}

/**
 * Grounds the AI in the active collection's indexes (name + key spec) so it can
 * write index-aware queries — the single biggest thing a user can't paste into
 * a generic chatbot. IndexInfo only exposes name+keys today; unique/TTL flags
 * would need a backend change (out of scope). Emits '' when no active collection.
 */
export class IndexContextCollector implements ContextCollectorInterface {
  constructor(private readonly cache: MongoMetaCache = mongoMetaCache) {}

  async collect(): Promise<string> {
    const t = getActiveTarget();
    if (!t.connectionId || !t.database || !t.collection) return '';
    const key = `indexes|${t.connectionId}|${t.database}|${t.collection}`;
    return this.cache.get(key, async () => {
      const idx = await listIndexes(t.connectionId!, t.database!, t.collection!);
      if (!idx.length) return '';
      const lines = idx.map((i) => `- ${i.name}: { ${formatKeys(i.keys)} }`);
      return `Indexes on ${t.collection}:\n${lines.join('\n')}`;
    });
  }
}
