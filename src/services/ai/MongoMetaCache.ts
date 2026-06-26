/**
 * Tiny TTL string cache shared by the AI grounding collectors. They run on
 * every message send, so without this the same collection is hit repeatedly
 * within a conversation. A failed fetch is NOT cached (so it retries next send).
 *
 * ponytail: flat Map + TTL; add LRU eviction only if memory ever shows up as a
 * problem (one cache lives for the app session, keyed by section+collection).
 */
export class MongoMetaCache {
  private store = new Map<string, { value: string; at: number }>();

  constructor(
    private readonly ttlMs = 30_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async get(key: string, fetcher: () => Promise<string>): Promise<string> {
    const hit = this.store.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    const value = await fetcher(); // throws on failure → intentionally not stored
    this.store.set(key, { value, at: this.now() });
    return value;
  }
}

/** App-wide shared instance used by the default collectors. */
export const mongoMetaCache = new MongoMetaCache();
