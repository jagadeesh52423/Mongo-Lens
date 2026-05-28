# Connection Model Redesign

**Date:** 2026-05-28
**Status:** Draft — awaiting user review

## Background & Motivation

Mongo Lens currently models a MongoDB connection as a flat, optionals-heavy
record (`src/types.ts:Connection`). Every field except `id`/`name`/`createdAt`
is optional, and the runtime semantics of "which field wins" are encoded only
in the dialog text ("Connection String overrides above if set") and ad-hoc
backend logic. This shape causes a set of concrete problems:

1. **Silent precedence.** Filling host/auth and pasting a URI silently discards
   the structured fields.
2. **No auth-mode distinction.** Only SCRAM (username/password) is modelable;
   there is no way to express X.509, LDAP, Kerberos, AWS IAM, OIDC, or
   explicit "no auth."
3. **No TLS/SSL fields.** Users hand-craft `?tls=true&tlsCAFile=…` into the URI.
4. **No proxy support.**
5. **SSH is key-only.** No password auth, no passphrase, no SSH agent, no
   known-hosts policy in the UI (the Rust `ssh/host_key.rs` exists but is not
   user-facing).
6. **No connection options** (`readPreference`, `replicaSet`, `appName`,
   `retryWrites`, `directConnection`, compressors) reachable from the UI —
   only via raw URI.
7. **No per-connection override of global preferences.** Globals don't exist
   as a concept yet either.
8. **No "Test connection" affordance.** Failures surface only on the first
   query against the connection.
9. **Connection/ConnectionInput asymmetry.** Differs only by `password`;
   nothing in the type system enforces that secrets travel through Keychain
   rather than the SQLite row.
10. **`authDb` hardcoded to `'admin'`.** Fine for SCRAM, meaningless for other
    auth modes.

This redesign replaces the flat shape with a composed, tagged-union model
that mirrors what Studio 3T exposes (auth mode + TLS + SSH + proxy +
per-connection overrides for tool/shell/advanced settings), without taking
on Studio 3T's UI complexity beyond what's justified.

## Goals

- Make every connection-shape invariant (which fields are valid together)
  enforceable at the type level rather than at runtime.
- Support all 8 auth modes Studio 3T offers: None, SCRAM (SHA-1/256 auto),
  Legacy MONGODB-CR, X.509, LDAP, Kerberos, AWS IAM, OIDC.
- Support SSL/TLS as a first-class block.
- Support SSH tunnel with password, key (with passphrase), and agent auth.
- Support HTTP / SOCKS4 / SOCKS5 proxies.
- Add three settings groups — IntelliShell, MongoDB Tools, Advanced — that
  resolve from global preferences but can be overridden per-connection on
  a per-field basis.
- Provide a "Test connection" affordance that returns a *staged* failure
  (which layer broke: ssh / tls / auth / ping).
- Auto-migrate existing user data losslessly.

## Non-Goals

- Building the consumers of "MongoDB Tools" (mongodump/restore/export/import
  integration). The settings slot exists; no feature uses it yet.
- A Settings UI for editing **global** preferences. This spec assumes
  `prefs_get` / `prefs_set` exist; the editor for globals is a separate spec.
  Per-connection overrides fully work without the globals editor — they just
  inherit from a defaults file.
- The prod-write guard banner / confirm-on-write behavior. The `color` field
  is wired in here for later use; the guard itself is a separate backlog item.
- Connection groups / folders in the tree — separate backlog item.
- Real SSH server, KDC, OIDC IdP, LDAP server, or AWS STS in automated tests
  — those are covered by a manual QA checklist.

---

## Data Model

One discriminated union per concern. `Connection` composes them.

