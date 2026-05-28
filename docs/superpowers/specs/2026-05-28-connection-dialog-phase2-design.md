# Connection Dialog — Phase 2

**Date:** 2026-05-28
**Status:** Draft — awaiting user review
**Predecessor:** `docs/superpowers/specs/2026-05-28-connection-model-redesign-design.md` (Phase 1)
**Phase 1 PR:** merged to `main` as 2967d38, tagged `conn-v2-phase1`

## Background & Motivation

Phase 1 landed the new connection model end-to-end on the backend: tagged
unions, store, secrets, builder, migration, prefs, IPC commands — all
behind the `CONN_V2=1` env gate. Zero UI changes shipped. The current
`ConnectionDialog.tsx` still presents the legacy flat shape with the
"Connection String overrides above" footgun and no representation of
TLS, proxy, X.509, LDAP, Kerberos, AWS-IAM, OIDC, per-connection
overrides, or env tagging.

Phase 2 ships the UI that consumes the Phase 1 backend. Because this is
a single-user app, the spec's originally planned three-phase rollout
(beta toggle → default-on → remove old dialog) is consolidated into
**one phase**: drop the old dialog, drop the `CONN_V2` gate, ship the
new tabbed dialog as the dialog. The new code reads/writes
`connections_v2` exclusively; the legacy `connections` table is renamed
to `connections_v1_backup` and dropped one release later.

## Goals

- Replace `ConnectionDialog.tsx` with a tabbed dialog representing
  every concern in the new model: Server, Auth, TLS, SSH, Proxy,
  IntelliShell, Tools, Advanced.
- Surface env color tagging in both the dialog header and the
  `ConnectionTree`.
- Make per-connection overrides editable for IntelliShell / Tools /
  Advanced, with globals shown read-only inline.
- Add a **Test Connection** button that calls `connections_v2_test`
  with the live form values and renders staged errors
  (`ssh` / `tls` / `auth` / `ping`).
- Preserve the SSH challenge-response flow (`PassphraseRequired`,
  `HostKeyUnknown`) — reuse existing `PassphraseDialog` and
  `HostKeyDialog`.
- Cut over cleanly: drop the legacy IPC, drop the env gate, rename
  the SQLite table, remove the old dialog files in the same release.

## Non-Goals

- **Globals editor.** Globals are read-only inline in this phase
  (the dialog shows `Use global: <value>` and lets users override
  per-connection). Editing globals requires a separate Settings →
  Preferences page; deferred to a follow-up.
- **Prod-write guard banner** + confirm-on-write behavior. The color
  field is wired through; the guard itself is a follow-up.
- **Connection groups / folders** in the tree.
- **MongoDB Tools consumers** (mongodump/restore/export/import
  integration). Override fields exist; no feature consumes them.
- **OIDC interactive auth flow UI.** Backend handles the driver path;
  the AuthTab only collects principal / providerName configuration.
- **Settings toggle** for new-vs-old dialog. Single user, single
  replacement — no fallback path.

---

## Component Architecture

### File layout

```
src/components/features/connections/dialog-v2/
├── ConnectionDialogV2.tsx          ← Shell: header, sidebar, footer; renders active tab via registry
├── ConnectionDialogV2.module.css
├── useDialogState.ts               ← Reducer: form state, dirty tracking, validation aggregation
├── tabs/
│   ├── registry.ts                 ← Array of TabSpec; one entry per tab
│   ├── types.ts                    ← TabSpec, ValidationIssue (re-exports)
│   ├── ServerTab.tsx
│   ├── AuthTab.tsx                 ← Internal sub-registry per auth.kind (8 sub-forms)
│   ├── TlsTab.tsx
│   ├── SshTab.tsx                  ← Internal sub-registry per ssh.auth.kind (3 sub-forms)
│   ├── ProxyTab.tsx
│   ├── IntelliShellTab.tsx
│   ├── ToolsTab.tsx
│   ├── AdvancedTab.tsx
│   └── shared/
│       ├── OverrideRow.tsx         ← "Use global: <value>" + override input. Used by 3 prefs tabs.
│       ├── FilePicker.tsx          ← Wrapper around tauri-plugin-dialog for cert/key paths.
│       └── ColorPicker.tsx         ← Header color tag dropdown.
└── __tests__/
    ├── ConnectionDialogV2.test.tsx
    ├── useDialogState.test.ts
    └── tabs/*.test.tsx
src/components/features/connections/
├── ConnectionTree.tsx              ← Modified: reads from useConnectionsV2, renders color stripe
└── useConnectionsV2.ts             ← Zustand-bound IPC wrapper
```

### Files removed

