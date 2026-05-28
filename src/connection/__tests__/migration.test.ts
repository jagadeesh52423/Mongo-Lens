import { describe, it, expect } from 'vitest';
import { migrateLegacy, type LegacyConnection } from '../migration';
import type { Connection } from '../model';

// Load paired legacy/migrated fixtures via Vite's import.meta.glob.
// Each pair shares a filename: legacy/<name>.json + migrated/<name>.json.
const legacyRaw = import.meta.glob(
  '../../../tests/fixtures/connection/legacy/*.json',
  { eager: true, query: '?raw', import: 'default' },
) as Record<string, string>;
const migratedRaw = import.meta.glob(
  '../../../tests/fixtures/connection/migrated/*.json',
  { eager: true, query: '?raw', import: 'default' },
) as Record<string, string>;

function basename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

function pairs(): Array<{
  file: string;
  legacy: LegacyConnection;
  migrated: Connection;
}> {
  const byFile = new Map<string, { legacy?: string; migrated?: string }>();
  for (const [filePath, raw] of Object.entries(legacyRaw)) {
    const file = basename(filePath);
    const entry = byFile.get(file) ?? {};
    entry.legacy = raw;
    byFile.set(file, entry);
  }
  for (const [filePath, raw] of Object.entries(migratedRaw)) {
    const file = basename(filePath);
    const entry = byFile.get(file) ?? {};
    entry.migrated = raw;
    byFile.set(file, entry);
  }
  const result: Array<{
    file: string;
    legacy: LegacyConnection;
    migrated: Connection;
  }> = [];
  for (const [file, { legacy, migrated }] of byFile) {
    if (!legacy || !migrated) {
      throw new Error(
        `Unpaired fixture: ${file} (legacy=${!!legacy}, migrated=${!!migrated})`,
      );
    }
    result.push({
      file,
      legacy: JSON.parse(legacy) as LegacyConnection,
      migrated: JSON.parse(migrated) as Connection,
    });
  }
  return result.sort((a, b) => a.file.localeCompare(b.file));
}

describe('migrateLegacy', () => {
  const all = pairs();

  it('covers all six required scenarios', () => {
    const expected = [
      'host-no-auth.json',
      'host-scram-missing-authdb.json',
      'host-scram-with-ssh-key.json',
      'host-scram.json',
      'uri-only.json',
      'uri-with-ssh-key.json',
    ];
    expect(all.map((p) => p.file).sort()).toEqual(expected);
  });

  for (const { file, legacy, migrated } of all) {
    it(`migrates ${file} to expected output`, () => {
      expect(migrateLegacy(legacy)).toEqual(migrated);
    });
  }

  it('re-migration of an already-migrated-shape is a no-op (idempotence)', () => {
    // For a legacy-expressible shape, projecting the migrated Connection back
    // into a LegacyConnection and re-migrating must produce the same result.
    // This guards against the migrator drifting when the same row is re-
    // processed (e.g., the dual-table sync hook in Task 11 will re-migrate
    // on every save through the old dialog).
    const hostScram = all.find((p) => p.file === 'host-scram.json');
    if (!hostScram) throw new Error('host-scram.json fixture missing');
    const expected = hostScram.migrated;
    const projected: LegacyConnection = {
      id: expected.id,
      name: expected.name,
      createdAt: expected.createdAt,
      host:
        expected.target.kind === 'direct' ? expected.target.host : undefined,
      port:
        expected.target.kind === 'direct' ? expected.target.port : undefined,
      username: expected.auth.kind === 'scram' ? expected.auth.username : undefined,
      authDb: expected.auth.kind === 'scram' ? expected.auth.authDb : undefined,
    };
    expect(migrateLegacy(projected)).toEqual(expected);
  });

  it('re-migration of a URI-only row is a no-op (idempotence)', () => {
    const uriOnly = all.find((p) => p.file === 'uri-only.json');
    if (!uriOnly) throw new Error('uri-only.json fixture missing');
    const expected = uriOnly.migrated;
    const projected: LegacyConnection = {
      id: expected.id,
      name: expected.name,
      createdAt: expected.createdAt,
      connString:
        expected.target.kind === 'uri' ? expected.target.uri : undefined,
    };
    expect(migrateLegacy(projected)).toEqual(expected);
  });

  it('applies defaults: missing host → localhost, missing port → 27017', () => {
    const legacy: LegacyConnection = {
      id: 'lc-defaults',
      name: 'all defaults',
      createdAt: '2026-05-28T00:00:00Z',
    };
    const result = migrateLegacy(legacy);
    expect(result.target).toEqual({
      kind: 'direct',
      host: 'localhost',
      port: 27017,
    });
    expect(result.auth).toEqual({ kind: 'none' });
    expect(result.ssh).toBeUndefined();
  });

  it('applies SSH defaults: port=22, empty user, knownHostsPolicy=add-and-trust', () => {
    const legacy: LegacyConnection = {
      id: 'lc-ssh-min',
      name: 'minimal ssh',
      host: 'h',
      port: 27017,
      sshHost: 'bastion',
      createdAt: '2026-05-28T00:00:00Z',
    };
    const result = migrateLegacy(legacy);
    expect(result.ssh).toEqual({
      host: 'bastion',
      port: 22,
      user: '',
      auth: { kind: 'key', keyPath: '', hasPassphrase: false },
      knownHostsPolicy: 'add-and-trust',
    });
  });
});