```ts
type AuthMode =
  | { kind: 'none' }
  | { kind: 'scram'; username: string; authDb: string;
                     mechanism?: 'SCRAM-SHA-1' | 'SCRAM-SHA-256' | 'auto' }
  | { kind: 'legacy-cr'; username: string; authDb: string }
  | { kind: 'x509'; certFile: string; certKeyFile?: string }
  | { kind: 'ldap'; username: string }
  | { kind: 'kerberos'; principal: string; serviceName?: string;
                        canonicalizeHostName?: boolean }
  | { kind: 'aws-iam'; accessKeyId?: string;
                       sessionToken?: string;
                       useEnvCreds?: boolean }
  | { kind: 'oidc'; principal?: string; providerName?: string }

type ConnectionTarget =
  | { kind: 'uri'; uri: string }
  | { kind: 'direct'; host: string; port: number; replicaSet?: string;
                      readPreference?: 'primary'|'primaryPreferred'|'secondary'|
                                       'secondaryPreferred'|'nearest';
                      directConnection?: boolean }

type Tls =
  | { enabled: false }
  | { enabled: true; allowInvalidCerts?: boolean;
                     allowInvalidHostnames?: boolean;
                     caFile?: string; clientCertFile?: string }

type SshTunnel = {
  host: string; port: number; user: string;
  auth: { kind: 'password' }
      | { kind: 'key'; keyPath: string; hasPassphrase: boolean }
      | { kind: 'agent' };
  knownHostsPolicy: 'strict' | 'add-and-trust' | 'accept-any';
}

type Proxy = {
  kind: 'http' | 'socks4' | 'socks5';
  host: string; port: number;
  auth?: { username: string };
}

type IntelliShellOverrides = {
  commandTimeoutMs?: number;
  autoCompleteEnabled?: boolean;
  printLimit?: number;
}
type ToolsOverrides = {
  mongodumpPath?: string;
  mongorestorePath?: string;
  mongoexportPath?: string;
  mongoimportPath?: string;
}
type AdvancedOverrides = {
  appName?: string;
  retryWrites?: boolean;
  retryReads?: boolean;
  compressors?: ('snappy' | 'zlib' | 'zstd')[];
  serverSelectionTimeoutMs?: number;
  connectTimeoutMs?: number;
  socketTimeoutMs?: number;
}

interface Connection {
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

### Override semantics

In each overrides block, **undefined means "inherit from global"** and any
other value means "override." Per-field, not per-group. `false` is a valid
override and is distinct from undefined. Object/array fields use structural
equality when comparing against global.

### Secrets

Secrets never appear in `Connection`. They live in macOS Keychain under
keys of the form `conn:<id>:<slot>` where `slot` is one of:

- `auth-password` — SCRAM / Legacy-CR / LDAP password
- `ssh-password` — SSH tunnel password
- `ssh-key-passphrase` — passphrase for the SSH private key
- `proxy-password` — proxy auth password
- `aws-secret-key` — AWS IAM secret access key

A separate type `ResolvedConnection` (Rust-only, never crosses IPC) carries
plaintext secrets for the duration of a connect/test call. It does not
implement `Debug` or `Serialize`.

### Invariants enforced by the types

- `target.kind = 'uri'` excludes structured host/port/replicaSet fields by
  construction. No silent precedence.
- `auth.kind = 'none'` is explicit, not inferred from "no username."
- Adding a new auth mode = one new union variant; UI and Rust builder both
  dispatch off `auth.kind`.
- Secrets cannot leak into the connection row — they're not in the type.

---

## UI / Tabbed Dialog

```
┌────────────────────────────────────────────────────────────────┐
│ Connection: [_____________________]  Color: [● dev ▾]   [Test] │
├────────────────────────────────────────────────────────────────┤
│ [Server] [Auth] [TLS/SSL] [SSH] [Proxy] [IntelliShell] [Tools] │
│ [Advanced]                                                     │
├────────────────────────────────────────────────────────────────┤
│   (tab content)                                                │
├────────────────────────────────────────────────────────────────┤
│ Validation summary: ⚠ 2 issues   [Cancel]  [Test]  [Save]      │
└────────────────────────────────────────────────────────────────┘
```

### Tabs

1. **Server** — radio: `Direct (host/port)` vs `Connection URI`. Switching
   wipes the other side after confirmation if data is present. Direct mode
   shows host/port/replicaSet/readPreference/directConnection. URI mode shows
   the URI textarea plus a "parse into Direct" helper.
2. **Auth** — dropdown of 8 modes; the form below swaps to that mode's
   fields only. Password fields show `(stored in Keychain)` placeholder when
   editing existing. `None` hides everything below the dropdown.
3. **TLS/SSL** — single enable toggle; nested fields appear when enabled.
   CA file / client cert use file pickers. A warning banner appears when
   `allowInvalidCerts` is on.
4. **SSH** — enable toggle. When on: host/port/user + auth-method radio
   (password / key / agent). Key mode shows path + "has passphrase" checkbox.
   Known-hosts policy dropdown.
5. **Proxy** — enable toggle. Type radio (HTTP / SOCKS4 / SOCKS5),
   host/port, optional username.
6. **IntelliShell** / 7. **Tools** / 8. **Advanced** — each field row has
   `[ Use global ] [ Override: ____ ]`. Overridden fields show a small badge
   so users can scan customizations. "Reset all to global" button per tab.

### Cross-cutting UI

- **Test button** in the footer, always present. Runs the connect path with
  current form values without saving; surfaces the actual driver/Rust error.
- **Validation summary** in the footer aggregates errors from all tabs with
  click-to-jump links. Save is disabled while errors are present.
- **Tab badges** — a dot on any tab with validation errors or unsaved changes.
- **Color** is the env tag — reused later by the prod-write guard banner
  (separate backlog item).
- **Secrets** — password-shaped fields are write-only when editing an
  existing connection; placeholder reads `(stored in Keychain)`. Clearing
  requires an explicit "Remove secret" action, not leaving the field blank.

This replaces the current single-pane dialog with `<details>` for SSH plus
the "Connection String overrides above" footgun.

---

## Rust Backend & IPC Contract

### Module layout

```
src-tauri/src/
├── connection/                  ← NEW
│   ├── mod.rs                   ← Public API: load, save, test, connect
│   ├── model.rs                 ← Rust mirror of TS types (serde tagged unions)
│   ├── store.rs                 ← SQLite read/write (JSON payload column)
│   ├── secrets.rs               ← Keychain key derivation + get/set/delete
│   ├── builder.rs               ← Connection → mongodb::options::ClientOptions
│   ├── tunnel.rs                ← SSH tunnel orchestration (wraps ssh/tunnel.rs)
│   ├── proxy.rs                 ← HTTP/SOCKS proxy wiring for the driver
│   └── migration.rs             ← Flat → tagged-union one-time migrator
├── ssh/                         ← extended for password + agent auth
└── prefs/                       ← NEW
    ├── mod.rs
    └── model.rs                 ← GlobalPrefs (IntelliShell/Tools/Advanced)
