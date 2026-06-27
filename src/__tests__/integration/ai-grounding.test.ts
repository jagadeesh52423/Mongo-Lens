import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock only the IPC boundary; everything else (collectors, registry, cache,
// schema merge, active-target resolution) runs for real.
vi.mock('../../ipc', () => ({ browseCollection: vi.fn(), listIndexes: vi.fn() }));

import { browseCollection, listIndexes } from '../../ipc';
import { ContextCollector } from '../../services/ai/ContextCollector';
import { useEditorStore } from '../../store/editor';
import { useConnectionsV2 } from '../../components/features/connections/useConnectionsV2';

/**
 * Integration test: the REAL default ContextCollector (every collector
 * registered) assembling a grounded system-prompt block from the active target.
 * Catches regressions a unit test would miss — a collector dropped from the
 * registry, a getActiveTarget shape change, or schema/index/sample formatting
 * drift — because it runs the whole chain end to end against the real stores.
 */

const mockBrowse = vi.mocked(browseCollection);
const mockIndexes = vi.mocked(listIndexes);

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({
    activeTabId: 't1',
    tabs: [{ id: 't1', connectionId: 'c1', database: 'd1', collection: 'users', content: '' }],
    selections: {},
  } as never);
  useConnectionsV2.setState({
    connections: [{ id: 'c1', name: 'Local' }],
    activeConnectionId: 'c1',
    activeDatabase: 'd1',
  } as never);
});

describe('AI grounding (real ContextCollector default collectors)', () => {
  it('assembles connection + live schema + indexes + sample into the context block', async () => {
    mockBrowse.mockResolvedValue({
      docs: [{ name: 'a', age: 1 }, { name: 'b', age: 2 }],
      total: 2,
      page: 0,
      pageSize: 25,
    });
    mockIndexes.mockResolvedValue([{ name: 'email_1', keys: { email: 1 } }]);

    const block = await new ContextCollector().collectAll();

    expect(block).toContain('Current Context:');
    expect(block).toContain('- Connection: Local');
    expect(block).toContain('- Collection: users');
    expect(block).toContain('Live schema');
    expect(block).toContain('- name: string');
    expect(block).toContain('Indexes on users');
    expect(block).toContain('email_1');
    expect(block).toContain('Sample documents');
  });

  it('omits grounding sections when no active collection (no IPC calls)', async () => {
    useEditorStore.setState({
      activeTabId: 't1',
      tabs: [{ id: 't1', connectionId: 'c1', database: 'd1', collection: undefined, content: '' }],
      selections: {},
    } as never);

    const block = await new ContextCollector().collectAll();

    expect(block).toContain('Current Context:');
    expect(block).not.toContain('Live schema');
    expect(block).not.toContain('Indexes on');
    expect(mockBrowse).not.toHaveBeenCalled();
    expect(mockIndexes).not.toHaveBeenCalled();
  });
});