- `src/components/features/connections/ConnectionDialog.tsx` (old flat dialog)
- `src/components/features/connections/ConnectionDialog.module.css`
- `src/components/features/connections/__tests__/ConnectionDialog.test.tsx`
- `src/store/connections.ts` (legacy zustand store using `list_connections` IPC)
- `src-tauri/src/commands/connection.rs` — legacy IPC commands
  (`list_connections`, `create_connection`, `update_connection`,
  `delete_connection`, `test_connection`, `connect_connection`,
  `disconnect_connection`). Functionality migrates entirely to
  `connection_v2.rs` (which gains `connect` / `disconnect`).

### Files kept (reused unchanged)

- `PassphraseDialog.tsx` — used in the SSH connect flow when
  `ssh.auth.kind === 'key'` with `hasPassphrase: true` and the user
  hasn't pre-filled.
- `HostKeyDialog.tsx` — used when `knownHostsPolicy === 'strict'` and
  the host key is unknown.
- `ConnectionErrorDialog.tsx` — already renders the staged-error
  contract (`stage` + `error`).

### Plugin pattern: TabSpec

```ts
export interface TabSpec {
  id: 'server' | 'auth' | 'tls' | 'ssh' | 'proxy' | 'intelliShell' | 'tools' | 'advanced';
  label: string;
  group: 'transport' | 'prefs';        // controls sidebar divider position
  Form: React.ComponentType<TabFormProps>;
  validate: (value: Connection) => ValidationIssue[];
  hasOverrides?: (value: Connection) => boolean;   // prefs tabs only — drives "● override set" badge
}

export interface TabFormProps {
  value: Connection;
  onChange: (next: Connection) => void;
  globals: GlobalPrefs;                // resolved once on dialog mount via prefs_get
  secrets: Partial<Record<SecretSlot, string>>;
  onSecretChange: (slot: SecretSlot, value: string) => void;
}
```

**Extension contract** (documented in `tabs/registry.ts`): add a new
tab by creating `tabs/MyTab.tsx` exporting a `TabSpec`, then adding one
line to the registry array. No edits elsewhere.

### Layout (vertical tabs, sidebar)

Per user choice during brainstorming:

```
┌────────────────────────────────────────────────────────────────────┐
│ Name: [____________________]  Color: [● prod ▾]            [Test]  │
├────────────┬───────────────────────────────────────────────────────┤
│ Server     │                                                       │
│ Auth ●     │   (active tab content)                                │
│ TLS        │                                                       │
│ SSH        │                                                       │
│ Proxy      │                                                       │
│ ─────      │                                                       │
│ IntelliShl │                                                       │
│ Tools      │                                                       │
│ Advanced ●│                                                       │
├────────────┴───────────────────────────────────────────────────────┤
│ ⚠ 2 issues across tabs (click to jump)   [Cancel] [Test] [Save]   │
└────────────────────────────────────────────────────────────────────┘
```

- Red dot on a tab label: validation error in that tab.
- Filled dot on a prefs tab label: at least one field is overridden
  vs the global.
- Dashed divider between transport tabs (Server/Auth/TLS/SSH/Proxy)
  and prefs tabs (IntelliShell/Tools/Advanced).

---

## State Shape & IPC Wiring

### Local dialog state

```ts
type DialogState = {
  draft: Connection;
  initial: Connection | null;
  secrets: Partial<Record<SecretSlot, string>>;
  testResult:
    | null
    | { kind: 'pending' }
    | { kind: 'ok'; serverInfo: unknown }
    | { kind: 'fail'; stage: BuildStage; error: string };
  globals: GlobalPrefs;
};

type DialogAction =
  | { type: 'set-field'; path: string; value: unknown }
  | { type: 'set-auth-kind'; kind: AuthMode['kind'] }
  | { type: 'set-target-kind'; kind: 'uri' | 'direct' }
  | { type: 'set-secret'; slot: SecretSlot; value: string }
  | { type: 'test-start' }
  | { type: 'test-result'; result: TestResultV2 };
```

State is scoped per dialog instance (not global Zustand). One modal,
one connection at a time.

### Validation flow

`validate(draft)` runs on every `draft` change via `useMemo`, using
the pure functions from `src/connection/validation.ts` (already
shipped in Phase 1). Aggregated `ValidationIssue[]` is partitioned per
tab via each `TabSpec.validate`. Sidebar reads the partitioned result
to render badges; footer aggregates across all tabs.

- **Save** is disabled while any issue exists.
- **Test** is disabled while any issue exists.

### Secrets handling

Secrets are write-only fields in the dialog:

