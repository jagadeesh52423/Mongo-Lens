# Connection Model Redesign — Phase 1 (Backend, Dark)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the new tagged-union connection model, Rust serde mirror, secrets/keychain abstraction, lazy dual-table migration, and updated IPC surface — all behind a `CONN_V2=1` feature flag. Old dialog continues shipping unchanged and remains the source of truth for `connections`; new infra populates `connections_v2` on every save and on first launch.

**Architecture:** Tagged-union TS types in `src/connection/` mirrored in Rust `src-tauri/src/connection/`. Shared JSON fixtures lock the wire contract. `Connection → mongodb::ClientOptions` translation lives only in `connection::builder`. Secrets travel through a keyed Keychain abstraction (`conn:<id>:<slot>`) and never appear in the DB row or on the wire. Migration runs lazily: on app start for all rows, and on every old-dialog save for the touched row. Phases 2–4 (new UI, default-on, removal of old dialog) are separate plans.

**Tech Stack:** TS / React / Vitest (frontend), Rust / Tauri 2 / rusqlite / mongodb 3 / security-framework (backend), shared JSON fixtures in `tests/fixtures/connection/`.

**Spec reference:** `docs/superpowers/specs/2026-05-28-connection-model-redesign-design.md`. When a contract detail in this plan is silent, defer to the spec.

---

## File Structure

### New files

```
src/connection/
├── model.ts                ← TS tagged unions (AuthMode, ConnectionTarget, Tls, SshTunnel, Proxy, Overrides, Connection)
├── validation.ts           ← Pure validators per tab
├── overrides.ts            ← resolveEffective(global, overrides) per-field merge
├── migration.ts            ← Pure flat → tagged-union migrator (also used by Rust via shared fixtures for contract tests)
├── __tests__/model.test.ts
├── __tests__/validation.test.ts
├── __tests__/overrides.test.ts
└── __tests__/migration.test.ts

src-tauri/src/connection/
├── mod.rs                  ← Re-exports + module wiring
├── model.rs                ← Rust mirror of TS tagged unions; #[serde(tag = "kind", rename_all = "kebab-case")]
├── store.rs                ← connections_v2 table read/write (payload JSON column)
├── secrets.rs              ← keychain key derivation + abstract Keychain trait
├── builder.rs              ← Connection + EffectivePrefs → mongodb::options::ClientOptions; staged errors
├── tunnel.rs               ← Bridges connection::SshTunnel → ssh::TunnelHandle
├── proxy.rs                ← HTTP/SOCKS proxy config struct + builder hook
└── migration.rs            ← ConnectionRecord (flat) → connection::model::Connection

src-tauri/src/prefs/
├── mod.rs
└── model.rs                ← GlobalPrefs (IntelliShell/Tools/Advanced)

src-tauri/src/commands/connection_v2.rs   ← New IPC commands (connections_v2_*)
src-tauri/src/commands/prefs.rs           ← prefs_get / prefs_set / prefs_resolve_effective

tests/fixtures/connection/
├── auth-none.json
├── auth-scram.json
├── auth-x509.json
├── auth-ldap.json
├── auth-kerberos.json
├── auth-aws-iam.json
├── auth-oidc.json
├── auth-legacy-cr.json
├── target-uri.json
├── target-direct.json
├── tls-enabled.json
├── ssh-key-passphrase.json
├── ssh-password.json
├── ssh-agent.json
├── proxy-socks5.json
└── overrides-all-fields.json
```

### Modified files

- `src-tauri/src/main.rs` — register new commands; gate behind `CONN_V2`.
- `src-tauri/src/commands/connection.rs` — on `create_connection` / `update_connection`, call `connection::migration::sync_row_to_v2` so the v2 table stays current while the old dialog ships.
- `src-tauri/src/db.rs` / `src-tauri/src/db/connections.rs` — add `connections_v2` schema migration (CREATE TABLE only — no rename until Phase 4).
- `src-tauri/src/ssh/auth.rs` — extend `AuthSecrets` to carry SSH password and a "use agent" flag in addition to passphrase.
- `src-tauri/Cargo.toml` — no new deps anticipated for Phase 1 (russh already supports password + agent; mongodb crate supports the auth modes we need; proxy support uses driver-native config). Re-check at Task 7.

---

## Task 1: TS — Tagged-union types and serde-compatible JSON shape

**Files:**
- Create: `src/connection/model.ts`
- Create: `src/connection/__tests__/model.test.ts`
- Create: `tests/fixtures/connection/auth-none.json`, `auth-scram.json`, `auth-x509.json`, `auth-ldap.json`, `auth-kerberos.json`, `auth-aws-iam.json`, `auth-oidc.json`, `auth-legacy-cr.json`, `target-uri.json`, `target-direct.json`, `tls-enabled.json`, `ssh-key-passphrase.json`, `ssh-password.json`, `ssh-agent.json`, `proxy-socks5.json`, `overrides-all-fields.json`

- [ ] **Step 1: Write `src/connection/model.ts`** with the exact types from spec §Data Model. Reproduced here for canonical reference:

```ts
export type AuthMode =
  | { kind: 'none' }
  | { kind: 'scram'; username: string; authDb: string;
                     mechanism?: 'SCRAM-SHA-1' | 'SCRAM-SHA-256' | 'auto' }
  | { kind: 'legacy-cr'; username: string; authDb: string }
  | { kind: 'x509'; certFile: string; certKeyFile?: string }
  | { kind: 'ldap'; username: string }
  | { kind: 'kerberos'; principal: string; serviceName?: string; canonicalizeHostName?: boolean }
  | { kind: 'aws-iam'; accessKeyId?: string; sessionToken?: string; useEnvCreds?: boolean }
  | { kind: 'oidc'; principal?: string; providerName?: string };

export type ConnectionTarget =
  | { kind: 'uri'; uri: string }
  | { kind: 'direct'; host: string; port: number; replicaSet?: string;
                      readPreference?: 'primary' | 'primaryPreferred' | 'secondary' | 'secondaryPreferred' | 'nearest';
                      directConnection?: boolean };

export type Tls =
  | { enabled: false }
  | { enabled: true; allowInvalidCerts?: boolean; allowInvalidHostnames?: boolean;
                     caFile?: string; clientCertFile?: string };

export type SshAuth =
  | { kind: 'password' }
  | { kind: 'key'; keyPath: string; hasPassphrase: boolean }
  | { kind: 'agent' };

export type SshTunnel = {
  host: string; port: number; user: string; auth: SshAuth;
  knownHostsPolicy: 'strict' | 'add-and-trust' | 'accept-any';
};

export type Proxy = {
  kind: 'http' | 'socks4' | 'socks5';
  host: string; port: number;
  auth?: { username: string };
};

export type IntelliShellOverrides = {
  commandTimeoutMs?: number;
  autoCompleteEnabled?: boolean;
  printLimit?: number;
};

export type ToolsOverrides = {
  mongodumpPath?: string;
  mongorestorePath?: string;
  mongoexportPath?: string;
  mongoimportPath?: string;
};

export type AdvancedOverrides = {
  appName?: string;
  retryWrites?: boolean;
  retryReads?: boolean;
  compressors?: Array<'snappy' | 'zlib' | 'zstd'>;
  serverSelectionTimeoutMs?: number;
  connectTimeoutMs?: number;
  socketTimeoutMs?: number;
};

export interface Connection {
  id: string;
  name: string;
  color?: string;
  target: ConnectionTarget;
  auth: AuthMode;
  tls?: Tls;
  ssh?: SshTunnel;
  proxy?: Proxy;
  overrides?: {
    intelliShell?: IntelliShellOverrides;
    tools?: ToolsOverrides;
    advanced?: AdvancedOverrides;
  };
  createdAt: string;
}
```

- [ ] **Step 2: Create the 16 fixture JSON files.**

Each fixture is a complete, valid `Connection` object exercising the named variant. Example for `auth-scram.json`:

