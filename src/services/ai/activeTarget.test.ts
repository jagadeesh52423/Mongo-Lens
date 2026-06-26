import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../store/editor';
import { useConnectionsV2 } from '../../components/features/connections/useConnectionsV2';
import { getActiveTarget } from './activeTarget';

describe('getActiveTarget', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: [], activeTabId: null } as never);
    useConnectionsV2.setState({ activeConnectionId: null, activeDatabase: null } as never);
  });

  it('falls back to global connection/database when no tab override', () => {
    useConnectionsV2.setState({ activeConnectionId: 'g', activeDatabase: 'gdb' } as never);
    expect(getActiveTarget()).toEqual({ connectionId: 'g', database: 'gdb', collection: null });
  });

  it('prefers active tab values over global', () => {
    useEditorStore.setState({
      activeTabId: 't1',
      tabs: [{ id: 't1', connectionId: 'c1', database: 'd1', collection: 'users' }],
    } as never);
    useConnectionsV2.setState({ activeConnectionId: 'g', activeDatabase: 'gdb' } as never);
    expect(getActiveTarget()).toEqual({ connectionId: 'c1', database: 'd1', collection: 'users' });
  });
});
