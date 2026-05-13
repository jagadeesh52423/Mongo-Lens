# DataFleet Plugin — Design Spec

**Date:** 2026-05-13
**Status:** Draft
**Type:** Plugin + small host extension

## 1. Goal

Let a Mongo Lens user request temporary MongoDB credentials through the internal DataFleet portal and apply the fetched password to an existing Mongo Lens connection — all without leaving the app or copy-pasting credentials. Built as the first dogfood plugin against the plugin system landed in `2026-05-12-plugin-system-design.md`.

## 2. Scope

**In.**
- Full DataFleet lifecycle: Submit Request (SR), Fetch Password (GP), Attach to Connection.
- Persisting pending requests across app restarts.
- Storing LDAP username + password in SecretStorage.
- Updating an existing connection's password through a new host API.

**Out (explicitly).**
- Auto-renewal of expired sessions — the user takes that call.
- Postgres apps — Mongo Lens does not manage Postgres connections.
- Persisting fetched passwords to disk — passwords live in memory until attached or dismissed.
- A separate "history of attached passwords" log — the existing plugin audit log covers it.
- Creating new connections — the plugin only updates existing ones.

## 3. Architecture

Two repos, deployed independently.

**Repo A — Mongo Lens host (this repo).** Adds one new plugin API namespace (`mongolens.connections`) and one new permission scope kind (`connections`). No UI changes in the host; no changes to existing plugins.

**Repo B — `mongolens-plugin-datafleet` (standalone).** A folder with `manifest.json` + bundled JS. Distributed as a zip/folder; users install via the existing "Install from folder" flow in Settings → Plugins. No npm registry, no build pipeline required (a one-line bundler step is optional if the author wants TypeScript).

The plugin runs in the existing webview sandbox with scrubbed globals; it cannot reach Tauri APIs or the DOM outside its registered view.

## 4. Host changes (Repo A)

### 4.1 New `mongolens.connections` namespace

Add to `src/plugins/api/contracts.ts`:

```ts
export interface ConnectionRef {
  id: string;
  name: string;
  host?: string;
  port?: number;
  username?: string;
}

export interface ConnectionsApi {
  list(): Promise<ConnectionRef[]>;
  updateCredentials(id: string, creds: { password: string }): Promise<void>;
}

export interface Mongolens {
  // ...existing members
  connections: ConnectionsApi;
}
```

Notes:
- `ConnectionRef` deliberately omits `connString`, `authDb`, and SSH fields. Plugins do not need them, and exposing connection strings would leak embedded passwords.
- `updateCredentials` is write-only — there is no `getPassword`. The asymmetry matches the existing `Connection` record, which never carries the password.
- Both methods are `async` to match the rest of the API and to allow backend round-trips.

### 4.2 New permission scope `connections:write`

Extend `KNOWN_SCOPE_KINDS` in `src/plugins/permissions.ts` with `"connections"`. `parseScope("connections:write")` returns `{ kind: "connections", verb: "write" }`. `matchesScope` for `connections` is exact-match on verb (no globs, no resource).

Both `connections.list()` and `connections.updateCredentials(...)` require `connections:write`. Reading the connection list is considered sensitive metadata (names, hosts, usernames) and is gated by the same scope, on the principle that plugins which read the list almost always intend to write somewhere.

### 4.3 Wiring in `createMongolens.ts`

```ts
connections: {
  async list() {
    permissions.check(pluginId, "connections:write");
    const conns = await services.connections.list(); // existing IPC adapter
    return conns.map(stripToConnectionRef);          // drop connString, authDb, ssh*
  },
  async updateCredentials(id, { password }) {
    permissions.check(pluginId, "connections:write");
    if (typeof password !== "string" || password.length === 0) {
      throw new TypeError("updateCredentials requires a non-empty password");
    }
    await services.connections.updateCredentials(id, password);
    audit.emit({ pluginId, action: "connections.updateCredentials", target: id });
  },
}
```

The host-side `services.connections.updateCredentials(id, password)` adapter calls the existing `updateConnection(id, { password })` IPC — no Rust-side changes are needed; the IPC already accepts a password-only patch.

### 4.4 Audit logging

Every `updateCredentials` call emits an entry on the existing `PermissionBroker.onAudit` stream so the user can see "datafleet wrote password for connection `staging-mongo`" once the plugin console (Part 2 backlog) ships. The audit entry carries: `pluginId`, `action`, `targetConnectionId`, `targetConnectionName`, `timestamp`. No password content.

## 5. Plugin (Repo B)

### 5.1 Folder layout

```
mongolens-plugin-datafleet/
├── manifest.json
├── dist/extension.js
└── src/
    ├── extension.ts
    ├── api/datafleetClient.ts
    ├── store/requestStore.ts
    ├── store/credsStore.ts
    ├── ui/RequestsView.tsx
    ├── ui/NewRequestForm.tsx
    └── ui/AttachConnectionPicker.tsx
```

