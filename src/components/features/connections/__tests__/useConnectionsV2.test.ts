import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { useConnectionsV2 } from '../useConnectionsV2';
import type { Connection } from '../../../../connection/model';

const sample: Connection = {
  id: 'a', name: 'Sample',
  target: { kind: 'direct', host: 'h', port: 27017 },
  auth: { kind: 'none' },
  createdAt: '2026-01-01T00:00:00Z',
};

describe('useConnectionsV2', () => {
  // Wrapped in braces so the arrow returns `void` — `mockReset()` returns the
  // mock itself, which Vitest's `beforeEach` mis-types as a cleanup callback.
  beforeEach(() => { vi.mocked(invoke).mockReset(); });

  it('refresh calls connections_v2_list and stores result', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([sample]);
    const { result } = renderHook(() => useConnectionsV2());
    await act(() => result.current.refresh());
    expect(invoke).toHaveBeenCalledWith('connections_v2_list');
    expect(result.current.connections).toEqual([sample]);
  });

  it('save calls connections_v2_save then refreshes', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(sample)            // save
      .mockResolvedValueOnce([sample]);         // refresh
    const { result } = renderHook(() => useConnectionsV2());
    const saved = await act(() => result.current.save({ connection: sample, secrets: [] }));
    expect(invoke).toHaveBeenNthCalledWith(1, 'connections_v2_save', { input: { connection: sample, secrets: [] } });
    expect(invoke).toHaveBeenNthCalledWith(2, 'connections_v2_list');
    expect(saved).toEqual(sample);
  });

  it('remove calls connections_v2_delete then refreshes', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined).mockResolvedValueOnce([]);
    const { result } = renderHook(() => useConnectionsV2());
    await act(() => result.current.remove('a'));
    expect(invoke).toHaveBeenNthCalledWith(1, 'connections_v2_delete', { id: 'a' });
    expect(invoke).toHaveBeenNthCalledWith(2, 'connections_v2_list');
  });

  it('test calls connections_v2_test and returns result', async () => {
    const ok = { ok: true, serverInfo: { version: '7.0' } } as const;
    vi.mocked(invoke).mockResolvedValueOnce(ok);
    const { result } = renderHook(() => useConnectionsV2());
    const r = await act(() => result.current.test({ connection: sample, secrets: [] }));
    expect(invoke).toHaveBeenCalledWith('connections_v2_test', { input: { connection: sample, secrets: [] } });
    expect(r).toEqual(ok);
  });
});
