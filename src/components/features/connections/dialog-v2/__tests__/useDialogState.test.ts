import { describe, it, expect } from 'vitest';
import { dialogReducer, initialDialogState } from '../useDialogState';
import { DEFAULT_GLOBAL_PREFS } from '../../../../../connection/overrides';
import type { Connection } from '../../../../../connection/model';

const sample: Connection = {
  id: 'a', name: 'X',
  target: { kind: 'direct', host: 'h', port: 27017 },
  auth: { kind: 'scram', username: 'u', authDb: 'admin', mechanism: 'auto' },
  createdAt: '2026-01-01T00:00:00Z',
};

describe('dialogReducer', () => {
  const init = initialDialogState(sample, DEFAULT_GLOBAL_PREFS);

  it('set-field updates a top-level field', () => {
    const next = dialogReducer(init, { type: 'set-field', path: 'name', value: 'Renamed' });
    expect(next.draft.name).toBe('Renamed');
  });

  it('set-field updates a nested field via dot-path', () => {
    const next = dialogReducer(init, { type: 'set-field', path: 'target.host', value: 'other' });
    expect(next.draft.target).toEqual({ kind: 'direct', host: 'other', port: 27017 });
  });

  it('set-auth-kind switches auth variant and zeros fields', () => {
    const next = dialogReducer(init, { type: 'set-auth-kind', kind: 'x509' });
    expect(next.draft.auth).toEqual({ kind: 'x509', certFile: '' });
  });

  it('set-secret stores a secret slot', () => {
    const next = dialogReducer(init, { type: 'set-secret', slot: 'auth-password', value: 'pw' });
    expect(next.secrets['auth-password']).toBe('pw');
  });

  it('test-start sets pending', () => {
    expect(dialogReducer(init, { type: 'test-start' }).testResult).toEqual({ kind: 'pending' });
  });

  it('test-result OK stores serverInfo', () => {
    const next = dialogReducer(init, { type: 'test-result', result: { ok: true, serverInfo: { v: 1 } } });
    expect(next.testResult).toEqual({ kind: 'ok', serverInfo: { v: 1 } });
  });

  it('test-result fail stores stage + error', () => {
    const next = dialogReducer(init, {
      type: 'test-result',
      result: { ok: false, stage: 'auth', error: 'bad creds' },
    });
    expect(next.testResult).toEqual({ kind: 'fail', stage: 'auth', error: 'bad creds' });
  });
});
