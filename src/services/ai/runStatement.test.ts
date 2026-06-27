import { it, expect, vi, beforeEach } from 'vitest';
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('../../ipc', () => ({ runScript: vi.fn() }));

import { listen } from '@tauri-apps/api/event';
import { runScript } from '../../ipc';
import { runStatement } from './runStatement';

const mockListen = vi.mocked(listen);
const mockRun = vi.mocked(runScript);
beforeEach(() => { vi.clearAllMocks(); });

function wire() {
  let handler: (e: { payload: unknown }) => void = () => {};
  mockListen.mockImplementation((_e, cb) => { handler = cb as typeof handler; return Promise.resolve(vi.fn()); });
  return (payload: unknown) => handler({ payload });
}

it('collects groups and resolves on done', async () => {
  const fire = wire();
  mockRun.mockImplementation(async (tabId, _c, _d, _s, _p, _ps, runId) => {
    fire({ tabId, runId, kind: 'group', groupIndex: 0, docs: [{ a: 1 }], collection: 'users', category: 'query' });
    fire({ tabId, runId, kind: 'done', executionMs: 2 });
  });
  const res = await runStatement('c', 'd', 'db.users.find({})');
  expect(res.groups[0]).toMatchObject({ docs: [{ a: 1 }], collection: 'users', category: 'query' });
});

it('caps docs per group', async () => {
  const fire = wire();
  const many = Array.from({ length: 50 }, (_, i) => ({ i }));
  mockRun.mockImplementation(async (tabId, _c, _d, _s, _p, _ps, runId) => {
    fire({ tabId, runId, kind: 'group', groupIndex: 0, docs: many });
    fire({ tabId, runId, kind: 'done' });
  });
  const res = await runStatement('c', 'd', 'db.users.find({})', { maxDocsPerGroup: 10 });
  expect(res.groups[0].docs).toHaveLength(10);
  expect(res.groups[0].truncated).toBe(true);
});

it('rejects on error event', async () => {
  const fire = wire();
  mockRun.mockImplementation(async (tabId, _c, _d, _s, _p, _ps, runId) => {
    fire({ tabId, runId, kind: 'error', error: 'boom' });
  });
  await expect(runStatement('c', 'd', 'db.x.find()')).rejects.toThrow('boom');
});
