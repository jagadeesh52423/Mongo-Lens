import { it, expect, beforeEach } from 'vitest';
import { useAgentStore } from './agent';

beforeEach(() => useAgentStore.setState({ byTab: {} }));

it('appends entries per tab and toggles running', () => {
  useAgentStore.getState().append('t1', { kind: 'model-text', text: 'hi' });
  useAgentStore.getState().setRunning('t1', true);
  const s = useAgentStore.getState().byTab['t1'];
  expect(s.entries).toHaveLength(1);
  expect(s.running).toBe(true);
});

it('clears a tab', () => {
  useAgentStore.getState().append('t1', { kind: 'final', text: 'done' });
  useAgentStore.getState().clear('t1');
  expect(useAgentStore.getState().byTab['t1']?.entries ?? []).toHaveLength(0);
});

it('marks a confirm entry resolved', () => {
  useAgentStore.getState().append('t1', { kind: 'confirm', id: 'x', statement: 'db.u.drop()', category: 'maintenance', collection: 'u' });
  useAgentStore.getState().resolveConfirm('t1', 'x', 'denied');
  const e = useAgentStore.getState().byTab['t1'].entries[0];
  expect(e.kind === 'confirm' && e.resolved).toBe('denied');
});