Boundary rationale:
- `datafleetClient` is the only module that knows the portal wire format. When DataFleet's API drifts, exactly one file changes.
- `requestStore` and `credsStore` are pure CRUD over `mongolens.workspace`/`mongolens.secrets`. The UI never touches storage directly.
- UI components are dumb: props in, callbacks out. `extension.ts` is the composition root.

### 5.2 `PortalClient` interface (extension point)

```ts
// implement this interface to swap the portal backend (tests, future portals)
export interface PortalClient {
  submitRequest(args: SubmitRequestArgs): Promise<SubmitRequestResult>;
  fetchPassword(args: FetchPasswordArgs): Promise<FetchPasswordResult>;
}
```

`datafleetClient` is the default implementation. Tests use an in-memory fake.

### 5.3 Manifest

```json
{
  "id": "datafleet",
  "name": "DataFleet",
  "version": "0.1.0",
  "engines": { "mongolens": "^1.0.0" },
  "main": "dist/extension.js",
  "activationEvents": ["onView:datafleet.requests"],
  "permissions": [
    "network:fetch:https://o7yd4zabrg.execute-api.ap-south-1.amazonaws.com/*",
    "connections:write",
    "secrets:read",
    "secrets:write",
    "workspace:read",
    "workspace:write"
  ],
  "contributes": {
    "views": [
      { "id": "datafleet.requests", "title": "DataFleet" }
    ],
    "commands": [
      { "id": "datafleet.newRequest",        "title": "DataFleet: New Request" },
      { "id": "datafleet.fetchPassword",     "title": "DataFleet: Fetch Password" },
      { "id": "datafleet.attachToConnection","title": "DataFleet: Attach Password to Connection" }
    ]
  }
}
```

Activation: lazy. The plugin loads only when the user opens the DataFleet panel.

### 5.4 Persisted state

| Key | Backing store | Shape | Notes |
|---|---|---|---|
| `datafleet/requests` | `mongolens.workspace` | `Array<{ id, purpose, apps, linked_ticket, status, createdAt }>` | `id` = Jira ticket. No passwords, no usernames. |
| `datafleet/ldap`     | `mongolens.secrets`   | `{ username, password }` | SecretStorage; today in-memory, Keychain-backed when Part 2 lands. |

Fetched passwords are **never** persisted. They live on the request row in React state until the user attaches them to a connection or dismisses them.

## 6. Data flows

### 6.1 New Request (SR)

1. User clicks **+ New Request** in the panel → `NewRequestForm` opens.
2. Fields: `purpose` (RM-Checkout / Tech-Support / Prod-Issue), `linked_ticket` (text), `apps` (multi-select over `los, lms, eve, e2live, ffr`).
3. Read LDAP creds from `credsStore`; if missing, inline prompt; save to SecretStorage on submit.
4. `datafleetClient.submitRequest({ purpose, linked_ticket, mongoApps, username, password })` POSTs `{ source: "SR", username, password, purpose, linked_ticket, application: { mongo: "<csv>" } }`.
5. On `AUTH SUCCESS`: append `{ id: jira_ticket, purpose, apps, linked_ticket, status: "pending", createdAt }` to `requestStore`. Panel list updates.
6. On any other status (`LINKED TICKET NOT VALID`, `ACCESS ALREADY EXISTS`, `TS-NA`, auth failure): inline error; do not persist.

### 6.2 Fetch Password (GP)

1. User clicks a pending request row → **Fetch Password** button enables.
2. On click: read creds (prompt if missing), `datafleetClient.fetchPassword(reqId)` POSTs `{ source: "GP", username, password, reqId }`.
3. On `REQ APPROVED`: password held on the row in React state. Row state flips to `ready`, showing **Connect Password** and **Copy** buttons.
4. On `REQ NOT APPROVED`: row stays `pending`, inline "Not yet approved" hint.
5. On `REQ REJECTED` / `REQ EXPIRED` / `ACCESS ALREADY EXISTS`: row goes terminal (`rejected` / `expired` / `already_exists`), greyed out, **Dismiss** available.
6. On auth failure: clear cached creds, re-prompt.

### 6.3 Connect Password (attach)

1. User clicks **Connect Password** on a `ready` row → `AttachConnectionPicker` opens inside the panel.
2. Picker calls `mongolens.connections.list()`, renders `name`, `host:port`, `username`, filterable.
3. User selects a connection → confirmation prompt: "Update password for `<name>` (`<host:port>`)? This cannot be undone."
4. On confirm: `mongolens.connections.updateCredentials(id, { password })`. Audit log entry fires.
5. On success: toast "Password updated for `<name>`". Row password cleared from memory. Row state → `used` (still visible, can refetch if needed).

## 7. Error handling

