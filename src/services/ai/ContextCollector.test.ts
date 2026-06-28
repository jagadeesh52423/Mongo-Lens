import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./activeTarget', () => ({ getActiveTarget: vi.fn() }));
vi.mock('../../components/features/connections/useConnectionsV2', () => ({
  useConnectionsV2: { getState: vi.fn() },
}));

import { getActiveTarget } from './activeTarget';
import { useConnectionsV2 } from '../../components/features/connections/useConnectionsV2';
import { ContextCollector, ConnectionContextCollector } from './ContextCollector';

const mockTarget = vi.mocked(getActiveTarget);
const mockConns = vi.mocked(useConnectionsV2.getState);

beforeEach(() => { vi.clearAllMocks(); });

describe('ContextCollector.collectAll', () => {
  it('joins non-empty sections and swallows a throwing collector', async () => {
    const cc = new ContextCollector([
      { collect: async () => 'A' },
      { collect: async () => { throw new Error('nope'); } },
      { collect: async () => '' },
      { collect: async () => 'B' },
    ]);
    expect(await cc.collectAll()).toBe('A\n\nB');
  });

  it('caps an oversized section and marks it truncated', async () => {
    const cc = new ContextCollector([{ collect: async () => 'x'.repeat(5000) }]);
    const out = await cc.collectAll();
    expect(out.length).toBeLessThan(5000);
    expect(out.endsWith('…(truncated)')).toBe(true);
  });
});

describe('ConnectionContextCollector', () => {
  it('resolves names via getActiveTarget', async () => {
    mockTarget.mockReturnValue({ connectionId: 'c1', database: 'd1', collection: 'users' });
    mockConns.mockReturnValue({ connections: [{ id: 'c1', name: 'Prod' }] } as never);
    const out = await new ConnectionContextCollector().collect();
    expect(out).toContain('- Connection: Prod');
    expect(out).toContain('- Database: d1');
    expect(out).toContain('- Collection: users');
  });

  it("returns '' when neither connection nor database is set", async () => {
    mockTarget.mockReturnValue({ connectionId: null, database: null, collection: null });
    mockConns.mockReturnValue({ connections: [] } as never);
    expect(await new ConnectionContextCollector().collect()).toBe('');
  });
});