- On mount for an existing connection: **no secrets are pulled from
  the store.** Password fields render with placeholder
  `(stored in Keychain — leave blank to keep)`.
- An explicit `[Remove]` icon next to each secret field lets the user
  clear the slot.
- On save, the IPC payload is `{ connection: draft, secrets: SecretInput[] }`
  where `secrets[]` contains only slots the user typed into. Blank
  fields = no change. Removal via `[Remove]` sends `{ slot, value: '' }`
  which the backend interprets as delete.

This matches the existing `commands/connection_v2.rs::SaveInput`
contract from Phase 1.

### useConnectionsV2 store

```ts
interface ConnectionsV2Store {
  connections: Connection[];
  loading: boolean;
  refresh: () => Promise<void>;
  save: (input: SaveInput) => Promise<Connection>;
  remove: (id: string) => Promise<void>;
  test: (input: SaveInput) => Promise<TestResultV2>;
}
```

Single source of truth for the connection list across the tree, the
dialog, and the editor's context bar. Replaces the legacy
`src/store/connections.ts`.

### connect_v2 / disconnect_v2 IPC

The legacy `connect_connection` returns `Connected` |
`PassphraseRequired { connection_id }` |
`HostKeyUnknown { connection_id, fingerprint, … }` for the SSH
challenge-response flow. **This shape is preserved verbatim** in the
new `connections_v2_connect` command — same outcomes, same retry
semantics. `PassphraseDialog` and `HostKeyDialog` continue to handle
the UX.

On successful connect, secrets received during the retry (passphrase,
accept-host-key) are persisted via `secrets::set` so subsequent
connects don't re-prompt.

### ConnectionTree changes

- Reads from `useConnectionsV2.connections`.
- Each row renders the env `color` as a 3px left stripe + a small dot.
- Context-menu items (Edit / Duplicate / Delete) route through the
  v2 dialog.
- Database / collection sub-tree under each connection is unchanged
  (driven by a live `mongodb::Client`, not by the connection record).

### Migration & rename

Phase 1 already populates `connections_v2` lazily (gated on `CONN_V2`).
Phase 2 flips the gate to default-on and renames:

- One-time migration on first app start with the Phase 2 build:
  `migrate_all` runs unconditionally, idempotent.
- After the migration, atomic rename: `connections` →
  `connections_v1_backup`; `connections_v2` → `connections`. Rust code
  is updated to point at the renamed table.
- `connections_v1_backup` is kept for one release as a safety net,
  then dropped in a tiny follow-up.

---

## Testing Strategy

### Per-tab tests (Vitest + Testing Library)

One file per tab in `dialog-v2/tabs/__tests__/`. Common assertions:

- **ServerTab** — radio toggle wipes the other side after confirm;
  Direct fields update `draft.target`; URI scheme validation surfaces.
- **AuthTab** — auth-kind dropdown swaps the sub-form; switching from
  SCRAM to X.509 zeros incompatible fields; password placeholder on
  edit reads `(stored in Keychain — leave blank to keep)`.
- **TlsTab** — toggle reveals nested fields; CA / client-cert file
  pickers populate paths; `allowInvalidCerts` warning banner appears.
- **SshTab** — toggle reveals nested fields; auth-method radio swaps
  sub-form; key mode reveals passphrase checkbox; known-hosts dropdown.
- **ProxyTab** — toggle + type radio + host/port; UI rejects
  HTTP/SOCKS4 with a "SOCKS5 only" hint.
- **IntelliShellTab / ToolsTab / AdvancedTab** — `OverrideRow` per
  field shows `Use global: <value>` when override is `undefined`;
  "Override" input sets the value; "Reset" returns to `undefined`; tab
  badge appears when any field is overridden.

### Shell tests

`dialog-v2/__tests__/ConnectionDialogV2.test.tsx`:

- Tab switching, badges, validation summary aggregation,
  dirty-tracking, save-disabled-on-errors.
- Test button calls `connections_v2_test` with current
  `(draft, secrets)`; staged-error result renders in footer with the
  stage as a heading.
- Save flow builds `SaveInput`, calls `connections_v2_save`, fires
  `useConnectionsV2.refresh()`, closes.
- Cancel with dirty changes prompts confirm.

### Reducer tests

`useDialogState.test.ts` — pure reducer; covers every action shape
including `set-auth-kind` clearing stale fields and `set-target-kind`
wiping the other side iff confirmed.

### Tree + flow integration test

`__tests__/ConnectionTree.connection-v2.test.tsx`:

- Renders the tree with mocked `useConnectionsV2`.
- Asserts color stripe present per row.
- Context menu routes through the v2 dialog.

### Shared component tests

