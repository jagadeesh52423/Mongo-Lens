import { describe, it, expect } from 'vitest';
import {
  validateTarget,
  validateAuth,
  validateTls,
  validateSsh,
  validateProxy,
  validateConnection,
} from '../validation';
import type { Connection } from '../model';

describe('validateTarget', () => {
  it('requires uri text when kind=uri', () => {
    expect(validateTarget({ kind: 'uri', uri: '' })).toHaveLength(1);
  });
  it('treats whitespace-only uri as empty', () => {
    expect(validateTarget({ kind: 'uri', uri: '   ' })).toHaveLength(1);
  });
  it('requires mongodb scheme when kind=uri', () => {
    expect(validateTarget({ kind: 'uri', uri: 'http://nope' })).toHaveLength(1);
  });
  it('accepts mongodb://', () => {
    expect(
      validateTarget({ kind: 'uri', uri: 'mongodb://h:27017' }),
    ).toHaveLength(0);
  });
  it('accepts mongodb+srv', () => {
    expect(
      validateTarget({ kind: 'uri', uri: 'mongodb+srv://x' }),
    ).toHaveLength(0);
  });
  it('requires host when kind=direct', () => {
    expect(
      validateTarget({ kind: 'direct', host: '', port: 27017 }),
    ).toHaveLength(1);
  });
  it('rejects port=0', () => {
    expect(
      validateTarget({ kind: 'direct', host: 'h', port: 0 }),
    ).toHaveLength(1);
  });
  it('rejects port>65535', () => {
    expect(
      validateTarget({ kind: 'direct', host: 'h', port: 70000 }),
    ).toHaveLength(1);
  });
  it('rejects non-integer port', () => {
    expect(
      validateTarget({ kind: 'direct', host: 'h', port: 27017.5 }),
    ).toHaveLength(1);
  });
  it('accepts valid direct', () => {
    expect(
      validateTarget({ kind: 'direct', host: 'h', port: 27017 }),
    ).toHaveLength(0);
  });
  it('reports both host AND port errors when both are bad', () => {
    expect(
      validateTarget({ kind: 'direct', host: '', port: 0 }),
    ).toHaveLength(2);
  });
});

describe('validateAuth', () => {
  it('accepts none', () => {
    expect(validateAuth({ kind: 'none' })).toHaveLength(0);
  });
  it('scram requires username + authDb', () => {
    expect(
      validateAuth({ kind: 'scram', username: '', authDb: '' }),
    ).toHaveLength(2);
  });
  it('scram accepts valid creds', () => {
    expect(
      validateAuth({ kind: 'scram', username: 'a', authDb: 'admin' }),
    ).toHaveLength(0);
  });
  it('legacy-cr requires username + authDb', () => {
    expect(
      validateAuth({ kind: 'legacy-cr', username: '', authDb: '' }),
    ).toHaveLength(2);
  });
  it('x509 requires certFile', () => {
    expect(validateAuth({ kind: 'x509', certFile: '' })).toHaveLength(1);
  });
  it('x509 accepts certFile present', () => {
    expect(
      validateAuth({ kind: 'x509', certFile: '/etc/ssl/c.pem' }),
    ).toHaveLength(0);
  });
  it('ldap requires username', () => {
    expect(validateAuth({ kind: 'ldap', username: '' })).toHaveLength(1);
  });
  it('kerberos requires principal', () => {
    expect(validateAuth({ kind: 'kerberos', principal: '' })).toHaveLength(1);
  });
  it('aws-iam allows empty (env creds)', () => {
    expect(validateAuth({ kind: 'aws-iam', useEnvCreds: true })).toHaveLength(0);
  });
  it('aws-iam allows fully empty', () => {
    expect(validateAuth({ kind: 'aws-iam' })).toHaveLength(0);
  });
  it('oidc allows empty', () => {
    expect(validateAuth({ kind: 'oidc' })).toHaveLength(0);
  });
});