```json
{
  "id": "fx-auth-scram",
  "name": "Fixture: SCRAM auth",
  "target": { "kind": "direct", "host": "db.example", "port": 27017 },
  "auth": { "kind": "scram", "username": "alice", "authDb": "admin", "mechanism": "auto" },
  "createdAt": "2026-05-28T00:00:00Z"
}
```

Each fixture must (a) parse as `Connection`, (b) round-trip through `JSON.stringify` / `JSON.parse` with no loss, (c) be valid input for the Rust serde mirror in Task 2. Cover every union variant once. For `overrides-all-fields.json`, populate every field in every overrides block so per-field round-trip is exercised.

- [ ] **Step 3: Write `src/connection/__tests__/model.test.ts`.**

```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Connection } from '../model';

const FIXTURE_DIR = path.resolve(__dirname, '../../../tests/fixtures/connection');

describe('Connection model', () => {
  const files = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));
  expect(files.length).toBeGreaterThanOrEqual(16);

  for (const file of files) {
    it(`round-trips ${file} through JSON`, () => {
      const raw = fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8');
      const parsed = JSON.parse(raw) as Connection;
      const restringified = JSON.stringify(parsed);
      const reparsed = JSON.parse(restringified) as Connection;
      expect(reparsed).toEqual(parsed);
      // Sanity: every fixture must have a discriminated auth.kind and target.kind
      expect(parsed.auth.kind).toBeDefined();
      expect(parsed.target.kind).toBeDefined();
    });
  }
});
```

- [ ] **Step 4: Run tests.**

```bash
npm test -- src/connection/__tests__/model.test.ts
```

Expected: all fixture round-trip tests pass.

- [ ] **Step 5: Commit.**

```bash
git add src/connection/model.ts src/connection/__tests__/model.test.ts tests/fixtures/connection/
git commit -m "feat(connection): tagged-union TS model + shared JSON fixtures"
```

---

## Task 2: Rust — Serde mirror + contract round-trip against shared fixtures

**Files:**
- Create: `src-tauri/src/connection/mod.rs`
- Create: `src-tauri/src/connection/model.rs`

- [ ] **Step 1: Add `mod connection;` to `src-tauri/src/main.rs`** alongside the other module declarations.

- [ ] **Step 2: Write `src-tauri/src/connection/mod.rs`.**

```rust
pub mod model;

#[cfg(test)]
mod model_contract_tests;
```

- [ ] **Step 3: Write `src-tauri/src/connection/model.rs`** — Rust types matching `src/connection/model.ts`. Use `#[serde(tag = "kind", rename_all = "kebab-case")]` on every union and `#[serde(rename_all = "camelCase")]` on every struct so field names match TS verbatim.

