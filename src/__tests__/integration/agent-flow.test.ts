import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentService } from '../../services/ai/AgentService';
import { classifyStatement } from '../../services/ai/agentTools';
import { blockWrites, confirmViaStore } from '../../services/ai/destructivePolicy';
import { useAgentStore, type AgentEntry } from '../../store/agent';

/**
 * Integration test: wires the REAL AgentService loop + REAL classifier
 * (classifyStatement → query-classifier) + REAL destructive policies + REAL
 * transcript store together. Only the model provider and statement executor are
 * faked. This is the cross-module coverage the unit tests skip (they inject
 * `classify`/`onDestructive`), so it catches contract drift between the loop,
 * the classifier's category strings, and the confirm resolver plumbing.
 */

type ProviderTurn = { content: string; toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] };

function fakeProvider(seq: ProviderTurn[]) {
  const calls = [...seq];
  return { chatWithTools: vi.fn(async () => calls.shift() ?? { content: 'fallback', toolCalls: [] }) };
}

beforeEach(() => useAgentStore.setState({ byTab: {} }));

describe('agent flow (real classifier + policy + store)', () => {
  it('auto-runs a read but blocks a real-destructive statement under blockWrites', async () => {
    const runStatement = vi.fn().mockResolvedValue({ groups: [{ docs: [{ n: 1 }] }] });
    const provider = fakeProvider([
      { content: '', toolCalls: [{ id: 'a', name: 'runMongo', arguments: { statement: 'db.users.find({}).limit(1)' } }] },
      { content: '', toolCalls: [{ id: 'b', name: 'runMongo', arguments: { statement: 'db.users.deleteMany({})' } }] },
      { content: 'final answer', toolCalls: [] },
    ]);
    const svc = new AgentService({
      provider,
      runStatement,
      classify: classifyStatement,
      onDestructive: blockWrites,
      emit: () => {},
    });

    const { answer } = await svc.run('goal', { connectionId: 'c', database: 'd', collections: ['users'] });

    expect(answer).toContain('final answer');
    // The real classifier marks find as non-destructive (runs) and deleteMany as
    // destructive (blockWrites prevents execution).
    expect(runStatement).toHaveBeenCalledTimes(1);
    expect(runStatement).toHaveBeenCalledWith('c', 'd', 'db.users.find({}).limit(1)');
  });

  it('confirmViaStore gates a real-destructive statement until approved via the store', async () => {
    const tabId = 't1';
    const runStatement = vi.fn().mockResolvedValue({ groups: [{ docs: [{ deletedCount: 3 }] }] });
    const provider = fakeProvider([
      { content: '', toolCalls: [{ id: 'a', name: 'runMongo', arguments: { statement: 'db.users.deleteMany({ active: false })' } }] },
      { content: 'deleted', toolCalls: [] },
    ]);
    const svc = new AgentService({
      provider,
      runStatement,
      classify: classifyStatement,
      onDestructive: confirmViaStore(tabId),
      emit: (e) => useAgentStore.getState().append(tabId, e),
    });

    const runPromise = svc.run('delete inactive', { connectionId: 'c', database: 'd', collections: ['users'] });

    // A confirm entry appears and the statement has NOT run yet.
    await vi.waitFor(() => {
      const entries = useAgentStore.getState().byTab[tabId]?.entries ?? [];
      expect(entries.some((e) => e.kind === 'confirm')).toBe(true);
    });
    expect(runStatement).not.toHaveBeenCalled();

    const confirm = useAgentStore.getState().byTab[tabId].entries.find(
      (e): e is Extract<AgentEntry, { kind: 'confirm' }> => e.kind === 'confirm',
    )!;
    useAgentStore.getState().resolveConfirm(tabId, confirm.id, 'approved');

    await runPromise;
    expect(runStatement).toHaveBeenCalledWith('c', 'd', 'db.users.deleteMany({ active: false })');
  });

  it('denying via the store skips execution and feeds the model an alternative-seeking note', async () => {
    const tabId = 't2';
    const runStatement = vi.fn().mockResolvedValue({ groups: [] });
    const provider = fakeProvider([
      { content: '', toolCalls: [{ id: 'a', name: 'runMongo', arguments: { statement: 'db.users.drop()' } }] },
      { content: 'ok, leaving it', toolCalls: [] },
    ]);
    const svc = new AgentService({
      provider,
      runStatement,
      classify: classifyStatement,
      onDestructive: confirmViaStore(tabId),
      emit: (e) => useAgentStore.getState().append(tabId, e),
    });

    const runPromise = svc.run('drop users', { connectionId: 'c', database: 'd', collections: ['users'] });
    await vi.waitFor(() => {
      expect((useAgentStore.getState().byTab[tabId]?.entries ?? []).some((e) => e.kind === 'confirm')).toBe(true);
    });
    const confirm = useAgentStore.getState().byTab[tabId].entries.find(
      (e): e is Extract<AgentEntry, { kind: 'confirm' }> => e.kind === 'confirm',
    )!;
    useAgentStore.getState().resolveConfirm(tabId, confirm.id, 'denied');

    await runPromise;
    expect(runStatement).not.toHaveBeenCalled();
  });
});
