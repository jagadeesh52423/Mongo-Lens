import { it, expect, vi } from 'vitest';
import { AgentService } from './AgentService';
import { blockWrites } from './destructivePolicy';

function provider(seq: Array<{ content: string; toolCalls: { id: string; name: string; arguments: any }[] }>) {
  const calls = [...seq];
  return { chatWithTools: vi.fn().mockImplementation(async () => calls.shift() ?? { content: 'fallback', toolCalls: [] }) };
}

it('auto-runs a read tool then returns the final answer', async () => {
  const emitted: any[] = [];
  const svc = new AgentService({
    provider: provider([
      { content: '', toolCalls: [{ id: 'c1', name: 'runMongo', arguments: { statement: 'db.u.find()' } }] },
      { content: 'Here is your answer', toolCalls: [] },
    ]),
    runStatement: vi.fn().mockResolvedValue({ groups: [{ docs: [{ a: 1 }] }] }),
    classify: () => ({ destructive: false, category: 'query', collection: 'u' }),
    onDestructive: blockWrites,
    emit: (e) => emitted.push(e),
  });
  const final = await svc.run('show users', { connectionId: 'c', database: 'd', collections: ['u'] });
  expect(final).toContain('Here is your answer');
  expect(emitted.some((e) => e.kind === 'tool-call')).toBe(true);
  expect(emitted.some((e) => e.kind === 'final')).toBe(true);
});

it('blocks a destructive statement (read-only policy) and feeds the block back', async () => {
  const run = vi.fn().mockResolvedValue({ groups: [] });
  const svc = new AgentService({
    provider: provider([
      { content: '', toolCalls: [{ id: 'c1', name: 'runMongo', arguments: { statement: 'db.u.drop()' } }] },
      { content: 'ok, I will not drop', toolCalls: [] },
    ]),
    runStatement: run,
    classify: () => ({ destructive: true, category: 'maintenance', collection: 'u' }),
    onDestructive: blockWrites,
    emit: () => {},
  });
  await svc.run('drop users', { connectionId: 'c', database: 'd', collections: ['u'] });
  expect(run).not.toHaveBeenCalled();
});

it('stops at the iteration cap', async () => {
  const svc = new AgentService({
    provider: { chatWithTools: vi.fn().mockResolvedValue({ content: '', toolCalls: [{ id: 'c', name: 'runMongo', arguments: { statement: 'db.u.find()' } }] }) },
    runStatement: vi.fn().mockResolvedValue({ groups: [] }),
    classify: () => ({ destructive: false, category: 'query', collection: 'u' }),
    onDestructive: blockWrites,
    emit: () => {},
    maxIter: 3,
  });
  const final = await svc.run('loop', { connectionId: 'c', database: 'd', collections: ['u'] });
  expect(final).toMatch(/stopped|iteration/i);
});

it('runs a destructive statement only after the policy approves', async () => {
  const run = vi.fn().mockResolvedValue({ groups: [{ docs: [{ deletedCount: 2 }] }] });
  const approve = vi.fn().mockResolvedValue({ run: true });
  const svc = new AgentService({
    provider: provider([
      { content: '', toolCalls: [{ id: 'c1', name: 'runMongo', arguments: { statement: 'db.u.deleteMany({})' } }] },
      { content: 'deleted', toolCalls: [] },
    ]),
    runStatement: run,
    classify: () => ({ destructive: true, category: 'mutation', collection: 'u' }),
    onDestructive: approve,
    emit: () => {},
  });
  await svc.run('delete', { connectionId: 'c', database: 'd', collections: ['u'] });
  expect(approve).toHaveBeenCalled();
  expect(run).toHaveBeenCalledOnce();
});