Sketch (complete the rest by mirroring `model.ts` exactly — one variant per TS variant, one field per TS field):

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum AuthMode {
    None,
    Scram { username: String, #[serde(rename = "authDb")] auth_db: String,
            #[serde(default, skip_serializing_if = "Option::is_none")] mechanism: Option<ScramMechanism> },
    LegacyCr { username: String, #[serde(rename = "authDb")] auth_db: String },
    X509 { #[serde(rename = "certFile")] cert_file: String,
           #[serde(default, skip_serializing_if = "Option::is_none", rename = "certKeyFile")] cert_key_file: Option<String> },
    Ldap { username: String },
    Kerberos { principal: String,
               #[serde(default, skip_serializing_if = "Option::is_none", rename = "serviceName")] service_name: Option<String>,
               #[serde(default, skip_serializing_if = "Option::is_none", rename = "canonicalizeHostName")] canonicalize_host_name: Option<bool> },
    AwsIam { #[serde(default, skip_serializing_if = "Option::is_none", rename = "accessKeyId")] access_key_id: Option<String>,
             #[serde(default, skip_serializing_if = "Option::is_none", rename = "sessionToken")] session_token: Option<String>,
             #[serde(default, skip_serializing_if = "Option::is_none", rename = "useEnvCreds")] use_env_creds: Option<bool> },
    Oidc { #[serde(default, skip_serializing_if = "Option::is_none")] principal: Option<String>,
           #[serde(default, skip_serializing_if = "Option::is_none", rename = "providerName")] provider_name: Option<String> },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScramMechanism {
    #[serde(rename = "SCRAM-SHA-1")] ScramSha1,
    #[serde(rename = "SCRAM-SHA-256")] ScramSha256,
    #[serde(rename = "auto")] Auto,
}

// … ConnectionTarget, Tls, SshAuth, SshTunnel, Proxy, IntelliShellOverrides,
//    ToolsOverrides, AdvancedOverrides, Overrides, Connection: same pattern
```

Continue until every TS variant/field has a Rust counterpart. For `Tls`, model as enum `Tls::Disabled` (serializes as `{"enabled": false}`) and `Tls::Enabled { … }` using `#[serde(tag = "enabled")]` with `#[serde(rename = "true")]` etc., OR use an untagged enum with a custom (de)serializer keyed on the `enabled` bool. Pick whichever yields identical JSON to the `tls-enabled.json` fixture; the round-trip test will catch divergence.

- [ ] **Step 4: Write `src-tauri/src/connection/model_contract_tests.rs`** — load every fixture from `tests/fixtures/connection/`, deserialize to `Connection`, re-serialize, and assert the JSON value (not string) is structurally equal to the original.

```rust
use crate::connection::model::Connection;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn fixture_dir() -> PathBuf {
    // Cargo runs tests from src-tauri/; fixtures are at repo-root/tests/fixtures/connection
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/connection")
}

#[test]
fn round_trip_every_fixture() {
    let dir = fixture_dir();
    let mut count = 0usize;
    for entry in fs::read_dir(&dir).expect("fixture dir") {
        let path = entry.expect("entry").path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") { continue; }
        let raw = fs::read_to_string(&path).expect("read fixture");
        let original: Value = serde_json::from_str(&raw).expect("parse fixture as Value");
        let conn: Connection = serde_json::from_str(&raw)
            .unwrap_or_else(|e| panic!("deserialize {}: {}", path.display(), e));
        let reserialized = serde_json::to_value(&conn)
            .unwrap_or_else(|e| panic!("serialize {}: {}", path.display(), e));
        assert_eq!(reserialized, original, "round-trip mismatch in {}", path.display());
        count += 1;
    }
    assert!(count >= 16, "expected ≥16 fixtures, found {}", count);
}
```

- [ ] **Step 5: Run tests.**

```bash
cd src-tauri && cargo test --lib connection::model_contract_tests
```

Expected: PASS. If any fixture's `reserialized != original`, fix the serde attributes (most likely a missing `rename` or `skip_serializing_if`) until equality holds. Do not edit the fixture — the fixture is the contract.

- [ ] **Step 6: Commit.**

```bash
git add src-tauri/src/connection/ src-tauri/src/main.rs
git commit -m "feat(connection): rust serde mirror + fixture contract tests"
```

---

## Task 3: TS — Validation and override resolution (pure functions)

**Files:**
- Create: `src/connection/validation.ts`
- Create: `src/connection/overrides.ts`
- Create: `src/connection/__tests__/validation.test.ts`
- Create: `src/connection/__tests__/overrides.test.ts`

- [ ] **Step 1: Write `src/connection/validation.ts`.**

Defines per-tab validators. Each returns `string[]` of human-readable errors (empty array = valid). Pure functions, no IO.

```ts
import type { Connection, ConnectionTarget, AuthMode, Tls, SshTunnel, Proxy } from './model';

export type ValidationIssue = { tab: 'server' | 'auth' | 'tls' | 'ssh' | 'proxy'; message: string };

export function validateTarget(t: ConnectionTarget): ValidationIssue[] {
  if (t.kind === 'uri') {
    if (!t.uri.trim()) return [{ tab: 'server', message: 'Connection URI is required' }];
    if (!/^mongodb(\+srv)?:\/\//.test(t.uri))
      return [{ tab: 'server', message: 'URI must start with mongodb:// or mongodb+srv://' }];
    return [];
  }
  const issues: ValidationIssue[] = [];
  if (!t.host.trim()) issues.push({ tab: 'server', message: 'Host is required' });
  if (!Number.isInteger(t.port) || t.port < 1 || t.port > 65535)
    issues.push({ tab: 'server', message: 'Port must be 1–65535' });
  return issues;
}

export function validateAuth(a: AuthMode): ValidationIssue[] {
  switch (a.kind) {
    case 'none': return [];
    case 'scram':
    case 'legacy-cr':
      return [
        ...(a.username.trim() ? [] : [{ tab: 'auth' as const, message: 'Username is required' }]),
        ...(a.authDb.trim() ? [] : [{ tab: 'auth' as const, message: 'Auth DB is required' }]),
      ];
    case 'x509':
      return a.certFile.trim() ? [] : [{ tab: 'auth', message: 'Client certificate file is required' }];
    case 'ldap':
      return a.username.trim() ? [] : [{ tab: 'auth', message: 'Username is required' }];
    case 'kerberos':
      return a.principal.trim() ? [] : [{ tab: 'auth', message: 'Principal is required' }];
    case 'aws-iam': return []; // accessKeyId optional (env creds path)
    case 'oidc': return [];
  }
}

export function validateTls(t: Tls | undefined): ValidationIssue[] {
  if (!t || !t.enabled) return [];
  return []; // CA/clientCert paths optional; allowInvalid* is user choice
}

export function validateSsh(s: SshTunnel | undefined): ValidationIssue[] {
  if (!s) return [];
  const issues: ValidationIssue[] = [];
  if (!s.host.trim()) issues.push({ tab: 'ssh', message: 'SSH host is required' });
  if (!Number.isInteger(s.port) || s.port < 1 || s.port > 65535)
    issues.push({ tab: 'ssh', message: 'SSH port must be 1–65535' });
  if (!s.user.trim()) issues.push({ tab: 'ssh', message: 'SSH user is required' });
  if (s.auth.kind === 'key' && !s.auth.keyPath.trim())
    issues.push({ tab: 'ssh', message: 'SSH key path is required' });
  return issues;
}

export function validateProxy(p: Proxy | undefined): ValidationIssue[] {
  if (!p) return [];
  const issues: ValidationIssue[] = [];
  if (!p.host.trim()) issues.push({ tab: 'proxy', message: 'Proxy host is required' });
  if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535)
    issues.push({ tab: 'proxy', message: 'Proxy port must be 1–65535' });
  return issues;
}

export function validateConnection(c: Connection): ValidationIssue[] {
  if (!c.name.trim()) return [{ tab: 'server', message: 'Name is required' }, ...validateTarget(c.target),
                                ...validateAuth(c.auth), ...validateTls(c.tls), ...validateSsh(c.ssh),
                                ...validateProxy(c.proxy)];
  return [...validateTarget(c.target), ...validateAuth(c.auth), ...validateTls(c.tls),
          ...validateSsh(c.ssh), ...validateProxy(c.proxy)];
}
```

- [ ] **Step 2: Write `src/connection/overrides.ts`.**

```ts
import type { IntelliShellOverrides, ToolsOverrides, AdvancedOverrides } from './model';

export interface GlobalPrefs {
  intelliShell: Required<IntelliShellOverrides>;
  tools: Required<ToolsOverrides>;
  advanced: Required<AdvancedOverrides>;
}

export interface EffectivePrefs {
  intelliShell: Required<IntelliShellOverrides>;
  tools: Required<ToolsOverrides>;
  advanced: Required<AdvancedOverrides>;
}

function mergeBlock<T extends object>(global: T, overrides: Partial<T> | undefined): T {
  if (!overrides) return global;
  const out: any = { ...global };
  for (const key of Object.keys(overrides) as Array<keyof T>) {
    if (overrides[key] !== undefined) out[key] = overrides[key];
  }
  return out as T;
}

export function resolveEffective(
  global: GlobalPrefs,
  overrides?: {
    intelliShell?: IntelliShellOverrides;
    tools?: ToolsOverrides;
    advanced?: AdvancedOverrides;
  },
): EffectivePrefs {
  return {
    intelliShell: mergeBlock(global.intelliShell, overrides?.intelliShell),
    tools: mergeBlock(global.tools, overrides?.tools),
    advanced: mergeBlock(global.advanced, overrides?.advanced),
  };
}
```

- [ ] **Step 3: Write `src/connection/__tests__/validation.test.ts`** with one test per validator covering valid + every failure path. Minimum cases:

```ts
import { describe, it, expect } from 'vitest';
import { validateTarget, validateAuth, validateSsh, validateProxy, validateTls, validateConnection } from '../validation';

describe('validateTarget', () => {
  it('requires uri text when kind=uri', () => {
    expect(validateTarget({ kind: 'uri', uri: '' })).toHaveLength(1);
  });
  it('requires mongodb scheme when kind=uri', () => {
    expect(validateTarget({ kind: 'uri', uri: 'http://nope' })).toHaveLength(1);
  });
  it('accepts mongodb+srv', () => {
    expect(validateTarget({ kind: 'uri', uri: 'mongodb+srv://x' })).toHaveLength(0);
  });
  it('requires host+port when kind=direct', () => {
    expect(validateTarget({ kind: 'direct', host: '', port: 27017 })).toHaveLength(1);
    expect(validateTarget({ kind: 'direct', host: 'h', port: 0 })).toHaveLength(1);
    expect(validateTarget({ kind: 'direct', host: 'h', port: 27017 })).toHaveLength(0);
  });
});

describe('validateAuth', () => {
  it('accepts none', () => expect(validateAuth({ kind: 'none' })).toHaveLength(0));
  it('scram requires username + authDb', () => {
    expect(validateAuth({ kind: 'scram', username: '', authDb: '' })).toHaveLength(2);
  });
  it('x509 requires certFile', () => {
    expect(validateAuth({ kind: 'x509', certFile: '' })).toHaveLength(1);
  });
  it('kerberos requires principal', () => {
    expect(validateAuth({ kind: 'kerberos', principal: '' })).toHaveLength(1);
  });
  it('aws-iam allows empty (env creds)', () => {
    expect(validateAuth({ kind: 'aws-iam', useEnvCreds: true })).toHaveLength(0);
  });
});

describe('validateSsh', () => {
  it('skips when undefined', () => expect(validateSsh(undefined)).toHaveLength(0));
  it('key mode requires keyPath', () => {
    expect(validateSsh({ host: 'h', port: 22, user: 'u',
      auth: { kind: 'key', keyPath: '', hasPassphrase: false },
      knownHostsPolicy: 'strict' })).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Write `src/connection/__tests__/overrides.test.ts`.**

```ts
import { describe, it, expect } from 'vitest';
import { resolveEffective, type GlobalPrefs } from '../overrides';

const G: GlobalPrefs = {
  intelliShell: { commandTimeoutMs: 30000, autoCompleteEnabled: true, printLimit: 1000 },
  tools: { mongodumpPath: '/usr/bin/mongodump', mongorestorePath: '/usr/bin/mongorestore',
           mongoexportPath: '/usr/bin/mongoexport', mongoimportPath: '/usr/bin/mongoimport' },
  advanced: { appName: 'mongo-lens', retryWrites: true, retryReads: true, compressors: ['snappy'],
              serverSelectionTimeoutMs: 30000, connectTimeoutMs: 10000, socketTimeoutMs: 0 },
};

describe('resolveEffective', () => {
  it('returns global when no overrides', () => {
    expect(resolveEffective(G, undefined).intelliShell.commandTimeoutMs).toBe(30000);
  });
  it('per-field override applies', () => {
    const e = resolveEffective(G, { intelliShell: { commandTimeoutMs: 5000 } });
    expect(e.intelliShell.commandTimeoutMs).toBe(5000);
    expect(e.intelliShell.autoCompleteEnabled).toBe(true); // inherited
  });
  it('undefined means inherit (not "set to undefined")', () => {
    const e = resolveEffective(G, { intelliShell: { commandTimeoutMs: undefined } });
    expect(e.intelliShell.commandTimeoutMs).toBe(30000);
  });
  it('false is distinct from undefined', () => {
    const e = resolveEffective(G, { advanced: { retryWrites: false } });
    expect(e.advanced.retryWrites).toBe(false);
  });
  it('array override replaces, does not merge', () => {
    const e = resolveEffective(G, { advanced: { compressors: ['zstd'] } });
    expect(e.advanced.compressors).toEqual(['zstd']);
  });
});
```

- [ ] **Step 5: Run tests.**

```bash
npm test -- src/connection/__tests__/validation.test.ts src/connection/__tests__/overrides.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/connection/validation.ts src/connection/overrides.ts src/connection/__tests__/
git commit -m "feat(connection): validation + per-field override resolution (pure)"
```

---

## Task 4: TS — Migration from flat `Connection` (legacy types.ts shape) to tagged-union

**Files:**
- Create: `src/connection/migration.ts`
- Create: `src/connection/__tests__/migration.test.ts`
- Create: `tests/fixtures/connection/legacy/*.json` — legacy flat-shape inputs paired with expected-output filenames in `tests/fixtures/connection/migrated/*.json`.

- [ ] **Step 1: Create paired fixtures.** For each legacy shape, one input and one expected output. Cover:
  - `legacy/uri-only.json` → URI present, nothing else.
  - `legacy/host-no-auth.json` → host+port, no username.
  - `legacy/host-scram.json` → host+port+username+authDb.
  - `legacy/host-scram-missing-authdb.json` → host+port+username, no authDb.
  - `legacy/host-scram-with-ssh-key.json` → SCRAM + SSH key fields.
  - `legacy/uri-with-ssh-key.json` → URI + SSH key fields (URI carries creds; auth stays 'none').

Each output reflects the rules in spec §Migration (legacy → tagged-union), with `knownHostsPolicy: 'add-and-trust'` whenever SSH is present.

- [ ] **Step 2: Write `src/connection/migration.ts`.**

```ts
import type { Connection } from './model';

export interface LegacyConnection {
  id: string;
  name: string;
  host?: string;
  port?: number;
  authDb?: string;
  username?: string;
  connString?: string;
  sshHost?: string;
  sshPort?: number;
  sshUser?: string;
  sshKeyPath?: string;
  createdAt: string;
}

export function migrateLegacy(l: LegacyConnection): Connection {
  const target = l.connString
    ? { kind: 'uri' as const, uri: l.connString }
    : { kind: 'direct' as const, host: l.host ?? 'localhost', port: l.port ?? 27017 };

  const auth = l.connString
    ? { kind: 'none' as const }
    : l.username
      ? { kind: 'scram' as const, username: l.username, authDb: l.authDb ?? 'admin', mechanism: 'auto' as const }
      : { kind: 'none' as const };

  const ssh = l.sshHost
    ? { host: l.sshHost, port: l.sshPort ?? 22, user: l.sshUser ?? '',
        auth: { kind: 'key' as const, keyPath: l.sshKeyPath ?? '', hasPassphrase: false },
        knownHostsPolicy: 'add-and-trust' as const }
    : undefined;

  return { id: l.id, name: l.name, target, auth, ssh, createdAt: l.createdAt };
}
```

- [ ] **Step 3: Write `src/connection/__tests__/migration.test.ts`.**

```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { migrateLegacy, type LegacyConnection } from '../migration';
import type { Connection } from '../model';

const LEGACY = path.resolve(__dirname, '../../../tests/fixtures/connection/legacy');
const MIGRATED = path.resolve(__dirname, '../../../tests/fixtures/connection/migrated');

describe('migrateLegacy', () => {
  const files = fs.readdirSync(LEGACY).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    it(`migrates ${f} to expected output`, () => {
      const input = JSON.parse(fs.readFileSync(path.join(LEGACY, f), 'utf8')) as LegacyConnection;
      const expected = JSON.parse(fs.readFileSync(path.join(MIGRATED, f), 'utf8')) as Connection;
      expect(migrateLegacy(input)).toEqual(expected);
    });
  }

  it('re-migration of an already-migrated-shape is a no-op', () => {
    // Convert a migrated Connection back into a LegacyConnection-shaped input
    // (lossless only for legacy-expressible shapes), re-migrate, expect equal.
    const expected = JSON.parse(fs.readFileSync(path.join(MIGRATED, 'host-scram.json'), 'utf8')) as Connection;
    const round: LegacyConnection = {
      id: expected.id, name: expected.name, createdAt: expected.createdAt,
      host: expected.target.kind === 'direct' ? expected.target.host : undefined,
      port: expected.target.kind === 'direct' ? expected.target.port : undefined,
      username: expected.auth.kind === 'scram' ? expected.auth.username : undefined,
      authDb: expected.auth.kind === 'scram' ? expected.auth.authDb : undefined,
    };
    expect(migrateLegacy(round)).toEqual(expected);
  });
});
```

- [ ] **Step 4: Run tests.**

```bash
npm test -- src/connection/__tests__/migration.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/connection/migration.ts src/connection/__tests__/migration.test.ts tests/fixtures/connection/legacy/ tests/fixtures/connection/migrated/
git commit -m "feat(connection): TS migrator from legacy flat shape"
```

---

## Task 5: Rust — `connections_v2` table + store with payload-JSON column

**Files:**
- Create: `src-tauri/src/connection/store.rs`
- Modify: `src-tauri/src/db.rs` (or wherever schema migrations live — check `src-tauri/src/db/` first)

- [ ] **Step 1: Locate the existing schema-migration mechanism.** Run `grep -rn "CREATE TABLE" src-tauri/src/db*` and follow the pattern (numbered migrations, schema_version table, etc.). Match it.

- [ ] **Step 2: Add a new schema migration creating `connections_v2`:**

```sql
CREATE TABLE IF NOT EXISTS connections_v2 (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payload TEXT NOT NULL,    -- JSON: serialized Connection minus `id` (which is the PK)
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_connections_v2_name ON connections_v2 (name);
```

The old `connections` table is **untouched**. Both tables coexist through Phase 4.

- [ ] **Step 3: Write `src-tauri/src/connection/store.rs`** with `list`, `get`, `upsert`, `delete`. Sketch:

```rust
use crate::connection::model::Connection;
use rusqlite::{params, Connection as SqlConn, Result as SqlResult};

pub fn upsert(db: &SqlConn, c: &Connection) -> SqlResult<()> {
    let payload = serde_json::to_string(c).expect("Connection serializes");
    db.execute(
        "INSERT INTO connections_v2 (id, name, payload, created_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, payload = excluded.payload",
        params![c.id, c.name, payload, c.created_at],
    )?;
    Ok(())
}

pub fn list(db: &SqlConn) -> SqlResult<Vec<Connection>> {
    let mut stmt = db.prepare("SELECT payload FROM connections_v2 ORDER BY name")?;
    let rows = stmt.query_map([], |row| {
        let raw: String = row.get(0)?;
        Ok(serde_json::from_str::<Connection>(&raw)
            .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))?)
    })?;
    rows.collect()
}

pub fn get(db: &SqlConn, id: &str) -> SqlResult<Option<Connection>> { /* SELECT … WHERE id = ?1 */ unimplemented!() }
pub fn delete(db: &SqlConn, id: &str) -> SqlResult<()> { /* DELETE … WHERE id = ?1 */ unimplemented!() }
```

Complete `get` and `delete` following the same pattern.

- [ ] **Step 4: Inline unit tests in `store.rs` against an in-memory DB.**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::model::{AuthMode, Connection, ConnectionTarget};

    fn mem_db_with_schema() -> SqlConn {
        let db = SqlConn::open_in_memory().unwrap();
        db.execute_batch(include_str!("./schema_v2.sql")).unwrap();
        db
    }

    fn sample() -> Connection {
        Connection {
            id: "x".into(), name: "n".into(), color: None, createdAt: "2026-01-01T00:00:00Z".into(),
            target: ConnectionTarget::Direct { host: "h".into(), port: 27017, replica_set: None, read_preference: None, direct_connection: None },
            auth: AuthMode::None, tls: None, ssh: None, proxy: None, overrides: None,
        }
    }

    #[test]
    fn upsert_then_get_roundtrips() {
        let db = mem_db_with_schema();
        let c = sample();
        upsert(&db, &c).unwrap();
        assert_eq!(get(&db, "x").unwrap().unwrap(), c);
    }

    #[test]
    fn upsert_is_idempotent() {
        let db = mem_db_with_schema();
        let c = sample();
        upsert(&db, &c).unwrap(); upsert(&db, &c).unwrap();
        assert_eq!(list(&db).unwrap().len(), 1);
    }

    #[test]
    fn delete_removes() {
        let db = mem_db_with_schema();
        let c = sample(); upsert(&db, &c).unwrap();
        delete(&db, "x").unwrap();
        assert!(get(&db, "x").unwrap().is_none());
    }
}
```

(Extract the `CREATE TABLE` SQL into `src-tauri/src/connection/schema_v2.sql` so it's reusable in tests and the migration.)

- [ ] **Step 5: Run tests.**

```bash
cd src-tauri && cargo test --lib connection::store
```

Expected: all PASS.

- [ ] **Step 6: Commit.**

```bash
git add src-tauri/src/connection/store.rs src-tauri/src/connection/schema_v2.sql src-tauri/src/db*
git commit -m "feat(connection): connections_v2 table + payload-JSON store"
```

---

## Task 6: Rust — Keychain abstraction + slotted secret API

**Files:**
- Create: `src-tauri/src/connection/secrets.rs`

- [ ] **Step 1: Audit the existing keychain layer.** Read `src-tauri/src/keychain.rs` (already used by `commands/connection.rs:set_password/get_password/delete_password`). The new secrets layer wraps the same backend but adds slot-keyed namespacing without disturbing existing single-password callers (they will keep working through Phase 4).

- [ ] **Step 2: Write `src-tauri/src/connection/secrets.rs`.**

```rust
use crate::logger::Logger;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretSlot {
    AuthPassword,
    SshPassword,
    SshKeyPassphrase,
    ProxyPassword,
    AwsSecretKey,
}

impl SecretSlot {
    fn suffix(self) -> &'static str {
        match self {
            SecretSlot::AuthPassword => "auth-password",
            SecretSlot::SshPassword => "ssh-password",
            SecretSlot::SshKeyPassphrase => "ssh-key-passphrase",
            SecretSlot::ProxyPassword => "proxy-password",
            SecretSlot::AwsSecretKey => "aws-secret-key",
        }
    }
}

fn key_for(connection_id: &str, slot: SecretSlot) -> String {
    format!("conn:{}:{}", connection_id, slot.suffix())
}

pub trait SecretStore: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<String>, String>;
    fn set(&self, key: &str, value: &str) -> Result<(), String>;
    fn delete(&self, key: &str) -> Result<(), String>;
}

pub struct KeychainStore;

impl SecretStore for KeychainStore {
    fn get(&self, key: &str) -> Result<Option<String>, String> {
        // Delegate to the existing keychain crate but with our keyed namespace.
        // Implementation: wrap the same security-framework calls keychain.rs uses,
        // parameterized on `key` instead of the hard-coded "{conn_id}" form.
        unimplemented!()
    }
    fn set(&self, key: &str, value: &str) -> Result<(), String> { unimplemented!() }
    fn delete(&self, key: &str) -> Result<(), String> { unimplemented!() }
}

pub fn get(store: &dyn SecretStore, connection_id: &str, slot: SecretSlot) -> Result<Option<String>, String> {
    store.get(&key_for(connection_id, slot))
}
pub fn set(store: &dyn SecretStore, connection_id: &str, slot: SecretSlot, value: &str, log: &dyn Logger) -> Result<(), String> {
    log.info("secret set", crate::logctx! { "connId" => connection_id, "slot" => slot.suffix() });
    store.set(&key_for(connection_id, slot), value)
}
pub fn delete(store: &dyn SecretStore, connection_id: &str, slot: SecretSlot) -> Result<(), String> {
    store.delete(&key_for(connection_id, slot))
}

/// Delete every slot for a connection. Returns Ok even if some slots were absent.
pub fn delete_all_for(store: &dyn SecretStore, connection_id: &str) -> Result<(), String> {
    for slot in [SecretSlot::AuthPassword, SecretSlot::SshPassword, SecretSlot::SshKeyPassphrase,
                 SecretSlot::ProxyPassword, SecretSlot::AwsSecretKey] {
        let _ = store.delete(&key_for(connection_id, slot)); // best-effort
    }
    Ok(())
}
```

Implement `KeychainStore` against `security-framework` mirroring the existing `keychain.rs`. **Do not** modify `keychain.rs` — the old code path keeps using it untouched.

- [ ] **Step 3: Write tests using an in-memory mock `SecretStore`.**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use std::collections::HashMap;

    #[derive(Default)]
    struct MemStore(Mutex<HashMap<String, String>>);
    impl SecretStore for MemStore {
        fn get(&self, k: &str) -> Result<Option<String>, String> { Ok(self.0.lock().unwrap().get(k).cloned()) }
        fn set(&self, k: &str, v: &str) -> Result<(), String> { self.0.lock().unwrap().insert(k.into(), v.into()); Ok(()) }
        fn delete(&self, k: &str) -> Result<(), String> { self.0.lock().unwrap().remove(k); Ok(()) }
    }

    #[test]
    fn keys_are_slot_namespaced() {
        let store = MemStore::default();
        store.set("conn:abc:auth-password", "secret").unwrap();
        assert_eq!(get(&store, "abc", SecretSlot::AuthPassword).unwrap(), Some("secret".into()));
        assert_eq!(get(&store, "abc", SecretSlot::SshPassword).unwrap(), None);
    }

    #[test]
    fn delete_all_for_purges_every_slot() {
        let store = MemStore::default();
        for s in [SecretSlot::AuthPassword, SecretSlot::SshPassword, SecretSlot::ProxyPassword] {
            super::set(&store, "abc", s, "v", &crate::logger::test_logger::null_logger()).unwrap();
        }
        delete_all_for(&store, "abc").unwrap();
        for s in [SecretSlot::AuthPassword, SecretSlot::SshPassword, SecretSlot::ProxyPassword] {
            assert_eq!(get(&store, "abc", s).unwrap(), None);
        }
    }
}
```

(If `crate::logger::test_logger::null_logger` does not exist, add a minimal `NullLogger` in `src-tauri/src/logger/mod.rs` behind `#[cfg(test)]`.)

- [ ] **Step 4: Run tests.**

```bash
cd src-tauri && cargo test --lib connection::secrets
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src-tauri/src/connection/secrets.rs
git commit -m "feat(connection): slotted keychain abstraction"
```

---

## Task 7: Rust — SSH extensions (password, agent, passphrase pickup)

**Files:**
- Modify: `src-tauri/src/ssh/auth.rs`, `src-tauri/src/ssh/tunnel.rs` (or wherever auth is wired into russh)
- Create: `src-tauri/src/connection/tunnel.rs`

- [ ] **Step 1: Read existing SSH auth path.** Identify the function that takes `AuthSecrets` and invokes russh's `authenticate_*` methods. It currently supports `authenticate_publickey` with optional passphrase decryption.

- [ ] **Step 2: Extend `AuthSecrets`** so it can carry SSH password and a "use agent" flag in addition to the existing passphrase. Keep its API additive — existing callers stay valid.

```rust
#[derive(Default)]
pub struct AuthSecrets {
    pub ssh_key_passphrase: Option<zeroize::Zeroizing<String>>,
    pub ssh_password: Option<zeroize::Zeroizing<String>>,
    pub use_ssh_agent: bool,
}

impl AuthSecrets {
    pub fn with_passphrase(p: Option<String>) -> Self { /* existing behavior */ }
    pub fn with_password(p: String) -> Self { Self { ssh_password: Some(p.into()), ..Default::default() } }
    pub fn with_agent() -> Self { Self { use_ssh_agent: true, ..Default::default() } }
}
```

- [ ] **Step 3: Extend the russh auth dispatch.** When the new SSH auth model says `kind: 'password'`, call `authenticate_password`. When `kind: 'agent'`, use russh's agent client (russh ships an `agent` module). When `kind: 'key'`, keep current behavior.

For agent auth, the relevant russh API is `russh_keys::agent::client::AgentClient::connect_env()`. Iterate the agent's identities and try each via `session.authenticate_future_publickey`. Fail with a clear error if `SSH_AUTH_SOCK` is unset.

- [ ] **Step 4: Add `src-tauri/src/connection/tunnel.rs`** as the bridge: takes a `connection::model::SshTunnel` + resolved secrets and returns a `ssh::TunnelHandle`. This lives in `connection/` (not `ssh/`) because it knows the new model; `ssh/` stays model-agnostic.

```rust
use crate::connection::model::{SshTunnel, SshAuth};
use crate::ssh::{auth::AuthSecrets, TunnelHandle};

pub async fn open(
    tunnel: &SshTunnel,
    secrets: ResolvedSshSecrets,
    target_host: &str,
    target_port: u16,
    log: std::sync::Arc<dyn crate::logger::Logger>,
) -> Result<TunnelHandle, String> {
    let auth_secrets = match &tunnel.auth {
        SshAuth::Password => AuthSecrets::with_password(secrets.password.ok_or("ssh password missing")?),
        SshAuth::Key { has_passphrase: true, .. } =>
            AuthSecrets::with_passphrase(Some(secrets.key_passphrase.ok_or("ssh key passphrase missing")?)),
        SshAuth::Key { has_passphrase: false, .. } => AuthSecrets::with_passphrase(None),
        SshAuth::Agent => AuthSecrets::with_agent(),
    };
    // Delegate to existing ssh::tunnel::open(), passing tunnel.host/port/user, target_host/port,
    // auth_secrets, known_hosts_policy translation.
    unimplemented!()
}

pub struct ResolvedSshSecrets {
    pub password: Option<String>,
    pub key_passphrase: Option<String>,
}
```

- [ ] **Step 5: Add tests** for each auth-mode dispatch path. Mock russh at the trait boundary if needed; otherwise integration-test against a local sshd in `cfg(integration)`.

- [ ] **Step 6: Run tests + smoke build.**

```bash
cd src-tauri && cargo build && cargo test --lib ssh:: connection::tunnel
```

Expected: builds clean, all unit tests PASS.

- [ ] **Step 7: Commit.**

```bash
git add src-tauri/src/ssh/ src-tauri/src/connection/tunnel.rs
git commit -m "feat(ssh): password + agent auth; bridge to new SshTunnel model"
```

---

## Task 8: Rust — Proxy config (HTTP/SOCKS) for the driver

**Files:**
- Create: `src-tauri/src/connection/proxy.rs`

- [ ] **Step 1: Check `mongodb` crate v3 proxy support.** Run `cargo doc --open -p mongodb` or check docs at https://docs.rs/mongodb/3 for proxy options on `ClientOptions`. As of mongodb v3, `ClientOptions` has `proxy_host`/`proxy_port`/`proxy_username`/`proxy_password` for SOCKS5; HTTP proxy is not natively supported by the driver and would require an outer connector. If HTTP proxy is unsupported by the driver, mark it in the UI as "SOCKS only" in Phase 2; for Phase 1, **only implement SOCKS5** in `builder.rs`. Document the limitation in `proxy.rs` as a module doc comment.

- [ ] **Step 2: Write `src-tauri/src/connection/proxy.rs`.**

```rust
//! Proxy support for outbound MongoDB connections.
//!
//! Driver-native SOCKS5 only — HTTP and SOCKS4 are accepted in the model so
//! the UI can show them but rejected at builder time with a clear error until
//! the driver gains support.
use crate::connection::model::Proxy;

pub struct ResolvedProxy<'a> {
    pub spec: &'a Proxy,
    pub password: Option<&'a str>,
}

pub fn validate_for_driver(p: &Proxy) -> Result<(), String> {
    match p.kind {
        crate::connection::model::ProxyKind::Socks5 => Ok(()),
        _ => Err(format!("proxy kind '{:?}' not supported by mongodb driver; use SOCKS5", p.kind)),
    }
}
```

(Field name `ProxyKind` assumed; adjust to match the enum the serde mirror in Task 2 produced.)

- [ ] **Step 3: Tests.**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_http() { /* construct Http proxy, assert Err */ }
    #[test]
    fn accepts_socks5() { /* construct Socks5, assert Ok */ }
}
```

- [ ] **Step 4: Run + commit.**

```bash
cd src-tauri && cargo test --lib connection::proxy
git add src-tauri/src/connection/proxy.rs
git commit -m "feat(connection): SOCKS5 proxy config (HTTP/SOCKS4 deferred)"
```

---

## Task 9: Rust — `prefs/` module + global defaults

**Files:**
- Create: `src-tauri/src/prefs/mod.rs`
- Create: `src-tauri/src/prefs/model.rs`

- [ ] **Step 1: Mirror the TS `GlobalPrefs` shape in Rust.**

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntelliShellPrefs { pub command_timeout_ms: u64, pub auto_complete_enabled: bool, pub print_limit: u64 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsPrefs { pub mongodump_path: String, pub mongorestore_path: String,
                       pub mongoexport_path: String, pub mongoimport_path: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedPrefs { pub app_name: String, pub retry_writes: bool, pub retry_reads: bool,
                          pub compressors: Vec<String>, pub server_selection_timeout_ms: u64,
                          pub connect_timeout_ms: u64, pub socket_timeout_ms: u64 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalPrefs { pub intelli_shell: IntelliShellPrefs, pub tools: ToolsPrefs, pub advanced: AdvancedPrefs }

impl Default for GlobalPrefs {
    fn default() -> Self { /* sensible defaults: 30s timeouts, snappy compressor, mongo-lens appName, etc. */ }
}
```

- [ ] **Step 2: Persist via `tauri-plugin-store`** (already in deps). One key per prefs blob: `global_prefs` in `~/.mongomacapp/prefs.json` (via the plugin). Sketch in `prefs/mod.rs`:

```rust
pub fn load(handle: &tauri::AppHandle) -> GlobalPrefs { /* read from store, fall back to Default */ }
pub fn save(handle: &tauri::AppHandle, prefs: &GlobalPrefs) -> Result<(), String> { /* write to store */ }
pub fn resolve_effective(global: &GlobalPrefs, overrides: Option<&crate::connection::model::Overrides>)
    -> EffectivePrefs { /* per-field merge, mirrors TS resolveEffective */ }
```

- [ ] **Step 3: Tests for `resolve_effective`** mirror the TS overrides tests in Task 3 — port them to Rust against the same logical assertions (inherits when undefined, false ≠ undefined, array replaces).

- [ ] **Step 4: Run + commit.**

```bash
cd src-tauri && cargo test --lib prefs::
git add src-tauri/src/prefs/
git commit -m "feat(prefs): global prefs + per-field override resolution"
```

---

## Task 10: Rust — `connection::builder` (Connection → ClientOptions) + staged errors

**Files:**
- Create: `src-tauri/src/connection/builder.rs`

- [ ] **Step 1: Define `BuildStage` and `BuildError`.**

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BuildStage { Ssh, Tls, Auth, Ping }

#[derive(Debug, serde::Serialize)]
pub struct BuildError { pub stage: BuildStage, pub error: String }
```

- [ ] **Step 2: Define `ResolvedConnection`.**

```rust
pub struct ResolvedConnection<'a> {
    pub conn: &'a crate::connection::model::Connection,
    pub auth_password: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key_passphrase: Option<String>,
    pub proxy_password: Option<String>,
    pub aws_secret_key: Option<String>,
}
// Intentionally not Debug, not Serialize — secrets must not leak.
```

- [ ] **Step 3: Implement `build_client_options`.**

```rust
pub async fn build_client_options(
    resolved: &ResolvedConnection<'_>,
    effective: &crate::prefs::EffectivePrefs,
    log: std::sync::Arc<dyn crate::logger::Logger>,
) -> Result<mongodb::options::ClientOptions, BuildError> {
    use crate::connection::model::*;
    // 1. Establish SSH tunnel if configured. On failure → BuildStage::Ssh.
    // 2. Construct base URI from target (URI mode passes through; Direct mode synthesizes).
    //    If SSH tunnel established, rewrite host:port to the tunnel's local bind.
    // 3. Parse URI into ClientOptions.
    // 4. Apply TLS settings → BuildStage::Tls on error.
    // 5. Apply auth → BuildStage::Auth on error.
    // 6. Apply EffectivePrefs.advanced (appName, retry*, compressors, *_timeout_ms).
    // 7. Apply proxy (SOCKS5 only — proxy::validate_for_driver first).
    unimplemented!()
}
```

Per-section implementation notes (be precise about which `ClientOptions` field each maps to):

- TLS: `client_options.tls = Some(TlsOptions::builder().ca_file_path(…).cert_key_file_path(…).allow_invalid_certificates(…).allow_invalid_hostnames(…).build())`.
- SCRAM: `client_options.credential = Some(Credential::builder().username(u).password(pw).source(authDb).mechanism(AuthMechanism::ScramSha256 | ScramSha1 | <None=>auto negotiation>).build())`.
- X.509: `Credential::builder().mechanism(AuthMechanism::MongoDbX509).build()` (cert is loaded via TLS options).
- LDAP: `AuthMechanism::Plain` + username/password.
- Kerberos: `AuthMechanism::Gssapi` + principal as username; serviceName via mechanism_properties.
- AWS IAM: `AuthMechanism::MongoDbAws` + access_key_id/secret/session_token (or env if `useEnvCreds`).
- OIDC: `AuthMechanism::MongoDbOidc` + provider/principal via mechanism_properties.

Reference: https://docs.rs/mongodb/3 for exact API.

- [ ] **Step 4: Test the assembly with unit tests** that construct synthetic `ResolvedConnection` + `EffectivePrefs` and assert specific `ClientOptions` fields. Don't connect; just build.

```rust
#[tokio::test]
async fn scram_credentials_applied() {
    let conn = /* SCRAM connection */;
    let resolved = ResolvedConnection { conn: &conn, auth_password: Some("pw".into()), ..empty() };
    let opts = build_client_options(&resolved, &default_effective(), null_logger()).await.unwrap();
    let cred = opts.credential.unwrap();
    assert_eq!(cred.username, Some("alice".into()));
    assert_eq!(cred.source, Some("admin".into()));
}

#[tokio::test]
async fn tls_options_propagate() { /* … */ }
#[tokio::test]
async fn advanced_prefs_propagate() { /* appName, retryWrites, compressors, timeouts */ }
#[tokio::test]
async fn ssh_failure_stages_correctly() { /* feed broken SSH config; assert Err.stage == Ssh */ }
```

- [ ] **Step 5: Run + commit.**

```bash
cd src-tauri && cargo test --lib connection::builder
git add src-tauri/src/connection/builder.rs
git commit -m "feat(connection): builder Connection→ClientOptions with staged errors"
```

---

## Task 11: Rust — Migration runner + lazy/dual-table sync hook

**Files:**
- Create: `src-tauri/src/connection/migration.rs`

- [ ] **Step 1: Implement legacy → tagged-union migration in Rust** (same rules as TS Task 4).

```rust
use crate::connection::model::*;
use crate::db::connections::ConnectionRecord;

pub fn migrate(legacy: &ConnectionRecord) -> Connection {
    let target = if let Some(uri) = legacy.conn_string.as_deref().filter(|s| !s.is_empty()) {
        ConnectionTarget::Uri { uri: uri.into() }
    } else {
        ConnectionTarget::Direct {
            host: legacy.host.clone().unwrap_or_else(|| "localhost".into()),
            port: legacy.port.unwrap_or(27017) as u16,
            replica_set: None, read_preference: None, direct_connection: None,
        }
    };
    let auth = if legacy.conn_string.as_deref().filter(|s| !s.is_empty()).is_some() {
        AuthMode::None
    } else if let Some(u) = legacy.username.as_deref().filter(|s| !s.is_empty()) {
        AuthMode::Scram {
            username: u.into(),
            auth_db: legacy.auth_db.clone().unwrap_or_else(|| "admin".into()),
            mechanism: Some(ScramMechanism::Auto),
        }
    } else { AuthMode::None };
    let ssh = legacy.ssh_host.as_deref().filter(|s| !s.is_empty()).map(|h| SshTunnel {
        host: h.into(),
        port: legacy.ssh_port.map(|p| p as u16).unwrap_or(22),
        user: legacy.ssh_user.clone().unwrap_or_default(),
        auth: SshAuth::Key {
            key_path: legacy.ssh_key_path.clone().unwrap_or_default(),
            has_passphrase: false,
        },
        known_hosts_policy: KnownHostsPolicy::AddAndTrust,
    });
    Connection {
        id: legacy.id.clone(), name: legacy.name.clone(), color: None,
        created_at: legacy.created_at.clone(),
        target, auth, tls: None, ssh, proxy: None, overrides: None,
    }
}
```

- [ ] **Step 2: Add `sync_row_to_v2(db, legacy)`** — convenience that calls `migrate` and `store::upsert`. Also rekey the keychain entry: read from the old slot, write to `conn:<id>:auth-password` via `secrets::set`. **Do not delete** the old keychain entry; the old dialog still needs it through Phase 4.

```rust
pub fn sync_row_to_v2(
    db: &rusqlite::Connection,
    legacy: &ConnectionRecord,
    secrets_store: &dyn crate::connection::secrets::SecretStore,
    keychain: &dyn LegacyKeychain,
    log: &dyn crate::logger::Logger,
) -> Result<(), String> {
    let connection = migrate(legacy);
    crate::connection::store::upsert(db, &connection).map_err(|e| e.to_string())?;
    if let Ok(Some(old_pw)) = keychain.read_password(&legacy.id) {
        crate::connection::secrets::set(secrets_store, &legacy.id, crate::connection::secrets::SecretSlot::AuthPassword, &old_pw, log)?;
    }
    Ok(())
}

pub trait LegacyKeychain { fn read_password(&self, id: &str) -> Result<Option<String>, String>; }
```

- [ ] **Step 3: Add `migrate_all(db, …)`** — runs once at app start, idempotent (uses `upsert`). Iterate `db::connections::list(db)`, sync each.

- [ ] **Step 4: Wire into app start.** In `src-tauri/src/main.rs::run()`, after `db::open(&db_path)`, if `std::env::var("CONN_V2").is_ok()`, call `connection::migration::migrate_all(…)`. Log the count.

- [ ] **Step 5: Wire into old-dialog save paths.** In `commands/connection.rs::create_connection` and `update_connection`, after a successful `db::connections::insert/update`, also call `connection::migration::sync_row_to_v2` (gated on `CONN_V2`). Failure to sync logs a warning but does not fail the user's save (Phase 1 is dark).

- [ ] **Step 6: Tests.**

```rust
#[test]
fn migrate_uri_only_yields_none_auth_and_uri_target() { /* … */ }
#[test]
fn migrate_host_with_username_yields_scram_auto() { /* … */ }
#[test]
fn migrate_with_ssh_uses_add_and_trust_policy() { /* … */ }
#[test]
fn migrate_then_re_migrate_is_idempotent_when_upserted() { /* via store */ }
```

- [ ] **Step 7: Run + commit.**

```bash
cd src-tauri && cargo test --lib connection::migration
git add src-tauri/src/connection/migration.rs src-tauri/src/main.rs src-tauri/src/commands/connection.rs
git commit -m "feat(connection): migration runner + dual-table sync hook"
```

---

## Task 12: Rust — IPC commands (gated by `CONN_V2`) + frontend bindings

**Files:**
- Create: `src-tauri/src/commands/connection_v2.rs`
- Create: `src-tauri/src/commands/prefs.rs`
- Modify: `src-tauri/src/main.rs` (register handlers)
- Create: `src/connection/ipc.ts` (thin invoke wrappers for the new commands)

- [ ] **Step 1: Implement commands in `connection_v2.rs`.**

```rust
use crate::connection::{model::Connection, store};
use crate::state::AppState;
use tauri::State;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveInput {
    pub connection: Connection,
    pub secrets: Vec<SecretInput>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretInput {
    pub slot: String,    // "auth-password" | "ssh-password" | …
    pub value: String,
}

#[tauri::command] pub fn connections_v2_list(state: State<'_, AppState>) -> Result<Vec<Connection>, String> { /* store::list */ }
#[tauri::command] pub fn connections_v2_save(state: State<'_, AppState>, input: SaveInput) -> Result<Connection, String> { /* upsert + write each slot */ }
#[tauri::command] pub fn connections_v2_delete(state: State<'_, AppState>, id: String) -> Result<(), String> { /* store::delete + secrets::delete_all_for */ }

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "ok")]
pub enum TestResultV2 {
    #[serde(rename = "true")] Ok { server_info: serde_json::Value },
    #[serde(rename = "false")] Fail { stage: crate::connection::builder::BuildStage, error: String },
}

#[tauri::command]
pub async fn connections_v2_test(state: State<'_, AppState>, input: SaveInput) -> Result<TestResultV2, String> {
    // 1. Resolve secrets from input.secrets directly (no keychain — testing pre-save form values).
    // 2. Call builder::build_client_options → on Err return Fail.
    // 3. mongodb::Client::with_options + run `db.adminCommand({ ping: 1 })`.
    // 4. Tear down (client.shutdown, tunnel.close).
    // 5. Return Ok with server_info from `hello`.
    unimplemented!()
}
```

- [ ] **Step 2: Implement `commands/prefs.rs`** — `prefs_get`, `prefs_set`, `prefs_resolve_effective(connectionId)`. The last reads the connection from `connections_v2`, calls `prefs::resolve_effective`, returns `EffectivePrefs`.

- [ ] **Step 3: Register handlers** in `main.rs::run()`, gated on `std::env::var("CONN_V2").is_ok()`. The existing handlers stay registered unconditionally so the old dialog keeps working.

- [ ] **Step 4: Write `src/connection/ipc.ts`** with `invoke`-based wrappers.

```ts
import { invoke } from '@tauri-apps/api/core';
import type { Connection } from './model';

export type SecretInput = { slot: 'auth-password' | 'ssh-password' | 'ssh-key-passphrase' | 'proxy-password' | 'aws-secret-key'; value: string };
export type SaveInput = { connection: Connection; secrets: SecretInput[] };
export type BuildStage = 'ssh' | 'tls' | 'auth' | 'ping';
export type TestResult = { ok: true; serverInfo: unknown } | { ok: false; stage: BuildStage; error: string };

export const listV2 = () => invoke<Connection[]>('connections_v2_list');
export const saveV2 = (input: SaveInput) => invoke<Connection>('connections_v2_save', { input });
export const deleteV2 = (id: string) => invoke<void>('connections_v2_delete', { id });
export const testV2 = (input: SaveInput) => invoke<TestResult>('connections_v2_test', { input });
```

- [ ] **Step 5: Smoke test the IPC surface** with a Vitest using a tauri-mocking adapter or a hand-mocked `invoke`.

```ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }));
import { listV2 } from '../ipc';
describe('ipc', () => {
  it('listV2 dispatches connections_v2_list', async () => {
    await listV2();
    const { invoke } = await import('@tauri-apps/api/core');
    expect(invoke).toHaveBeenCalledWith('connections_v2_list');
  });
});
```

- [ ] **Step 6: Run + commit.**

```bash
cd src-tauri && cargo build
npm test -- src/connection/__tests__/
git add src-tauri/src/commands/connection_v2.rs src-tauri/src/commands/prefs.rs src-tauri/src/main.rs src/connection/ipc.ts
git commit -m "feat(connection): connections_v2 IPC + prefs commands (gated)"
```

---

## Task 13: Manual QA + Phase 1 wrap

- [ ] **Step 1: Run the full test suite.**

```bash
npm test
cd src-tauri && cargo test
```

Expected: all green.

- [ ] **Step 2: Manual smoke (CONN_V2 enabled).**

```bash
CONN_V2=1 npm run tauri dev
```

Then:

- Create a connection via the **old** dialog. Confirm it appears in `~/.mongomacapp/mongomacapp.sqlite` `connections` AND `connections_v2` tables (via `sqlite3` CLI).
- Edit the connection via the old dialog. Confirm `connections_v2.payload` updates.
- Use Tauri devtools console to call `__TAURI__.core.invoke('connections_v2_list')` — should return the migrated tagged-union shape.
- Delete the connection via the old dialog. Confirm row stays in `connections_v2` (old dialog does not delete from v2 — that is fine for Phase 1; new dialog will manage v2 deletes in Phase 2).

- [ ] **Step 3: Manual smoke (CONN_V2 disabled).**

```bash
npm run tauri dev   # no CONN_V2 env
```

Confirm old dialog still works end-to-end, and `connections_v2` is **not** written.

- [ ] **Step 4: Tag the milestone.**

```bash
git tag conn-v2-phase1
git log conn-v2-phase1 -1 --oneline
```

- [ ] **Step 5: Note next phase.** Phase 2 (UI, opt-in) will be planned in a separate `docs/superpowers/plans/2026-XX-XX-connection-model-redesign-phase2.md` once Phase 1 lands.

---

## Self-Review Notes

- **Spec coverage** — Task 1 covers data model; Tasks 2 + 11 cover Rust serde mirror; Tasks 3 covers validation + overrides; Tasks 4 + 11 cover migration; Task 5 covers store; Task 6 covers secrets; Task 7 covers SSH extensions; Task 8 covers proxy; Task 9 covers prefs; Task 10 covers builder + staged errors; Task 12 covers IPC including `connections_v2_test`. **Tabbed dialog UI is intentionally Phase 2 — separate plan.**
- **Deferred** — `mongodb` driver HTTP/SOCKS4 proxy support, OIDC mechanism wiring details, real Kerberos/LDAP testing — all out of scope for Phase 1 per spec §Non-Goals. Module skeletons accept them so Phase 2/3 plugs in.
- **Type consistency** — `SecretSlot::AuthPassword` (Rust) ↔ `'auth-password'` (TS string); `BuildStage::Ssh` ↔ `'ssh'`. Naming verified consistent across Tasks 6, 10, 12.
- **No placeholders for behavior** — `unimplemented!()` appears only in skeletons whose surrounding step text describes the concrete implementation; the executing agent fills in by following the surrounding bullet list.
