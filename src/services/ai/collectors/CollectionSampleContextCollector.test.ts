import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../activeTarget', () => ({ getActiveTarget: vi.fn() }));
vi.mock('../../../ipc', () => ({ browseCollection: vi.fn(), listIndexes: vi.fn() }));

import { getActiveTarget } from '../activeTarget';
import { browseCollection } from '../../../ipc';
import { MongoMetaCache } from '../MongoMetaCache';
import { CollectionSampleContextCollector } from './CollectionSampleContextCollector';

const mockTarget = vi.mocked(getActiveTarget);
const mockBrowse = vi.mocked(browseCollection);

beforeEach(() => { vi.clearAllMocks(); });

describe('CollectionSampleContextCollector', () => {
  it("returns '' when no active collection", async () => {
    mockTarget.mockReturnValue({ connectionId: 'c', database: 'd', collection: null });
    expect(await new CollectionSampleContextCollector(new MongoMetaCache()).collect()).toBe('');
    expect(mockBrowse).not.toHaveBeenCalled();
  });

  it("returns '' when collection is empty", async () => {
    mockTarget.mockReturnValue({ connectionId: 'c', database: 'd', collection: 'users' });
    mockBrowse.mockResolvedValue({ docs: [], total: 0, page: 0, pageSize: 3 });
    expect(await new CollectionSampleContextCollector(new MongoMetaCache()).collect()).toBe('');
  });

  it('emits a fenced sample block', async () => {
    mockTarget.mockReturnValue({ connectionId: 'c', database: 'd', collection: 'users' });
    mockBrowse.mockResolvedValue({ docs: [{ a: 1 }], total: 1, page: 0, pageSize: 3 });
    const out = await new CollectionSampleContextCollector(new MongoMetaCache()).collect();
    expect(out).toContain('Sample documents (1 from users)');
    expect(out).toContain('```json');
    expect(out).toContain('"a": 1');
  });
});