```

`connection/builder.rs` is the single integration point: given a fully
resolved `Connection` (with secrets pulled from Keychain) and a resolved
`EffectivePrefs` (global merged with per-conn overrides), it returns a
driver-ready `ClientOptions`. TLS, compressors, timeouts, appName,
retryWrites all land in one place.

### Serde shape

Tagged unions use
`#[serde(tag = "kind", rename_all = "kebab-case")]` so the JSON across IPC
matches the TS types byte-for-byte. The SQLite row uses a single
`payload JSON NOT NULL` column rather than 11 nullable typed columns —
schema rigidity lives in the Rust types, not the table.

### Secrets resolution

`secrets.rs` owns the keychain key namespace. The `Connection` struct never
holds plaintext. `ResolvedConnection` holds plaintext briefly inside
`builder.rs` for the duration of a connect/test call. It implements neither
`Debug` nor `Serialize`, so secrets cannot leak via logs or IPC.

### IPC commands

| Command | Purpose |
|---|---|
| `connections_list` | Returns `Connection[]`; never includes secrets. |
| `connections_save` | Upsert. Accepts `{ connection, secrets: { slot: string }[] }` so secrets travel separately from the connection payload. Writes row + keychain in one logical op. |
| `connections_delete` | Deletes row + purges all `conn:<id>:*` keychain entries. |
| `connections_test` *(NEW)* | Resolves secrets, builds client, runs `ping`, tears down. Returns `{ ok: true, serverInfo }` or `{ ok: false, stage, error }` where `stage ∈ 'ssh' \| 'tls' \| 'auth' \| 'ping'`. |
| `connections_connect` | Existing; now routes through `builder.rs` and returns the same staged-error shape on failure. |
| `prefs_get` / `prefs_set` *(NEW)* | Global IntelliShell/Tools/Advanced. |
| `prefs_resolve_effective` *(NEW)* | Given a `connectionId`, returns merged `EffectivePrefs`. UI uses this to render "Use global: <value>" hints. |

