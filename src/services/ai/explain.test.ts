import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('../../ipc', () => ({ runScript: vi.fn() }));

import { listen } from '@tauri-apps/api/event';
import { runScript } from '../../ipc';
import { isExplainable, summarizeExplain, formatExplainSummary, runExplain } from './explain';

const mockListen = vi.mocked(listen);
const mockRun = vi.mocked(runScript);

beforeEach(() => { vi.clearAllMocks(); });

describe('isExplainable', () => {
  it('matches find / aggregate snippets', () => {
    expect(isExplainable('db.users.find({ a: 1 })')).toBe(true);
    expect(isExplainable('db.orders.aggregate([{ $match: {} }])')).toBe(true);
  });
  it('rejects non-query snippets', () => {
    expect(isExplainable('const x = 1;')).toBe(false);
    expect(isExplainable('db.users.updateOne({}, {})')).toBe(false);
  });
});

describe('summarizeExplain', () => {
  it('summarizes an IXSCAN find plan', () => {
    const plan = {
      queryPlanner: { winningPlan: { stage: 'FETCH', inputStage: { stage: 'IXSCAN', indexName: 'email_1' } } },
      executionStats: { nReturned: 5, totalDocsExamined: 5, executionTimeMillis: 1 },
    };
    expect(summarizeExplain(plan)).toEqual({
      stage: 'FETCH',
      indexName: 'email_1',
      nReturned: 5,
      docsExamined: 5,
      executionMs: 1,
    });
  });

  it('summarizes a COLLSCAN plan with no index', () => {
    const plan = {
      queryPlanner: { winningPlan: { stage: 'COLLSCAN' } },
      executionStats: { nReturned: 100, totalDocsExamined: 10000, executionTimeMillis: 42 },
    };
    const s = summarizeExplain(plan);
    expect(s.stage).toBe('COLLSCAN');
    expect(s.indexName).toBeNull();
    expect(s.docsExamined).toBe(10000);
  });

  it('reads aggregate plans nested under stages[0].$cursor', () => {
    const plan = {
      stages: [{ $cursor: { queryPlanner: { winningPlan: { stage: 'IXSCAN', indexName: 'k_1' } }, executionStats: { nReturned: 2, totalDocsExamined: 2, executionTimeMillis: 0 } } }],
    };
    expect(summarizeExplain(plan).indexName).toBe('k_1');
  });
});

describe('formatExplainSummary', () => {
  it('formats an index plan', () => {
    expect(formatExplainSummary({ stage: 'FETCH', indexName: 'email_1', nReturned: 5, docsExamined: 5, executionMs: 1 }))
      .toBe('Plan: index "email_1" · returned 5 · examined 5 · 1ms');
  });
  it('flags a collscan', () => {
    expect(formatExplainSummary({ stage: 'COLLSCAN', indexName: null, nReturned: 100, docsExamined: 10000, executionMs: 42 }))
      .toBe('Plan: COLLSCAN (no index) · returned 100 · examined 10000 · 42ms');
  });
});

describe('runExplain', () => {
  // Capture the script-event handler the service registers, so the test can
  // drive fake events. listen resolves to an unsubscribe spy.
  function wireListen() {
    let handler: (e: { payload: unknown }) => void = () => {};
    const unsub = vi.fn();
    mockListen.mockImplementation((_evt, cb) => {
      handler = cb as typeof handler;
      return Promise.resolve(unsub);
    });
    return { fire: (payload: unknown) => handler({ payload }), unsub };
  }

  it('runs explain and resolves with the plan on done', async () => {
    const { fire, unsub } = wireListen();
    const planDoc = { queryPlanner: { winningPlan: { stage: 'COLLSCAN' } } };
    mockRun.mockImplementation(async (tabId, _c, _d, _s, _p, _ps, runId) => {
      fire({ tabId, runId, kind: 'group', groupIndex: 0, docs: [planDoc] });
      fire({ tabId, runId, kind: 'done', executionMs: 3 });
    });

    const plan = await runExplain('c', 'd', 'db.users.find({})');
    expect(plan).toEqual(planDoc);
    expect(mockRun).toHaveBeenCalledOnce();
    expect(unsub).toHaveBeenCalled();
    // The script must be awaited and NOT paren-wrapped — the harness only
    // auto-awaits lines starting with `db.`, so a wrapped expr would never run.
    const script = mockRun.mock.calls[0][3];
    expect(script).toBe("await db.users.find({}).explain('executionStats')");
    expect(script.startsWith('(')).toBe(false);
  });

  it('rejects on an error event', async () => {
    const { fire } = wireListen();
    mockRun.mockImplementation(async (tabId, _c, _d, _s, _p, _ps, runId) => {
      fire({ tabId, runId, kind: 'error', error: 'bad pipeline' });
    });
    await expect(runExplain('c', 'd', 'db.x.aggregate([])')).rejects.toThrow('bad pipeline');
  });
});
