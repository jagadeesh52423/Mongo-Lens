import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../activeTarget', () => ({ getActiveTarget: vi.fn() }));
vi.mock('../../../ipc', () => ({ browseCollection: vi.fn(), listIndexes: vi.fn() }));

import { getActiveTarget } from '../activeTarget';
import { listIndexes } from '../../../ipc';
import { MongoMetaCache } from '../MongoMetaCache';
import { IndexContextCollector } from './IndexContextCollector';

const mockTarget = vi.mocked(getActiveTarget);
const mockIndexes = vi.mocked(listIndexes);

beforeEach(() => { vi.clearAllMocks(); });

describe('IndexContextCollector', () => {
  it("returns '' when no active collection", async () => {
    mockTarget.mockReturnValue({ connectionId: 'c', database: 'd', collection: null });
    expect(await new IndexContextCollector(new MongoMetaCache()).collect()).toBe('');
    expect(mockIndexes).not.toHaveBeenCalled();
  });

  it('formats index name + key spec', async () => {
    mockTarget.mockReturnValue({ connectionId: 'c', database: 'd', collection: 'users' });
    mockIndexes.mockResolvedValue([
      { name: '_id_', keys: { _id: 1 } },
      { name: 'email_1', keys: { email: 1 } },
      { name: 'name_-1_age_1', keys: { name: -1, age: 1 } },
    ]);
    const out = await new IndexContextCollector(new MongoMetaCache()).collect();
    expect(out).toContain('Indexes on users');
    expect(out).toContain('- _id_: { _id:1 }');
    expect(out).toContain('- name_-1_age_1: { name:-1, age:1 }');
  });
});