- `OverrideRow.test.tsx` — `false ≠ undefined`, arrays replace
  wholesale, "Reset to global" sets `undefined`.
- `ColorPicker.test.tsx` — selecting a swatch sets `draft.color`;
  "no color" clears it.
- `FilePicker.test.tsx` — mocks `tauri-plugin-dialog`; asserts the
  path returned by the open-file dialog populates the field.

### Rust IPC tests (additions)

The existing `commands::connection_v2::*` tests already cover
`save/delete/test`. Phase 2 adds to `src-tauri/tests/integration_connection.rs`:

- `connect_v2_success_returns_connected` — full happy path with a
  no-auth container.
- `connect_v2_passphrase_required_when_key_encrypted` — preserves
  challenge-response shape.
- `connect_v2_host_key_unknown_on_strict_policy` — same, host-key
  path.

### Manual QA

- Migration run-once: verify legacy connections appear with their
  secrets intact and the new dialog opens them correctly.
- All 8 tabs render, validate, save.
- Color picker → tree stripe end-to-end.
- Test button against a real cluster, then SSH-tunneled cluster.

---

## Rollout

Single phase, 5 PRs landing in sequence on `main`. PRs 1–4 build the
new dialog code without wiring it into the UI — the legacy dialog
remains the default. The new dialog is reachable only via a
development-only escape hatch (env var `DIALOG_V2=1` or a URL
parameter `?dialog=v2`) so each PR can be sanity-checked end-to-end
on a real cluster before the cut-over. PR 5 is the cut-over: it
removes the escape hatch, deletes the old dialog, and renames the
table.

1. **PR 1 — Shell + state + ServerTab + ConnectionTree color stripe.**
   New dialog renders behind the dev escape hatch. ConnectionTree
   begins reading from `useConnectionsV2` (read path is safe to flip
   early — same data either way after migration). Color stripe ships
   in the tree. Old dialog still handles all user-facing edits.
2. **PR 2 — Transport tabs: AuthTab + TlsTab + SshTab + ProxyTab.**
   PassphraseDialog + HostKeyDialog reused from Phase 1. Still behind
   the escape hatch.
3. **PR 3 — Prefs tabs: IntelliShellTab + ToolsTab + AdvancedTab +
   OverrideRow + globals load.** Read-only globals shown inline.
   Still behind the escape hatch.
4. **PR 4 — Test button + staged-error rendering in footer +
   ConnectionErrorDialog wired to v2 connect.** All 8 tabs now
   functional behind the escape hatch. Manually verify against a real
   cluster before PR 5.
5. **PR 5 — Cut-over.** Wire the new dialog in as the default for
   Add / Edit / Duplicate flows. Delete the old `ConnectionDialog.tsx`
   and its CSS / tests. Delete `src/store/connections.ts`. Delete
   legacy IPC commands (`list_connections`, `create_connection`,
   `update_connection`, `delete_connection`, `test_connection`,
   `connect_connection`, `disconnect_connection`) from
   `src-tauri/src/commands/connection.rs`. Atomic SQLite rename
   (`connections` → `connections_v1_backup`,
   `connections_v2` → `connections`). Drop the `CONN_V2` env gate.
   Drop the `DIALOG_V2` escape hatch. Repoint Rust callers at the
   renamed table. **Smallest of the five but most consequential** —
   kept separate so a regression is easy to revert.
6. **Follow-up (one release later) — drop `connections_v1_backup`
   table.** Trivial.

---

## Open Questions

None at spec-write time. All scope-defining questions resolved during
brainstorming:

- 8 tabs ship together.
- Test button in Phase 2.
- Read-only globals inline; globals editor deferred.
- Color picker + tree stripe ship in Phase 2.
- Single replacement (no Settings toggle, no `CONN_V2` gate).
- Vertical tabs / sidebar layout (Studio 3T-style).

---

## Extension Contract

New connection-related tab:

1. Create `src/components/features/connections/dialog-v2/tabs/MyTab.tsx`
   exporting a `TabSpec`.
2. Add one line to `tabs/registry.ts`.
3. If the tab introduces new persisted fields, add them to
   `src/connection/model.ts` and the Rust mirror in
   `src-tauri/src/connection/model.rs`; round-trip a new fixture
   under `tests/fixtures/connection/`.

No other file needs to change. Tab dispatch and validation aggregation
both key off `TabSpec.id` via registry lookup.

New auth mode in the AuthTab (the AuthMode union itself is in the
model): add a sub-form component under `tabs/auth/<kind>/Form.tsx` and
register it in `tabs/auth/registry.ts`. Same pattern as the dialog-tab
registry, scoped to AuthTab's internal dispatch.