| Failure | Where caught | User-visible behaviour |
|---|---|---|
| Portal returns an error status enum | `datafleetClient` throws typed `PortalError` | Inline message in form / on row; no toast |
| Network failure or non-2xx | `datafleetClient` throws `PortalNetworkError` | Row shows "Network error" + Retry |
| `PermissionDeniedError` from `connections.updateCredentials` | `extension.ts` top-level handler | Toast: "DataFleet needs the `connections:write` permission. Enable it in Plugins → DataFleet." |
| Connection deleted between picker render and confirm | `updateCredentials` rejects (not-found) | Toast: "Connection no longer exists." Picker re-fetches list. |
| Corrupt entries in `requestStore` on load | `requestStore.load()` validates with a zod schema; drops corrupt entries, logs each | Panel still loads cleanly |
| Malformed JSON in SecretStorage | `credsStore.load()` treats as missing | User is re-prompted; old value discarded |

## 8. Testing

### 8.1 Plugin (Repo B)

**Unit.**
- `datafleetClient` against an in-memory `fetch` mock covering every documented status string for SR and GP.
- `requestStore` against an in-memory `mongolens.workspace` fake — round-trip, schema validation on load, corrupt-entry drop.
- `credsStore` against an in-memory `mongolens.secrets` fake — round-trip, missing-key handling, malformed-JSON handling.

**Component (Vitest + Testing Library, stub `mongolens`).**
- `RequestsView`: state transitions `pending → ready → used → dismissed` render correctly.
- `NewRequestForm`: validation, submit success, every SR error status mapping.
- `AttachConnectionPicker`: list rendering from `mongolens.connections.list()`; confirm flow invokes `updateCredentials`; password never appears in the DOM after attach.

**Manual smoke.** Install the folder via Settings → Plugins → Install from folder; run a full SR → GP → Attach against the real portal once before each release.

### 8.2 Host (Repo A)

**Unit.**
- `connections.list()` strips `connString`, `authDb`, and SSH fields from records.
- `connections.updateCredentials()` enforces `connections:write` and emits an audit entry; rejects empty password; rejects when permission denied.
- `parseScope("connections:write")` returns the correct shape; unknown verbs (`connections:foo`) reject.

## 9. File layout

### 9.1 Repo A (this repo) — changes

| File | Change |
|---|---|
| `src/plugins/api/contracts.ts` | Add `ConnectionRef`, `ConnectionsApi`; extend `Mongolens` |
| `src/plugins/permissions.ts` | Add `"connections"` to `KNOWN_SCOPE_KINDS`; verb-only matcher |
| `src/plugins/api/createMongolens.ts` | Wire `connections` namespace with permission checks + audit |
| `src/plugins/hostServices.ts` | Add `connections` service: `list()` → `listConnections` IPC; `updateCredentials(id, pwd)` → `updateConnection(id, { password: pwd })` IPC. Also surface `secrets` and `workspace` namespaces (using existing `InMemorySecretStorage`; new in-memory `WorkspaceStore`). |
| `src/plugins/api/__tests__/connections.test.ts` | New unit tests for the namespace |
| `src/plugins/__tests__/permissions.test.ts` | Extend with `connections:write` cases |

### 9.2 Repo B (`mongolens-plugin-datafleet`) — new

See §5.1 for the full layout.

## 10. Risks

- **Portal API drift.** No OpenAPI schema; field names and status enums were reverse-engineered. Mitigation: isolated `datafleetClient` and a typed `PortalError` make string changes a one-file fix.
- **SecretStorage backend is in-memory today.** Saved LDAP creds will not survive an app restart until the Keychain backend (Part 2 backlog) lands. Plugin behaves correctly in both worlds — it just re-prompts more often today. Surfaced to the user via inline hint in the LDAP prompt.
- **Permission scope creep.** `connections:write` covers both `list` and `updateCredentials`. If a future use case needs a read-only list without write authority, the scope must be split into `connections:read` and `connections:write`. Called out so the next plugin author doesn't add a second namespace for it.
- **Race between picker render and attach.** Connection can be deleted in the host between `list()` and `updateCredentials()`. Already covered in §7.
- **Permission grain on `secrets`/`workspace`.** Today's host scopes are coarse (`secrets:read`, `secrets:write`, `workspace:read`, `workspace:write`). The plugin gets access to *all* of its own secrets and workspace data, not just `datafleet/*`. Per-prefix scoping is deferred. Each plugin already has a sandboxed key namespace (via `namespaceFor(pluginId, key)`), so this is a small risk increase but worth noting.

## 11. Out-of-spec follow-ups

These are explicitly *not* in this plan and live in the existing Part 2 backlog of the plugin system:
- Plugin console panel (which the audit log feeds into).
- Keychain-backed `SecretStorage`.
- `@mongolens/plugin-api` types package and scaffolder — the DataFleet plugin will ship without npm types in its first version; the manifest contributions are typed locally.
