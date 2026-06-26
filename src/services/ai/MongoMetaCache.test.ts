import { describe, it, expect, vi } from 'vitest';
import { MongoMetaCache } from './MongoMetaCache';

describe('MongoMetaCache', () => {
  it('caches within TTL and refetches after expiry', async () => {
    let now = 0;
    const cache = new MongoMetaCache(100, () => now);
    const fetcher = vi.fn().mockResolvedValue('v');
    expect(await cache.get('k', fetcher)).toBe('v');
    expect(await cache.get('k', fetcher)).toBe('v');
    expect(fetcher).toHaveBeenCalledTimes(1);
    now = 200;
    await cache.get('k', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed fetch', async () => {
    const cache = new MongoMetaCache(1000, () => 0);
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue('ok');
    await expect(cache.get('k', fetcher)).rejects.toThrow('x');
    expect(await cache.get('k', fetcher)).toBe('ok');
  });

  it('keys independently', async () => {
    const cache = new MongoMetaCache(1000, () => 0);
    expect(await cache.get('a', async () => 'A')).toBe('A');
    expect(await cache.get('b', async () => 'B')).toBe('B');
  });
});