describe('validateTls', () => {
  it('skips when undefined', () => {
    expect(validateTls(undefined)).toHaveLength(0);
  });
  it('skips when disabled', () => {
    expect(validateTls({ enabled: false })).toHaveLength(0);
  });
  it('passes when enabled with no extra fields', () => {
    expect(validateTls({ enabled: true })).toHaveLength(0);
  });
  it('passes when enabled with all extras', () => {
    expect(
      validateTls({
        enabled: true,
        allowInvalidCerts: true,
        allowInvalidHostnames: true,
        caFile: '/etc/ca.pem',
        clientCertFile: '/etc/c.pem',
      }),
    ).toHaveLength(0);
  });
});

describe('validateSsh', () => {
  it('skips when undefined', () => {
    expect(validateSsh(undefined)).toHaveLength(0);
  });
  it('accepts valid password ssh', () => {
    expect(
      validateSsh({
        host: 'h',
        port: 22,
        user: 'u',
        auth: { kind: 'password' },
        knownHostsPolicy: 'strict',
      }),
    ).toHaveLength(0);
  });
  it('key mode requires keyPath', () => {
    expect(
      validateSsh({
        host: 'h',
        port: 22,
        user: 'u',
        auth: { kind: 'key', keyPath: '', hasPassphrase: false },
        knownHostsPolicy: 'strict',
      }),
    ).toHaveLength(1);
  });
  it('key mode with keyPath is valid', () => {
    expect(
      validateSsh({
        host: 'h',
        port: 22,
        user: 'u',
        auth: { kind: 'key', keyPath: '/k', hasPassphrase: true },
        knownHostsPolicy: 'strict',
      }),
    ).toHaveLength(0);
  });
  it('agent mode does not need a keyPath', () => {
    expect(
      validateSsh({
        host: 'h',
        port: 22,
        user: 'u',
        auth: { kind: 'agent' },
        knownHostsPolicy: 'accept-any',
      }),
    ).toHaveLength(0);
  });
  it('reports host, port, user errors together', () => {
    expect(
      validateSsh({
        host: '',
        port: 0,
        user: '',
        auth: { kind: 'password' },
        knownHostsPolicy: 'strict',
      }),
    ).toHaveLength(3);
  });
});

describe('validateProxy', () => {
  it('skips when undefined', () => {
    expect(validateProxy(undefined)).toHaveLength(0);
  });
  it('requires host', () => {
    expect(
      validateProxy({ kind: 'socks5', host: '', port: 1080 }),
    ).toHaveLength(1);
  });
  it('requires valid port', () => {
    expect(
      validateProxy({ kind: 'socks5', host: 'h', port: 99999 }),
    ).toHaveLength(1);
  });
  it('accepts valid proxy', () => {
    expect(
      validateProxy({
        kind: 'socks5',
        host: 'h',
        port: 1080,
        auth: { username: 'u' },
      }),
    ).toHaveLength(0);
  });
});

describe('validateConnection', () => {
  function baseConnection(): Connection {
    return {
      id: 'c1',
      name: 'good',
      target: { kind: 'direct', host: 'h', port: 27017 },
      auth: { kind: 'none' },
      createdAt: '2026-05-28T00:00:00Z',
    };
  }

  it('returns no issues for a fully valid connection', () => {
    expect(validateConnection(baseConnection())).toHaveLength(0);
  });

  it('requires name', () => {
    const connection = { ...baseConnection(), name: '   ' };
    const issues = validateConnection(connection);
    expect(issues.some((i) => i.message === 'Name is required')).toBe(true);
  });

  it('aggregates issues from every tab', () => {
    const connection: Connection = {
      id: 'c1',
      name: '',
      target: { kind: 'direct', host: '', port: 0 },
      auth: { kind: 'scram', username: '', authDb: '' },
      tls: { enabled: true },
      ssh: {
        host: '',
        port: 0,
        user: '',
        auth: { kind: 'key', keyPath: '', hasPassphrase: false },
        knownHostsPolicy: 'strict',
      },
      proxy: { kind: 'socks5', host: '', port: 0 },
      createdAt: '2026-05-28T00:00:00Z',
    };
    const issues = validateConnection(connection);
    const tabs = new Set(issues.map((i) => i.tab));
    expect(tabs.has('server')).toBe(true);
    expect(tabs.has('auth')).toBe(true);
    expect(tabs.has('ssh')).toBe(true);
    expect(tabs.has('proxy')).toBe(true);
  });
});
