import { describe, it, expect, beforeEach } from 'vitest';
import { useConnectionsStore } from '../store/connections';
import { useEditorStore } from '../store/editor';
import { useResultsStore } from '../store/results';

beforeEach(() => {
  useConnectionsStore.setState({
    connections: [], activeConnectionId: null, activeDatabase: null, connectedIds: new Set(),
  });
  useEditorStore.setState({ tabs: [], activeTabId: null });
  useResultsStore.setState({ byTab: {} });
});

describe('connections store', () => {
  it('adds and removes connections', () => {
    const s = useConnectionsStore.getState();
    s.addConnection({ id: '1', name: 'a', createdAt: 't' });
    expect(useConnectionsStore.getState().connections).toHaveLength(1);
    useConnectionsStore.getState().removeConnection('1');
    expect(useConnectionsStore.getState().connections).toHaveLength(0);
  });

  it('tracks connected ids', () => {
    useConnectionsStore.getState().markConnected('x');
    expect(useConnectionsStore.getState().connectedIds.has('x')).toBe(true);
    useConnectionsStore.getState().markDisconnected('x');
    expect(useConnectionsStore.getState().connectedIds.has('x')).toBe(false);
  });
});

describe('editor store', () => {
  it('opens then closes a tab', () => {
    useEditorStore.getState().openTab({
      id: 't1', title: 'a.js', content: '', isDirty: false, type: 'script',
    });
    expect(useEditorStore.getState().tabs).toHaveLength(1);
    expect(useEditorStore.getState().activeTabId).toBe('t1');
    useEditorStore.getState().closeTab('t1');
    expect(useEditorStore.getState().tabs).toHaveLength(0);
    expect(useEditorStore.getState().activeTabId).toBeNull();
  });

  it('marks dirty on content update', () => {
    useEditorStore.getState().openTab({
      id: 't1', title: 'a.js', content: 'x', isDirty: false, type: 'script',
    });
    useEditorStore.getState().updateContent('t1', 'y');
    const tab = useEditorStore.getState().tabs[0];
    expect(tab.content).toBe('y');
    expect(tab.isDirty).toBe(true);
  });
});

describe('results store', () => {
  it('appends groups during a run', () => {
    useResultsStore.getState().startRun('t1');
    useResultsStore.getState().appendGroup('t1', { groupIndex: 0, docs: [{ a: 1 }] });
    useResultsStore.getState().finishRun('t1', 42);
    const r = useResultsStore.getState().byTab['t1'];
    expect(r.groups).toHaveLength(1);
    expect(r.isRunning).toBe(false);
    expect(r.executionMs).toBe(42);
  });

  it('setPagination stores pagination for a tab', () => {
    useResultsStore.getState().startRun('t1');
    useResultsStore.getState().setPagination('t1', { total: 200, page: 1, pageSize: 50 });
    const r = useResultsStore.getState().byTab['t1'];
    expect(r.pagination).toEqual({ total: 200, page: 1, pageSize: 50 });
  });

  it('startRun clears previous pagination', () => {
    useResultsStore.getState().startRun('t1');
    useResultsStore.getState().setPagination('t1', { total: 200, page: 2, pageSize: 50 });
    useResultsStore.getState().startRun('t1');
    const r = useResultsStore.getState().byTab['t1'];
    expect(r.pagination).toBeUndefined();
  });
});