### Migration

`migration.rs` runs once on app start, gated by a `schema_version` row in
SQLite.

For each old row:

- `connString` present → `target: { kind: 'uri', uri: connString }`,
  `auth: { kind: 'none' }` (URI carries credentials).
- `connString` absent, `username` present → `target: { kind: 'direct', host, port }`,
  `auth: { kind: 'scram', username, authDb: authDb ?? 'admin', mechanism: 'auto' }`.
  Password is re-keyed in Keychain from the old slot to
  `conn:<id>:auth-password`.
- `connString` absent, `username` absent → `auth: { kind: 'none' }`.
- `sshHost` present → `ssh: { host, port, user, auth: { kind: 'key', keyPath,
  hasPassphrase: false }, knownHostsPolicy: 'add-and-trust' }`. `'add-and-trust'`
  is chosen so existing connections keep working — the old code did not
  enforce host-key checking, and promoting to `'strict'` on migration would
  break users. **New connections default to `'strict'`.**
- `tls`, `proxy`, `overrides` → omitted.

Migration writes new rows to a `connections_v2` table and leaves the old
`connections` table untouched. Both tables coexist through Phases 1–3:

- **Old dialog** continues to read/write `connections` (flat shape).
- **New dialog** reads/writes `connections_v2` (tagged-union shape).
- A one-way sync runs on every save in the old dialog, re-running the
  migrator for that single row so `connections_v2` stays current. Saves in
  the new dialog do **not** sync back to the old table — once a connection
  has been touched by the new dialog, it is "new-only." A flag column
  `migrated_back: false` on `connections` lets the old dialog detect and
  hide rows that have diverged.

In Phase 4, the old `connections` table is renamed to
`connections_v1_backup` and `connections_v2` is renamed to `connections`.
The backup table is dropped one release after Phase 4.

### Error surfacing

The staged-error contract (`stage` + `error`) from `connections_test`
propagates through `connections_connect` too. The existing
`ConnectionErrorDialog` renders `stage` as a heading ("SSH tunnel failed",
"TLS handshake failed", "Authentication failed", "Server ping failed") with
the raw driver error below.

---

## Testing Strategy

### TS-side unit tests (Vitest)

- `connection/model.test.ts` — round-trip every variant through
  `JSON.stringify` ↔ `parse`. Snapshot fixtures shared with Rust tests.
- `connection/validation.test.ts` — invariants: URI mode rejects direct
  fields; SCRAM requires username; X.509 requires certFile; SSH key mode
  requires keyPath; "save disabled with errors"; etc. Pure functions.
- `connection/overrides.test.ts` — `resolveEffective(global, overrides)`
  per-field merge: undefined-means-inherit, false ≠ undefined,
  nested object override behavior.
- `connection/migration.test.ts` — fixture-driven: every historical flat-row
  shape (URI-only, host+auth, host+SSH-key, no-auth, edge cases like missing
  `authDb`) → exact `connections_v2` output. Includes a "round-trip then
  re-migrate is a no-op" check.
