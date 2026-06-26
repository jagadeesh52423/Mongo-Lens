import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../activeTarget', () => ({ getActiveTarget: vi.fn() }));
vi.mock('../../../ipc', () => ({ browseCollection: vi.fn(), listIndexes: vi.fn() }));

import { getActiveTarget } from '../activeTarget';
import { browseCollection } from '../../../ipc';
import { MongoMetaCache } from '../MongoMetaCache';
import { LiveSchemaContextCollector } from './LiveSchemaContextCollector';

const mockTarget = vi.mocked(getActiveTarget);
const mockBrowse = vi.mocked(browseCollection);

beforeEach(() => { vi.clearAllMocks(); });

describe('LiveSchemaContextCollector', () => {
  it("returns '' and skips IPC when no active collection", async () => {
    mockTarget.mockReturnValue({ connectionId: 'c', database: 'd', collection: null });
    const c = new LiveSchemaContextCollector(new MongoMetaCache());
    expect(await c.collect()).toBe('');
    expect(mockBrowse).not.toHaveBeenCalled();
  });

  it('emits a merged-schema block', async () => {
    mockTarget.mockReturnValue({ connectionId: 'c', database: 'd', collection: 'users' });
    mockBrowse.mockResolvedValue({
      docs: [{ name: 'a', age: 1 }, { name: 'b', age: null }],
      total: 2, page: 0, pageSize: 25,
    });
    const c = new LiveSchemaContextCollector(new MongoMetaCache());
    const out = await c.collect();
    expect(out).toContain('Live schema');
    expect(out).toContain('- name: string');
    expect(out).toContain('- age: null | number');
  });

  it('rethrows IPC errors (collectAll is the safety net)', async () => {
    mockTarget.mockReturnValue({ connectionId: 'c', database: 'd', collection: 'users' });
    mockBrowse.mockRejectedValue(new Error('boom'));
    const c = new LiveSchemaContextCollector(new MongoMetaCache());
    await expect(c.collect()).rejects.toThrow('boom');
  });
});
