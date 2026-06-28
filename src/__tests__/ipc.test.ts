import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

import { analyzeSchema } from '../ipc';

describe('analyzeSchema ipc', () => {
  beforeEach(() => invoke.mockReset());

  it('invokes analyze_schema with camelCase args', async () => {
    invoke.mockResolvedValue({ schema: { count: 0, fields: [] }, sampled: 0, sampleSize: 1000 });
    await analyzeSchema('c1', 'db1', 'coll1', 1000);
    expect(invoke).toHaveBeenCalledWith('analyze_schema', {
      connectionId: 'c1', database: 'db1', collection: 'coll1', sampleSize: 1000,
    });
  });
});