- `ConnectionDialog.test.tsx` — tab switching, "Use global" toggles,
  validation summary aggregation, Test button calls `connections_test`,
  error surfacing renders `stage`.

### Rust unit tests

- `connection::model` — serde round-trip on the **same fixtures** the TS
  tests use (`tests/fixtures/connection/*.json`). Contract test that
  catches TS/Rust drift.
- `connection::secrets` — keychain key derivation is pure; the keychain
  backend is mocked behind a trait.
- `connection::builder` — given resolved `Connection` + `EffectivePrefs`,
  assert produced `ClientOptions` (TLS config, compressors, timeouts, appName).
  No network.
- `connection::migration` — load each fixture flat row, run migrator,
  assert new row + keychain re-key calls.

### Integration tests (opt-in)

- `tests/integration/connection_test_command.rs` — testcontainers `mongod`
  for SCRAM, no-auth, and TLS. Skipped by default; enabled in CI via
  `INTEGRATION=1`.
- SSH-tunnel, Kerberos, LDAP, AWS IAM, OIDC integration tests are **out of
  scope** — they need external infra.

### Manual QA checklist

For modes that cannot be auto-tested:

- Connect to MongoDB Atlas (SCRAM-SHA-256 + TLS).
- Connect via SSH tunnel with each of password / key / agent.
- Connect with HTTP proxy in front of `mongod`.
- Run migration over a copy of a real user's `data.db`; verify all
  connections still work post-migration and that secrets resolved cleanly
  from the re-keyed Keychain entries.

---

## Rollout

1. **Phase 1 — Backend, dark.** Land `connection/` + `prefs/` modules and
   IPC commands behind a feature flag (`CONN_V2=1` env). Old dialog still
   ships. Migration runs and populates `connections_v2`; the old
   `connections` table stays untouched and remains the source of truth for
   the old dialog. Saves through the old dialog re-migrate the affected row
   into `connections_v2`. Nothing in the running UI reads `connections_v2`
   yet — this phase validates migration correctness against real user data
   without UX risk.
2. **Phase 2 — UI, opt-in.** Ship the new tabbed dialog behind a Settings
   toggle ("Use new connection dialog — beta"). Default off. The new dialog
   reads/writes `connections_v2`; the old dialog continues on `connections`
   with row-level sync into `connections_v2` on save (per the Migration
   section). Once a connection is saved through the new dialog, it is
   "new-only" and hidden from the old dialog.
3. **Phase 3 — Default on.** Flip the toggle's default to on. Old dialog
   remains available via Settings for one release as a fallback.
4. **Phase 4 — Remove old dialog.** Delete the old dialog, drop the toggle,
   rename `connections → connections_v1_backup` and `connections_v2 →
   connections`. One release later, drop `connections_v1_backup`.

Each phase is a separate PR. Phase 1 is the largest (model + serde +
migration + builder + tests). Phases 2–4 are mostly deletions of the old
path.

---

## Open Questions

None at spec-write time. All scope-defining questions were resolved during
brainstorming:

- Auth modes: Studio 3T parity (8 modes).
- MongoDB Tools: structure-only, no consuming feature yet.
- Migration: auto-migrate, lossless.
- SSH auth: password + key (with passphrase) + agent.
- Override granularity: per-field.

---

## Extension Contract

New auth mode:

1. Add a variant to `AuthMode` in `src/types.ts` and the Rust mirror in
   `connection/model.rs`.
2. Implement the variant's branch in `connection/builder.rs` (translate to
   `ClientOptions` auth config).
3. Add a sub-form component under `ConnectionDialog/auth/<kind>/Form.tsx`;
   register it in `ConnectionDialog/auth/registry.ts`.
4. Add validation rules to `connection/validation.ts`.
5. Add fixtures to `tests/fixtures/connection/auth-<kind>-*.json`.

No other file needs to change. UI dispatch and Rust dispatch both key off
`auth.kind` via registry lookup.
