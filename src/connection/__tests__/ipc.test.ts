// Smoke tests for the `connection/ipc.ts` invoke wrappers.
//
// What this guards: every wrapper dispatches the right command name and
// shapes its argument payload the way the Rust side expects (`{ input }`,
// `{ id }`, `{ prefs }`, `{ connectionId }`). The wire format of the
// payloads themselves is covered by the Rust serde tests + the shared
// JSON fixtures; here we only check the dispatch boundary.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Tauri core module before importing anything that pulls it in.
// `invoke` is replaced with a vi.fn() that resolves with a permissive
// sentinel — the wrappers under test never inspect the return value, so
// any value will do.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

import { invoke } from '@tauri-apps/api/core';
import {
  listV2,
  saveV2,
  deleteV2,
  testV2,
  prefsGet,
  prefsSet,
  prefsResolveEffective,
  type SaveInput,
} from '../ipc';
import type { Connection } from '../model';
import type { GlobalPrefs } from '../overrides';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

function dummyConnection(): Connection {
  return {
    id: 'c1',
    name: 'c1',
    target: { kind: 'uri', uri: 'mongodb://localhost:27017' },
    auth: { kind: 'none' },
    createdAt: '2026-05-28T00:00:00Z',
  };
}

function dummyGlobalPrefs(): GlobalPrefs {
  return {
    intelliShell: {
      commandTimeoutMs: 30000,
      autoCompleteEnabled: true,
      printLimit: 1000,
    },
    tools: {
      mongodumpPath: '/usr/bin/mongodump',
      mongorestorePath: '/usr/bin/mongorestore',
      mongoexportPath: '/usr/bin/mongoexport',
      mongoimportPath: '/usr/bin/mongoimport',
    },
    advanced: {
      appName: 'mongo-lens',
      retryWrites: true,
      retryReads: true,
      compressors: ['snappy'],
      serverSelectionTimeoutMs: 30000,
      connectTimeoutMs: 10000,
      socketTimeoutMs: 0,
    },
  };
}

describe('connection/ipc dispatch', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    invokeMock.mockResolvedValue(undefined);
  });

  // ── connections_v2_* ────────────────────────────────────────────────

  it('listV2 dispatches connections_v2_list with no args', async () => {
    await listV2();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('connections_v2_list');
  });

  it('saveV2 dispatches connections_v2_save with { input }', async () => {
    const input: SaveInput = {
      connection: dummyConnection(),
      secrets: [{ slot: 'auth-password', value: 'hunter2' }],
    };
    await saveV2(input);
    expect(invokeMock).toHaveBeenCalledWith('connections_v2_save', { input });
  });

  it('deleteV2 dispatches connections_v2_delete with { id }', async () => {
    await deleteV2('abc-123');
    expect(invokeMock).toHaveBeenCalledWith('connections_v2_delete', {
      id: 'abc-123',
    });
  });

  it('testV2 dispatches connections_v2_test with { input }', async () => {
    const input: SaveInput = {
      connection: dummyConnection(),
      secrets: [],
    };
    await testV2(input);
    expect(invokeMock).toHaveBeenCalledWith('connections_v2_test', { input });
  });

  // ── prefs_* ─────────────────────────────────────────────────────────

  it('prefsGet dispatches prefs_get with no args', async () => {
    await prefsGet();
    expect(invokeMock).toHaveBeenCalledWith('prefs_get');
  });

  it('prefsSet dispatches prefs_set with { prefs }', async () => {
    const prefs = dummyGlobalPrefs();
    await prefsSet(prefs);
    expect(invokeMock).toHaveBeenCalledWith('prefs_set', { prefs });
  });

  it('prefsResolveEffective dispatches with { connectionId }', async () => {
    await prefsResolveEffective('conn-7');
    expect(invokeMock).toHaveBeenCalledWith('prefs_resolve_effective', {
      connectionId: 'conn-7',
    });
  });

  // ── return-value propagation ────────────────────────────────────────

  it('return values from invoke are propagated to the caller', async () => {
    const result = [{ id: 'a', name: 'a' }];
    invokeMock.mockResolvedValueOnce(result);
    await expect(listV2()).resolves.toBe(result);
  });

  it('test result discriminated union is passed through unchanged', async () => {
    const fail = { ok: false, stage: 'auth', error: 'bad creds' };
    invokeMock.mockResolvedValueOnce(fail);
    await expect(
      testV2({ connection: dummyConnection(), secrets: [] }),
    ).resolves.toEqual(fail);
  });
});
