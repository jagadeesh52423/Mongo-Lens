import { it, expect, beforeEach } from 'vitest';
import { confirmViaStore } from './destructivePolicy';
import { useAgentStore } from '../../store/agent';

beforeEach(() => useAgentStore.setState({ byTab: {} }));

it('appends a confirm entry and resolves to {run:true} on approval', async () => {
  const promise = confirmViaStore('t1')({ statement: 'db.u.drop()', category: 'maintenance', collection: 'u' });
  const entry = useAgentStore.getState().byTab['t1'].entries[0];
  expect(entry.kind).toBe('confirm');
  if (entry.kind !== 'confirm') throw new Error('expected confirm entry');
  useAgentStore.getState().resolveConfirm('t1', entry.id, 'approved');
  await expect(promise).resolves.toEqual({ run: true });
});

it('resolves to {run:false, feedback} on denial', async () => {
  const promise = confirmViaStore('t1')({ statement: 'db.u.drop()', category: 'maintenance', collection: 'u' });
  const entry = useAgentStore.getState().byTab['t1'].entries[0];
  if (entry.kind !== 'confirm') throw new Error('expected confirm entry');
  useAgentStore.getState().resolveConfirm('t1', entry.id, 'denied');
  const decision = await promise;
  expect(decision.run).toBe(false);
  expect(typeof decision.feedback).toBe('string');
});
