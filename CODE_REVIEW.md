# Code Review — Plugin System Host (Part 1)

Branch: `worktree-plugin-system-host` — 26 commits (`main..HEAD`).
Reviewer: reviewer-plugins.
Plan: `docs/superpowers/plans/2026-05-12-plugin-system-host.md`.
Spec: `docs/superpowers/specs/2026-05-12-plugin-system-design.md`.

Baseline at review start: `npx vitest run` → 325/325 PASS; `npx tsc --noEmit` → clean; working tree clean.

---

## Stage 1 — Spec/Plan compliance

### Commit ↔ task mapping

All 25 planned commits are present except **Task 18** ("production loader via blob-URL dynamic import with test fallback") — its functionality was folded into the Task 17 commit (`6a83a4e`). `defaultLoader` in `PluginManager.ts:213-224` already contains the `URL.createObjectURL`/`Blob` production branch + jsdom CJS fallback exactly as Task 18 described, and the production blob-URL path is exercised by `loadPluginModule` (`src/plugins/sandbox/moduleLoader.ts:46-55` — `URL.revokeObjectURL` correctly in a `finally`). The plan dictated a separate commit; behaviour is identical. **Acceptable deviation**, flagged only for the commit-count audit.

The trailing `chore(plugins): final sweep — fix window cast and test handler types` (`3ba6288`) is allowed by the plan's "final commit if anything in the manual sweep required tweaks" step.

### Per-task verification

| Task | Files / signatures | Tests | Notes |
|---|---|---|---|
| 0 ajv + skeleton | `package.json:21` `ajv@^8.20.0`; `src/plugins/index.ts` empty barrel ✓ | — | ✓ |
| 1 Disposable | `src/plugins/api/disposable.ts` — `Disposable`, `toDisposable`, `DisposableStore` ✓ | 3 PASS | Minor: `toDisposable(fn: () => unknown)` widened from the plan's `() => void \| Promise<void>`. No functional impact. |
| 2 Registry<T> | `src/plugins/Registry.ts` — register/get/list/onDidChange/disposeForPlugin ✓ | 5 PASS | ✓ |
| 3 Permissions | `src/plugins/permissions.ts` — KNOWN_SCOPE_KINDS, parseScope, matchesScope ✓; vocabulary identical to spec §3 ✓ | 6 PASS | Implementation uses `GLOB_PLACEHOLDER = 'xwildcardx'` (lowercase) rather than plan's `'WILDCARD'` — this is a **bug fix**: `new URL()` lower-cases hostnames so the uppercase placeholder would not round-trip. Good catch. |
| 4 Manifest schema | `src/plugins/schema/manifest.schema.json` + `src/plugins/manifest.ts` ✓; schema regex covers exact v1 scope vocabulary ✓ | 5 PASS | ✓ |
| 5 PermissionBroker | `src/plugins/PermissionBroker.ts` — setGrants/getGrants/clearGrants/check/onAudit; `PermissionDeniedError` exported ✓ | 3 PASS | ✓ |
| 6 Logger adapter | `src/plugins/api/logger.ts` ✓ | 1 PASS | ✓ |
| 7 SecretStorage | `src/plugins/api/secretStorage.ts` — interface, `InMemorySecretStorage`, `namespaceFor` ✓ | 2 PASS | ✓ |
| 8 Sandbox wrapper | `src/plugins/sandbox/runInPluginSandbox.ts` — result discriminated union, onError, timeoutMs ✓ | 4 PASS | ✓ |
| 9 Module loader | `src/plugins/sandbox/moduleLoader.ts` — `wrapPluginSource`, `loadPluginModule` (blob URL + `URL.revokeObjectURL` in `finally`) ✓ | 2 PASS | ✓ |
| 10 Contracts | `src/plugins/api/contracts.ts` ✓ | — | ✓ |
| 11 Registry set | `src/plugins/registries.ts` — all 9 registries + `disposeAllForPlugin` ✓ | 2 PASS | ✓ |
| 12 Migrate built-in modes | `src/execution-modes/registry.ts` now wraps `Registry<ExecutionMode>` ✓ | Existing suite green | ✓ |
| 13 hostServices | `src/plugins/hostServices.ts` — db/net gated through broker ✓ | 3 PASS | ✓ |
| 14 mongolens facade | `src/plugins/api/createMongolens.ts` — mirrors registry set; `db`/`net` from `HostServices` ✓ | 5 PASS | Spec §4 also lists `workspace.*` snapshots, `onDidChange*` listeners, and `ui.*` methods — **not implemented**. Plan never tasks them; plan self-review §4 explicitly only claims Tasks 1/10/14/15. Acceptable per plan, flagged as Part 2 follow-up. |
| 15 ExtensionContext | `src/plugins/ExtensionContext.ts` ✓ | 1 PASS | ✓ |
| 16 discover | `src/plugins/PluginManager.ts` `discover`/`loadOne` ✓; `satisfies('^X.Y.Z')` ✓; states `discovered`/`broken`/`incompatible` ✓ | 3 PASS | ✓ |
| 17 activate/deactivate | `PluginManager.activate`/`deactivate` ✓; uses `runInPluginSandbox` with 10s/2s timeouts ✓; clears grants + `disposeAllForPlugin` on failure/deactivate ✓ | 3 PASS | The plan placed `globalThis.mongolens = api` inside the try-with-finally **after** the module load; implementation moves it **before** the module load (see comment at `PluginManager.ts:111-121`). The comment correctly explains why — the CJS test-path `new Function(...)` captures `globalThis.mongolens` at construction time. Acceptable, well-commented deviation. |
| 18 production loader | Folded into Task 17 commit — see "Commit ↔ task mapping" above. |
| 19 activation events | `activateForEvent`, `activateStartup` ✓ | 3 PASS | ✓ |
| 20 install/uninstall + Tauri FS | `PluginManager.install`/`uninstall` ✓; `PluginFs.copyDir?`/`removeDir?` added in `src/plugins/io.ts` ✓; `src/plugins/io.tauri.ts` created ✓ | 3 PASS | ✓ |
| 21 PermissionConsentDialog | `src/plugins/ui/PermissionConsentDialog.tsx` ✓ | 3 PASS | Component built but **not wired into the install path** — `activate()` parses scopes directly from `manifest.permissions` (`PluginManager.ts:99-101`). Plan self-review §6 explicitly defers grant-persistence wiring to Part 2. ✓ per plan. |
| 22 Plugins settings pane + wire | `src/plugins/ui/PluginsSettingsPane.tsx` ✓; wired via `src/settings/sections/PluginsSection.tsx` → `register({id:'plugins',...})`; side-effect imported in `src/settings/SettingsView.tsx:7` ✓ | 3 PASS (pane) + 1 PASS (section smoke) | One **overbuild**: `src/__tests__/plugins-section.test.tsx` isn't in the plan. Functional and useful; flagged as a NIT in Stage 2. |
| 23 host singleton + hook + App wiring | `src/plugins/host.ts`, `src/plugins/usePluginManager.ts`, App.tsx useEffect at `src/App.tsx:142-167` ✓; `(window as ...).__pluginHost = host` ✓ | 1 PASS | App wiring wraps the entire bootstrap in `try { ... } catch {}` — sensible for jsdom but masks real Tauri errors. See I-2. |
| 24 integration test | `src/__tests__/plugins-integration.test.ts` ✓ | 1 PASS | ✓ |
| 25 author doc | `docs/plugins/authoring.md` (84 lines) ✓ | — | ✓ |

### Type-consistency checks

- `Registry<T>` shape identical at every call site (registries.ts, Registry.ts, execution-modes/registry.ts). ✓
- `Disposable` returned from every `register(...)` (Registry.register, every `mongolens.<x>.register` in createMongolens.ts). ✓
- `PluginRecord.state` enum (`discovered|incompatible|broken|activating|active|failed|disabled`) consistent across PluginManager and PluginsSettingsPane. ✓
- `ManagerOptions` fields accrue across Tasks 16/17/20/23 in the expected order, all present in the final file. ✓
- `PluginFs` base type unchanged in Tasks 16/17/19/23; `copyDir?`/`removeDir?` added optionally in Task 20. ✓
- `mongolens` API surface mirrors the registry set (`commands`, `views`, `resultViewers`, `executionModes`, `aiTools`, `connectionProviders`, `themes`, `exportTargets`) plus `db`/`net`. `keybindings` is intentionally manifest-only per the plan's contributes-vs-runtime split. ✓

### Spec §3, §6, §7 spot-check

- **§3 vocabulary** — `KNOWN_SCOPE_KINDS` in `permissions.ts:1-6` lists exactly the seven kinds. Schema regex in `manifest.schema.json:13` matches the same vocabulary. ✓
- **§6 lifecycle** — `activateForEvent` filters by `manifest.activationEvents.includes(event)` (`PluginManager.ts:166-173`); `deactivate` runs sandbox-wrapped `deactivate()` (2s budget) → iterates `ctx.subscriptions` LIFO → `disposeAllForPlugin(registries, id)` → clears grants → sets state `disabled` (`PluginManager.ts:140-163`). ✓
- **§7 trust model** — `hostServices.db.find` calls `broker.check({kind:'database:read'})` (`hostServices.ts:18`); `hostServices.net.fetch` calls `broker.check({kind:'network:fetch', arg:url})` (`hostServices.ts:24`); `plugins-host-services.test.ts` covers deny, allow, and URL-glob mismatch. ✓

### Stage 1 verdict

**Stage 1 PASSES.** No compliance gaps requiring `coder-core` to fix. Two minor deviations were noted, both already justified (Task 18 commit merge; scope-glob placeholder casing). Spec §4's `workspace.*` / `ui.*` surface is unimplemented but the plan's self-review claims only partial §4 coverage — acceptable for Part 1.

---

## Stage 2 — Code quality

(Standards: `~/.claude/skills/code-standards/SKILL.md` — Java/Vert.x-targeted; generic principles BP-105/113/117/119 plus the project's CLAUDE.md OCP / extensibility-first rules apply. Project uses strict TypeScript + React.)

### BLOCKER
*None.*

### IMPORTANT

**I-1. `mongolens.commands.execute` bypasses `runInPluginSandbox`.**
File: `src/plugins/api/createMongolens.ts:34-39`.
```ts
async execute(id, ...args) {
  const cmd = r.commands.get(id);
  if (!cmd) throw new Error(`Unknown command "${id}"`);
  return cmd.handler(...args);   // ← not wrapped
}
```
Spec §7 (Error isolation): "Every host→plugin call (activate, **command handler**, viewer render, listener, AI tool invoke) is wrapped in `runInPluginSandbox(pluginId, ...)`." A plugin command handler that throws will propagate to whatever host code (or other plugin) invoked `commands.execute`, defeating the isolation guarantee. Fix: wrap the call. The owning `pluginId` is stored on the registry entry (`Registry.ts:8` — currently private). Either expose `Registry.getOwner(id)` or have the executor look it up.

**I-2. App.tsx swallows every bootstrap error.**
File: `src/App.tsx:162-164`.
```ts
} catch {
  // Tauri APIs unavailable (test environment or early startup failure).
}
```
Catching everything to handle the jsdom case means a real Tauri-side failure (corrupt installed plugin folder, FS permission error, broken plugin during discover) silently disappears. Narrow the catch: detect missing-Tauri explicitly (e.g., guard on `'__TAURI_INTERNALS__' in window` before the dynamic imports), or at minimum `console.error(e)` so a developer sees it in devtools.

**I-3. `globalThis.mongolens` is a shared global between concurrent activations.**
File: `src/plugins/PluginManager.ts:108-121`.
Activation writes `globalThis.mongolens = api` and deletes it in `finally`. `activateForEvent` serializes today, but `activate(id)` is public and parallel callers would race — both plugins would see the *last* writer's `mongolens` binding, registering things on the wrong owner. Spec §4 says each plugin gets its own binding. Cheap v1 fix: assert single-flight by throwing if `globalThis.mongolens` is already set, OR funnel through an internal serialization queue.

### NIT

**N-1.** `src/__tests__/plugins-section.test.tsx` added during final sweep, not in the plan. Useful as a no-host fallback smoke test for the side-effect registration. Keep it — just acknowledged as overbuild.

**N-2.** `Registry.disposeForPlugin` mutates `this.entries` during `for ... of this.entries` (`Registry.ts:39-44`). JS Map iteration with current-key deletion is well-defined and works, but linters frequently flag it; consider collecting keys first.

**N-3.** `usePluginRecords` (`src/plugins/usePluginManager.ts:7-12`) subscribes only to registry change events. A plugin transitioning `discovered → broken` or `discovered → failed` without registering anything will not refresh the Plugins pane. For Part 1's discover/install/activate flow it works because registry mutations accompany state changes; the gap appears on failures. Either expose a `PluginManager.onDidChange` event or trigger an explicit refresh after `install`/`activate`/`deactivate`.

**N-4.** `wrapPluginSource` declares `let globalThis = undefined`. Best-effort hardening only — `(0, eval)('this')`, `Function('return this')()`, or a `new Function(...)` body still reach the real globalThis. Spec §10 acknowledges this, but a brief code comment near `SCRUBBED_GLOBALS` calling it out as "best-effort hardening, not a sandbox" would prevent a future maintainer from mistaking it for a security boundary.

**N-5.** `PluginsSettingsPane.tsx` renders Enable / Uninstall buttons for `broken` and `incompatible` records. Clicking Enable routes to `manager.activate(id)` which returns early at `PluginManager.ts:91-94` because `rec.manifest` is undefined for broken records — user gets a silent no-op. Either disable the button when `state ∈ {broken, incompatible}` or surface the early-return as an error.

**N-6.** `InMemorySecretStorage` is instantiated fresh on every `activate()` call (`PluginManager.ts:103`). Secrets written during one activation are discarded on deactivate/reactivate. Plan Task 7 acknowledged this as a v1 stub; worth a TODO comment at that exact line so it isn't forgotten when Keychain wiring lands in Part 2.

**N-7.** `PluginManager.ts:236` re-exports `Registry`. Nothing in the worktree imports `Registry` from `PluginManager`. Vestigial — drop it, or leave a one-line "(re-exported for public surface)" comment.

**N-8.** `defaultBackend()` (`PluginManager.ts:225-230`) throws "Host backend not wired (test stub)". App.tsx never passes `hostBackend`, so in production any `mongolens.db.find` / `mongolens.net.fetch` will throw this exact message until Part 2. Worth a `logger.warn('hostBackend not wired')` in `activate()` when `this.opts.hostBackend === undefined`, so the failure is observable rather than only surfacing inside a plugin's first DB call.

### Code-standards skill — new pattern observed

No new generic pattern recurred enough to justify a new `/code-standards` rule. The TS-specific issues (I-1, I-3) are narrow to two files. I will NOT append to the Java-focused code-standards skill.

---

## Final notes

- Tests: 325/325 PASS in full-suite mode (`npx vitest run`).
- Types: `npx tsc --noEmit` is clean.
- Build: not re-run by this review; expected clean given tsc + tests are clean.

The implementation is faithful to the plan. The three IMPORTANT items are real but constrained to v1 — I-1 (sandbox wrap on `commands.execute`) directly contradicts a spec invariant and is the one I most want fixed; I-2 (App.tsx catch) is a one-line improvement; I-3 (global injection race) can wait if I-1 is addressed and `activate()` is documented as not-concurrent-safe.

---

## Stage 3 — Iteration verification

Commit `53a0055` ("fix(plugins): review I-1/I-2/I-3 — sandbox execute(), Tauri guard, concurrent-activate assertion") from `coder-core` addresses all three IMPORTANTs. Verified by reading the diff and re-running the suite:

- **I-1 verified.** `Registry.getOwner(id)` added at `Registry.ts:28-31`. `createMongolens` now accepts optional `logger?: Logger` (`createMongolens.ts:32`). `execute()` resolves `ownerId = r.commands.getOwner(id) ?? pluginId` and wraps `cmd.handler(...args)` in `runInPluginSandbox(ownerId, ..., { onError: logger.error, timeoutMs: 5_000 })`, rethrowing on `!result.ok` so callers still observe failures (`createMongolens.ts:41-50`). `PluginManager` threads `logger: this.opts.logger` into `createMongolens` (`PluginManager.ts:109`). Spec §7 invariant now holds for command-handler dispatch.
- **I-2 verified.** `App.tsx:148` short-circuits with `if (!('__TAURI_INTERNALS__' in window)) return;` before any dynamic import; `catch (e)` now calls `console.error('Plugin host bootstrap failed', e)` (`App.tsx:165`). Real Tauri-side failures are now observable in devtools.
- **I-3 verified.** `PluginManager.ts:112-115` asserts `if ('mongolens' in globalThis) throw new Error(...)` at the top of the sandbox block, failing fast on concurrent activations.

**Post-fix baseline:** `npx vitest run` → 325/325 PASS · `npx tsc --noEmit` → 0 errors. No regressions from the original 325-green baseline.

NITs N-1 through N-8 remain as FYI; none required for this review to converge.

---

## Verdict: APPROVED

---

# Code Review — DataFleet Plugin (Part 2)

Branch: `worktree-plugin-system-host` — 9 commits since baseline `3d202b6`.
Reviewer: reviewer-plugins.
Spec: `docs/superpowers/specs/2026-05-13-datafleet-plugin-design.md`.
Plan: `docs/superpowers/plans/2026-05-13-datafleet-plugin.md`.

Baseline at review start: `npx tsc --noEmit` → clean; host `npx vitest run` → 343/343 PASS; `cd plugin-packages/datafleet && npx vitest run` → 25/25 PASS.

---

## Stage 1 — Spec compliance

### Host (Repo A — §4)

| Section | File | Verdict |
|---|---|---|
| §4.1 `ConnectionRef`/`ConnectionsApi` | `src/plugins/api/contracts.ts:79-90` | ✓ Exactly the documented shape. Omits `connString`/`authDb`/`ssh*` as required. |
| §4.1 `Mongolens.connections` member | `src/plugins/api/createMongolens.ts:26-27,66` | ✓ Wired (also `secrets`/`workspace` per spec §4.4 note). |
| §4.2 `connections:write` scope kind | `src/plugins/permissions.ts:6` | ✓ Added to `KNOWN_SCOPE_KINDS`. `parseScope("connections:write")` returns `{ kind: 'connections:write' }`. `connections:read` correctly rejected. Verb-only `matchesScope` works via the existing arg-less branch. **Cosmetic deviation:** spec text said `{ kind: 'connections', verb: 'write' }` — implementation keeps the host's actual convention (one flat string per kind, same as `database:read`, `secrets:write`). The spec text was wrong about the existing pattern; the chosen shape is more consistent. NIT only. |
| §4.3 permission check + audit | `src/plugins/hostServices.ts:54-67`, `createMongolens.ts:66` | ✓ Permission check + audit live in `hostServices.ts` rather than `createMongolens.ts` as the spec drew; functionally equivalent. Empty-password rejection (`TypeError('non-empty')`) present. |
| §4.4 audit log entry | `src/plugins/hostServices.ts:65` | **NIT (N-4):** spec says audit carries `targetConnectionName`. Implementation only emits `target: id`. No password in entry ✓. |

Host backend wiring (`src/App.tsx:155-179`):
- `connectionsList` strips full `Connection` records to the documented `ConnectionRef` shape ✓.
- `connectionsUpdateCredentials` reads the existing connection, destructures `id`+`createdAt` out, spreads the rest plus `password` into `updateConnection`. This **preserves all other connection fields** (host/port/authDb/connString/ssh*) which the spec required. The spec's claim that the IPC "accepts a password-only patch" was wrong — `ConnectionInput.name` is required in `src/types.ts:17`, so a password-only object wouldn't compile. The merge approach is the correct fix. ✓
- Throws "Connection not found" on the deleted-between-list-and-update race ✓ (caught by picker for inline error).

### Plugin (Repo B — §5–§8)

§5.1 Folder layout — ✓ `plugin-packages/datafleet/{manifest.json, package.json, src/{extension.ts, api/{datafleetClient.ts, types.ts}, store/{credsStore.ts, requestStore.ts}, ui/{RequestsView.tsx, NewRequestForm.tsx, AttachConnectionPicker.tsx}}}`.

§5.2 `PortalClient` interface — ✓ `src/api/types.ts:22-25` with the required `// implement this interface to add a new portal backend` comment per project CLAUDE.md OCP rule.

§5.3 Manifest — ✓ `plugin-packages/datafleet/manifest.json`. Permission strings parse against the host schema; `connections:write`, `secrets:read|write`, `workspace:read|write`, exact-URL `network:fetch` glob. Activation events lazy on `onView:datafleet.requests` ✓. Three commands contributed ✓. `views[0].location: 'sidebar'` added beyond what the spec literally wrote — needed by the host's `ViewProvider` contract. ✓.

§5.4 Persisted state — ✓
- `requestStore` writes the documented shape `{id, purpose, apps, linkedTicket, status, createdAt}` to workspace key `requests` (host adds the `plugin:datafleet:` namespace). No passwords. No usernames.
- `credsStore` writes `{username, password}` JSON to secret key `ldap`.
- **Fetched passwords are never persisted** — verified at `RequestsView.tsx`: `rowState` (React state) is the only holder; on `used` the new state object drops the `password` field (line 90). The `AttachConnectionPicker` test "does not render the password in the DOM" passes ✓.

§6.1 SR flow — ✓ `NewRequestForm` → `portal.submitRequest` → `requestStore.add` → list refresh.

§6.2 GP flow — Spec lists six branches; implementation `RequestsView.tsx:64-79` covers only three:

| Spec branch | Handled? |
|---|---|
| `REQ APPROVED` → row `ready` with in-memory password | ✓ |
| `REQ NOT APPROVED` → row stays pending + inline "Not yet approved" hint | **✗ silently no-ops (I-1)** |
| `REQ REJECTED` → row `rejected` | ✓ |
| `REQ EXPIRED` → row `expired` | ✓ |
| `ACCESS ALREADY EXISTS` → row `already_exists` | ✓ |
| Auth failure → clear cached creds, re-prompt | **✗ silently no-ops (I-2)** |

§6.3 Attach flow — ✓ Picker → confirmation prompt with `Update password for <name> (<host:port>)? This cannot be undone.` → `attach()` → row → `used`. Row password cleared from state.

§7 Error handling — three of six rows have gaps:

| Failure | Spec behaviour | Implementation |
|---|---|---|
| Portal error status | inline message on form/row | ✓ (form), partial (row — only some statuses) |
| Network failure / non-2xx | "Network error" + Retry | **✗ no try/catch around `portal.submit`/`fetch` — `PortalNetworkError` propagates unhandled (I-3)** |
| `PermissionDeniedError` from `updateCredentials` | top-level toast: "DataFleet needs the `connections:write` permission…" | Inline error in picker only; no top-level handler in `extension.ts`. NIT N-5. |
| Deleted-connection race | picker re-fetches list | Inline error, no re-fetch. NIT N-6. |
| Corrupt `requestStore` entries | drop with log; panel still loads | ✓ `requestStore.list()` drops corrupt rows; no log emitted (NIT N-7). |
| Malformed JSON in SecretStorage | treat as missing; re-prompt | ✓ `credsStore.load()` returns `undefined`. |

§8 Testing — coverage is good but not exhaustive against the spec:
- `datafleetClient` covers every documented SR + GP status ✓.
- `requestStore` covers round-trip, corrupt drop, non-JSON ✓.
- `credsStore` covers round-trip, malformed JSON, wrong shape ✓.
- `RequestsView` covers pending → ready → used ✓; does **not** cover `rejected`/`expired`/`already_exists`/`REQ_NOT_APPROVED`/auth-failure transitions. NIT N-8.
- `NewRequestForm` covers validation + one error display; not "every SR error status mapping" the spec asks for. NIT N-9.
- `AttachConnectionPicker` covers list render, confirm flow, password not in DOM, attach failure surfaced inline ✓.

---

## Stage 2 — Code quality

(Standards: project CLAUDE.md OCP/extensibility-first, plus generic best-practice review.)

### IMPORTANT

**I-1. REQ NOT APPROVED silently no-ops.**
File: `plugin-packages/datafleet/src/ui/RequestsView.tsx:64-79` (`fetchPassword`).
```ts
const terminalMap: Record<string, RequestStatus> = {
  REQ_REJECTED: 'rejected', REQ_EXPIRED: 'expired', ACCESS_EXISTS: 'already_exists',
};
const term = terminalMap[res.reason];
if (term) { setRowState(...); await props.updateStatus(id, term); }
```
`REQ_NOT_APPROVED` is not in the map. The `!res.ok` branch falls through without any UI feedback — the user clicks **Fetch Password**, nothing visibly happens, and there is no way to discover that the request was simply not approved yet. Spec §6.2 step 4 requires an inline "Not yet approved" hint while the row stays `pending`. Fix: surface `REQ_NOT_APPROVED` as a non-terminal status message on the row (e.g. `setRowState(s => ({ ...s, [id]: { status: 'pending', note: 'Not yet approved' } }))` and render `note` in the list).

**I-2. AUTH_FAILED never clears creds or re-prompts.**
File: `plugin-packages/datafleet/src/ui/RequestsView.tsx:64-79` (same callback) and `onSubmit` at 49-62.
Spec §6.2 step 6: "On auth failure: clear cached creds, re-prompt." The reason `AUTH_FAILED` is returned by both `submitRequest` and `fetchPassword`; today it falls through with no `credsStore.clear()` call and no re-prompt. Bad creds get baked in and every subsequent retry fails the same way. Fix: on `res.reason === 'AUTH_FAILED'`, call `credsStore.clear()` (expose via a prop) and re-invoke `ensureCreds()` so the user can correct them.

**I-3. Portal exceptions propagate unhandled.**
File: `plugin-packages/datafleet/src/ui/RequestsView.tsx:49-62` (`onSubmit`) and `64-79` (`fetchPassword`).
`portal.submitRequest`/`fetchPassword` `await`s are not wrapped in try/catch. `datafleetClient` throws `PortalNetworkError` on non-2xx (`datafleetClient.ts:31, 56`). When the portal returns 5xx/timeouts, the exception escapes the async callback, the React state never updates, and the user sees no error — only that the **Submit** / **Fetch Password** button silently did nothing. Spec §7: "Row shows 'Network error' + Retry." Fix: wrap each portal call in try/catch and surface the failure via `setSubmitError` (for SR) or a new row-level `error` field (for GP) with a Retry affordance.

### NIT

**N-4.** `src/plugins/hostServices.ts:65` audit entry omits `targetConnectionName` (spec §4.4 requires both id and name). Add the name lookup in the backend adapter and pass it through `audit.target` / a new `meta.name` field. Today the audit is only consumed by tests; cosmetic but spec-explicit.

**N-5.** `plugin-packages/datafleet/src/extension.ts` has no top-level error handler for `PermissionDeniedError`. Spec §7 wants a toast at extension top-level; today the only place a `PermissionDeniedError` can surface is the picker's inline error.

**N-6.** `AttachConnectionPicker.tsx:35-43` shows the deleted-connection error inline but does not refresh the connection list — spec §7 row "Connection deleted between picker render and confirm" says "Picker re-fetches list."

**N-7.** `requestStore.list()` (`store/requestStore.ts:28-40`) drops corrupt entries silently. Spec §7: "drops corrupt entries, **logs each**." No logger wired; consider injecting one or wiring through `mongolens.logger` once it exists.

**N-8.** `RequestsView.test.tsx` covers pending → ready → used. Add cases for `rejected`/`expired`/`already_exists` row rendering once I-1/I-2 add the corresponding state transitions and inline-hint slot.

**N-9.** `NewRequestForm.test.tsx` only renders a single error string. Spec §8.1: "every SR error status mapping" — at minimum loop the four reasons (`AUTH_FAILED`, `LINKED_TICKET_INVALID`, `ACCESS_EXISTS`, `TS_NA`).

**N-10.** `RequestsView.tsx` redeclares `ConnectionRef` (line 7-9) locally rather than importing it from a shared types module. The picker (`AttachConnectionPicker.tsx:3-5`) does the same. The plugin currently has no `@mongolens/plugin-api` package (per spec §11 follow-up), so this is expected, but worth keeping in one local module.

**N-11.** `RequestsView.tsx`'s attach callback (line 88-92) closes over `selectedId` via the React captured value. If a user managed to change `selectedId` mid-attach (UI doesn't expose this today, but defensible), the `updateStatus(selectedId, 'used')` would fire against the new row. Capture `selectedId` into a local `const` at the top of the picker render branch (line 84) for safety.

**N-12.** `RequestsView.tsx:99-118` renders the request list without any keyboard-accessible row selection state — clicking the row toggles `selectedId` but there's no aria/role markup. Plain functional; nothing the spec mandates.

**N-13.** `extension.ts:47-49` registers three commands whose handlers are empty stubs (`/* opened from view button */`). Either remove the registrations or implement the commands so they wire to the view. Spec §5.3 declares the commands as user-facing entry points; today only the view button opens them.

---

## Verification matrix

| Check | Result |
|---|---|
| `ConnectionRef` does NOT carry `connString`/`authDb`/`ssh*` | ✓ `contracts.ts:79-85` |
| `App.tsx` `updateCredentials` preserves other connection fields | ✓ `App.tsx:174-176` (spread + override) |
| `audit` log contains no password | ✓ `hostServices.ts:65` only `target: id` |
| Plugin DOM does not leak fetched password | ✓ `AttachConnectionPicker.test.tsx` "does not render the password in the DOM" |
| `RequestsView` fetched passwords NOT in workspace storage | ✓ `RequestsView.tsx` holds in `rowState` only; `requestStore` schema has no password field |
| `matchesScope` for `connections:write` | ✓ verb-only match via no-arg branch; tests in `plugins-permissions.test.ts:45-61` |
| `hostServices.ts` signature change propagated cleanly | ✓ `npx tsc --noEmit` clean |
| Host suite green | ✓ 343/343 |
| Plugin suite green | ✓ 25/25 |

---

## Routing

- I-1, I-2, I-3 → coder-plugin (all in `plugin-packages/datafleet/src/ui/RequestsView.tsx`).
- N-4 → host (kept as NIT; not blocking).
- N-5..N-13 → plugin (kept as NITs; not blocking).

---

## Stage 3 — Iteration verification (Part 2)

coder-plugin addressed I-1, I-2, I-3 (and opportunistically N-11). Verified by reading the diff and re-running suites:

- **I-1 verified.** `RowState` now has `note?: string` (`RequestsView.tsx:16`). On `REQ_NOT_APPROVED` (line 103-106): sets `{status:'pending', note:'Not yet approved'}`. The row renders `<span role="status">{rs.note}</span>` (line 159) and the **Fetch Password** button stays enabled for the still-pending row.
- **I-2 verified.** New `clearCreds: () => Promise<void>` prop on `RequestsView` (`RequestsView.tsx:26`), wired in `extension.ts:39` as `() => creds.clear()`. SR `AUTH_FAILED` (line 63-67): `await props.clearCreds()`, sets `setSubmitError('Authentication failed — credentials cleared. Please try again.')`. GP `AUTH_FAILED` (line 108-112): same `clearCreds()`, row gets a `note` with the same message. Next retry goes through `ensureCreds()`; the store is empty so the prompt re-opens.
- **I-3 verified.** Both `onSubmit` (line 59-86) and `fetchPassword` (line 95-127) wrap the portal call in try/catch. `PortalNetworkError` is detected with `instanceof` and surfaced as `Network error (HTTP <status>)`; other throws stringified. `onSubmit` surfaces via `setSubmitError`; `fetchPassword` writes to `rowState[id].error` which renders `<span role="alert">` + a **Retry** button (line 160-165).
- **N-11 verified.** Picker branch (line 132-148) captures `selectedId` into `const capturedId` before constructing the attach callback; the async callback closes over `capturedId`, not the live state value.

**Post-fix baseline:** plugin `npx vitest run` → 30/30 PASS (8 in `RequestsView.test.tsx` — 3 original + 5 new branches); plugin `npx tsc --noEmit` → clean. Host suite unchanged at 343/343 PASS (only plugin files changed).

NITs N-4, N-5–N-10, N-12, N-13 remain as deferred FYI for the next iteration.

---

## Verdict: APPROVED

---

# Code Review — Plugin Activity Bar (Part 3)

Branch: `worktree-plugin-system-host` — 16 commits since `e792783` (`git log --oneline e792783..HEAD`).
Reviewer: reviewer-activity-bar.
Spec: `docs/superpowers/specs/2026-05-13-plugin-activity-bar-design.md`.
Plan: `docs/superpowers/plans/2026-05-13-plugin-activity-bar.md`.

Baseline at review start: `npx vitest run` → 379/379 PASS · `npx tsc --noEmit` → clean (host build).

---

## Stage 1 — Spec compliance

### §2 plugin-agnostic invariant

- `grep -rIn -i 'datafleet\|data-fleet' src/` returns hits only in test files (`src/__tests__/plugin-agnostic-host.test.ts` test fixtures themselves, `src/plugins/api/__tests__/connections.test.ts`, `src/plugins/api/__tests__/workspaceStore.test.ts`, `src/layout/__tests__/activityBar.test.ts`). **Zero hits in non-test src/.** ✓
- The invariant test (`src/__tests__/plugin-agnostic-host.test.ts`) uses Vitest's `import.meta.glob` (in-process scan) rather than the plan's `execSync('grep ...')`. Functionally equivalent and **strictly better** — no subprocess, no extra @types/node coupling. ✓
- It filters out `__tests__` paths and checks each forbidden term as its own `it.each` case. Passes 3/3.
- **NIT N-1:** test globs `.ts` and `.tsx` only; the plan's Task-16 grep command included `--include='*.json'` to catch plugin ids in manifest snippets or fixtures. No JSON in `src/` currently references a plugin id (`find src -name '*.json' | xargs grep -l 'datafleet'` → none), but a future regression could slip through. Add `'/src/**/*.json'` to the glob.

### §4 ActivityRegistry contract (`src/layout/activityBar.ts`)

- `ActivityItem` shape exactly matches spec §4.1 (id, title, icon, render → {dispose}). ✓
- `ActivityRegistry` has `list()` + `onDidChange(cb): Disposable`. ✓
- `BuiltInActivityRegistry`: `add(item)` rejects duplicate ids, appends in insertion order, fires `onDidChange` listeners on add, listeners catch their own throws (`/* never throw */`). ✓
- `PluginActivityRegistry`: filters `location: 'sidebar'` ✓. Icon priority — `v.icon && v.icon.length > 0` → use it; else `title[0]?.toUpperCase() ?? '?'`. Combined with the createMongolens injection (Task 8, see §6), the full priority is **register-call icon → manifest icon → title[0]**, matching spec §4.2 exactly. ✓
- `CompositeActivityRegistry`: `list()` via `flatMap` ✓; `onDidChange` registers on every child and `dispose()` iterates `subs` and disposes each ✓.

### §5 IconRail / SidePanel

- `IconRail` props: `items`, `activeId`, `onChange`, `onSettingsOpen`, `settingsOpen` — exact match. Renders logo top, settings bottom. Border-left accent when `!settingsOpen && activeId === it.id`. ✓
- `SidePanel` props: `{ item: ActivityItem | null }` — exact match. Body is a `<div ref>`; `useEffect` keyed on `item?.id` calls `item.render(bodyRef.current)`, returns cleanup that disposes; catches throws into `setError`; empty placeholder when `item === null`; alert div with the error message when render threw. ✓
- **No `PanelKey` reference anywhere in `src/`.** Verified with `grep -rn 'PanelKey' src/` → zero matches. ✓

### §6 ViewProvider.icon + manifest schema

- `ViewProvider.icon?: string` added in `src/plugins/api/contracts.ts`. ✓
- `manifest.schema.json` view contribution: `"icon": { "type": "string", "maxLength": 4 }`, `additionalProperties: false`, `icon` not in required list. Length-5 strings reject; emoji & 1–4 char ASCII accept (per `plugins-manifest.test.ts`). ✓
- `createMongolens.views.register`: when caller omits `v.icon`, host injects `manifestIconFor(v.id)` from `params.manifest.contributes.views[]`. `PluginManager.activate` threads `manifest: rec.manifest` into the call (`PluginManager.ts:111`). Combined with `PluginActivityRegistry`'s `title[0]` fallback, the full priority chain matches spec §6.2. ✓

### §7 Persistence

- `SettingsState.activeActivityItemId: string | null` + setter added (`store/settings.ts:52,59`). ✓
- `PersistedSettings.activeActivityItemId` added; `toPersisted()` includes it; setter writes through to disk. ✓
- Initial state defaults to `null`. ✓
- Hydration line 169: `activeActivityItemId: loaded?.activeActivityItemId ?? null` — older settings files without the key load cleanly as `null`. ✓ (no migration needed per spec §11 risk note).
- `resolveActiveId(items, persistedId)` returns persistedId when present in items, else `items[0]?.id ?? null`. ✓

### §8 Lifecycle & error handling

- Plugin add → registry fires → `pluginSub`/`topSub` callbacks call `setItems(composite.list())` → IconRail re-renders. (One render cycle, modulo the duplicate-subscription smell flagged below.) ✓
- Plugin remove → `disposeForPlugin` fires onDidChange → setItems re-runs → `resolveActiveId` no longer finds the persisted id, returns first item. ✓
- Render throw → caught in SidePanel's effect, alert renders with message. ✓
- Empty registry → SidePanel renders `data-testid="side-panel-empty"`. ✓
- Integration coverage in `src/__tests__/App.activity-bar.test.tsx` is **registry-level**, not App-level — it asserts on `comp.list()` / `resolveActiveId` directly. The App-level coverage lives in `src/__tests__/layout.test.tsx` (App renders, two built-in icons appear, clicking Saved Scripts toggles the side-panel title). Together they cover the spec scenarios. Acceptable, flagged as N-2.

### File map compliance

Every Create/Modify in §9.1 is present:

| File | Action | Status |
|---|---|---|
| `src/layout/activityBar.ts` | Create | ✓ |
| `src/layout/__tests__/activityBar.test.ts` | Create | ✓ (17 cases) |
| `src/components/layout/IconRail.tsx` | Rewrite | ✓ |
| `src/components/layout/SidePanel.tsx` | Rewrite | ✓ |
| `src/App.tsx` | Modify | ✓ |
| `src/plugins/api/contracts.ts` | Modify | ✓ |
| `src/plugins/schema/manifest.schema.json` | Modify | ✓ |
| `src/plugins/PluginManager.ts` | Modify | ✓ (threads `manifest` into createMongolens) |
| `src/store/settings.ts` | Modify | ✓ |
| `src/__tests__/IconRail.test.tsx` | Create | ✓ (4 cases) |
| `src/__tests__/SidePanel.test.tsx` | Create | ✓ (5 cases) |
| `src/__tests__/App.activity-bar.test.tsx` | Create | ✓ (3 cases) |
| `src/__tests__/plugin-agnostic-host.test.ts` | Create | ✓ (3 cases) |

`git diff e792783..HEAD --stat` confirms each modified file actually changed.

### Stage 1 verdict

**Stage 1 PASSES.** All spec sections are satisfied. The grep invariant holds. Icon priority chain is correct end-to-end. Persistence migration is safe. No spec compliance gaps requiring routing back to coder.

---

## Stage 2 — Code quality

(Standards: project CLAUDE.md OCP / extensibility-first; React 18 effect/render rules; TS strict.)

### IMPORTANT (must fix before merge)

**I-1. React root unmount during render — `root.unmount()` is called synchronously from `SidePanel`'s effect cleanup.**
File: `src/App.tsx:39-62` (`makeBuiltInRegistry`).

```ts
render: (container) => {
  const root = createRoot(container);
  root.render(createElement(ConnectionPanel));
  return { dispose() { root.unmount(); } };   // ← sync unmount
},
```

When the user clicks a different activity icon, `SidePanel`'s `useEffect` cleanup runs synchronously (React 18 effect-cleanup phase) and invokes `disposable.dispose()` → `root.unmount()`. React logs the warning currently visible in `vitest run` output:

> Warning: Attempted to synchronously unmount a root while React was already rendering. React cannot finish unmounting the root until the current render has completed, which may lead to a race condition.
>     at SidePanel (src/components/layout/SidePanel.tsx:5:22)
>     ...
>     at App (src/App.tsx:86:38)

This is reproducible in the existing `layout.test.tsx` "toggles side panel when icon clicked" test — the warning prints to stderr today. In production it may silently produce a stale tree, double-mount, or detached fibers. Spec §11 explicitly accepts the per-click mount/unmount cost; what it does **not** accept is unmount-during-render.

**Fix:** defer the unmount to a microtask so it runs after React's commit phase finishes:

```ts
return {
  dispose() { queueMicrotask(() => root.unmount()); },
};
```

Apply to both `connections` and `saved` built-in render closures. (Plugin renders are the plugin's responsibility — if a plugin author uses `createRoot`, they can choose to defer; this is documentation, not host enforcement.)

**I-2. Activity-bar bootstrap polls `setTimeout` indefinitely with no cancellation token.**
File: `src/App.tsx:229-253`.

```ts
useEffect(() => {
  const builtIns = makeBuiltInRegistry();
  let composite = new CompositeActivityRegistry([builtIns]);
  setItems(composite.list());
  let pluginSub: { dispose(): void } | null = null;
  let topSub:    { dispose(): void } | null = null;
  const trySubscribe = () => {
    const host = (window as ...).__pluginHost;
    if (!host) { setTimeout(trySubscribe, 50); return; }   // ← never cleared
    ...
  };
  trySubscribe();
  return () => { pluginSub?.dispose(); topSub?.dispose(); };
}, []);
```

Three problems:

1. The pending `setTimeout(trySubscribe, 50)` is never tracked nor cleared. If the component unmounts (Strict Mode double-invoke in dev; full unmount on app teardown) before `__pluginHost` becomes available, the timer keeps firing — eventually calling `setItems` on an unmounted component.
2. Even after the host arrives and subscriptions are wired, the recursive timer chain could be in flight if the same render cycle replaced the effect. There's no `cancelled` flag.
3. **Polling is the wrong primitive.** `App.tsx:182-223` (the plugin-host bootstrap effect) already does the work synchronously after `await createPluginHost(...)`. Either reorder the two effects (bootstrap first, then activity-bar reads `window.__pluginHost` once) or expose a host-ready Promise/event from `createPluginHost` and `await` it.

**Fix (minimum):** add a `cancelled` flag and a `pendingTimer` handle, clear in cleanup:

```ts
useEffect(() => {
  let cancelled = false;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  const builtIns = makeBuiltInRegistry();
  let composite = new CompositeActivityRegistry([builtIns]);
  setItems(composite.list());
  let pluginSub: { dispose(): void } | null = null;
  let topSub:    { dispose(): void } | null = null;
  const trySubscribe = () => {
    if (cancelled) return;
    const host = (window as ...).__pluginHost;
    if (!host) { pendingTimer = setTimeout(trySubscribe, 50); return; }
    const pluginReg = new PluginActivityRegistry(host.registries.views);
    composite = new CompositeActivityRegistry([builtIns, pluginReg]);
    setItems(composite.list());
    topSub = composite.onDidChange(() => { if (!cancelled) setItems(composite.list()); });
  };
  trySubscribe();
  return () => {
    cancelled = true;
    if (pendingTimer) clearTimeout(pendingTimer);
    pluginSub?.dispose();
    topSub?.dispose();
  };
}, []);
```

**Fix (preferred):** replace polling with an explicit ready signal from `createPluginHost`.

**I-3. Duplicate `setItems` subscription — `pluginSub` and `topSub` both fire on every plugin-registry change.**
File: `src/App.tsx:244-245`.

```ts
pluginSub = pluginReg.onDidChange(() => setItems(composite.list()));
topSub    = composite.onDidChange(() => setItems(composite.list()));
```

`CompositeActivityRegistry.onDidChange` registers the callback on **each child** (`activityBar.ts:75-78`), which includes the plugin registry. So `pluginReg.onDidChange` fan-out fires the same callback twice for every plugin add/remove. Functionally harmless (both setItems calls return the same list and React bails on equal state) but:

- It's a code smell suggesting the author was unsure which subscription "should" fire.
- It defeats the purpose of having a composite at all — `topSub` already covers built-ins + plugins.
- On a plugin that mounts → unmounts → mounts in quick succession (during activation failures, say), it produces twice the re-renders.

**Fix:** drop `pluginSub`. Keep only `topSub = composite.onDidChange(() => setItems(composite.list()))`.

**I-4. `SidePanel` cleanup removed `bodyRef.current.innerHTML = ''` (commit `2297974`) — discuss leak surface.**
File: `src/components/layout/SidePanel.tsx:19-21`.

```ts
return () => {
  try { disposable?.dispose(); } catch { /* never throw */ }
};
```

The Task 15 fix correctly addresses the React-root collision (clearing innerHTML *after* a React root unmount left the root container in an inconsistent state and the next mount on the same node would throw). However, **for plugin views**, the contract now is: *the plugin's `dispose()` MUST remove every DOM node it appended to `container`.* If a plugin author does:

```ts
render(container) {
  const div = document.createElement('div');
  div.textContent = 'hi';
  container.appendChild(div);
  return { dispose() { /* oops, forgot to remove div */ } };
}
```

…then on every item switch a stale `<div>` accumulates on the container. The host can't reliably "clear" because doing so collides with React's root tracking when built-ins use `createRoot`.

**Recommendation (lighter touch — pick one):**

(a) Document the contract on `ActivityItem.render` in `src/layout/activityBar.ts`:

```ts
/**
 * Imperatively render the item into `container`.
 *
 * The returned `dispose()` is responsible for REMOVING every DOM node and
 * tearing down every subscription/observer this render created. The host
 * does NOT clear `container.innerHTML` between items, because doing so
 * would collide with React root tracking when the item uses createRoot/unmount.
 *
 * If you used `createRoot(container)`, defer `root.unmount()` with
 * `queueMicrotask` so it runs after React's commit phase (see App.tsx
 * built-in renderers for the canonical pattern).
 */
render(container: HTMLElement): { dispose(): void };
```

(b) **Defer** the cleanup: schedule both `dispose()` and a `innerHTML = ''` reset on a microtask, so the React root's own unmount happens between them:

```ts
const node = bodyRef.current;
return () => {
  const d = disposable;
  queueMicrotask(() => {
    try { d?.dispose(); } catch { /* never throw */ }
    if (node && node.isConnected && node.childElementCount > 0) {
      // Defensive backstop for plugins that don't fully clean up. Runs after
      // dispose() so a React root's unmount has already cleared its subtree.
      node.innerHTML = '';
    }
  });
};
```

Pick (a) at minimum. (b) is a backstop and is worth implementing once a plugin out there leaks; not strictly required for v1, but a one-comment note here would prevent the next maintainer from re-introducing the line that 2297974 removed.

### NIT

**N-1.** `plugin-agnostic-host.test.ts` globs `.ts`/`.tsx` only. Spec §2 + plan Task 16 expected JSON too. Extend the glob:

```ts
const sources = import.meta.glob('/src/**/*.{ts,tsx,json}', { eager: true, query: '?raw', import: 'default' });
```

**N-2.** `App.activity-bar.test.tsx` is a registry-level integration test, not an App-render test. It verifies `resolveActiveId(comp.list(), 'p.x')` etc. but never mounts `<App />`. App-render coverage lives in `layout.test.tsx`. Either rename to `activity-bar-integration.test.ts` (drop the `.tsx`) for honesty, or extend it to actually render `<App />` and assert that a stub plugin registering a view causes a new icon to appear (requires `act()` + a manually wired `window.__pluginHost` for the jsdom path).

**N-3.** Inside the activity-bar `useEffect`, `composite` is a `let` that is re-assigned after the plugin host arrives. The subscription callbacks `() => setItems(composite.list())` read the **latest** binding because JS closure semantics — that's correct, but it's the kind of thing a future maintainer is likely to break by adding an `if` or destructuring `composite` into a local. Either inline the list build via a stable `getItems()` helper:

```ts
const getItems = () => composite.list();
topSub = composite.onDidChange(() => setItems(getItems()));
```

…or capture into a `useRef<CompositeActivityRegistry | null>`.

**N-4.** `src/App.tsx:1-2` imports both `createElement` (used by `makeBuiltInRegistry`) and JSX (transpiled). No issue, just verbose — `<ConnectionPanel/>` JSX would compile too if the function were placed inside the component. As-is it's a top-level utility so `createElement` is appropriate. FYI.

**N-5.** `App.tsx:215` casts `(window as unknown as Record<string, unknown>).__pluginHost = host`. Two effects later, `App.tsx:239` does a different shape: `(window as unknown as { __pluginHost?: { registries: { views: Registry<ViewProvider> } } }).__pluginHost`. The two shapes contradict — the second is a strict subset. Introduce a single `interface PluginHostWindow { __pluginHost?: PluginHost }` at module scope and use it in both places.

**N-6.** `BuiltInActivityRegistry.add()` fires `onDidChange` on duplicate-throw path (it throws *before* firing, so this is fine). Reading the code, `if (this.items.some(i => i.id === item.id)) throw` precedes `this.fire()` — correct. ✓ (No change.) Noted only because the symmetric `remove()` method doesn't exist (spec §3 puts that out of scope).

**N-7.** `PluginActivityRegistry.list()` rebuilds the items list on every call (re-runs `filter().map(toItem)`). Each call also creates fresh `ActivityItem` objects, so `items.find(i => i.id === activeId)` returns a different object reference per render. Today the SidePanel effect keys on `item?.id` so referential equality doesn't matter. NIT-only: if anyone in the future memoises on the item reference, this will surprise them. Consider caching the result of `toItem(v)` keyed by `v.id` + `v.icon` + `v.title`.

**N-8.** `IconRail.test.tsx` "renders the icon text of each item" relies on `toHaveTextContent('A')` matching the body of the button. Since `aria-label='Alpha'` and the text content is `'A'`, this is unambiguous. Stable. ✓

**N-9.** `SidePanel.test.tsx` "disposes the prior render when item changes" uses a render that does `c.textContent = body` directly. This bypasses the React-root pathway of the real built-ins, so it doesn't reproduce the I-1 warning. Add a separate test that wraps an item in `createRoot` and asserts no `console.error` warning fires on item switch (requires `vi.spyOn(console, 'error')`).

**N-10.** `activityBar.ts` has no inline comment naming the extension contract (project CLAUDE.md mandates: "implement this interface to add a new variant"). Add one above `ActivityItem`:

```ts
/** implement this interface to contribute a new activity-bar item (built-in or plugin) */
export interface ActivityItem { ... }

/** implement this interface to add a new activity source (built-in store, plugin registry, etc.) */
export interface ActivityRegistry { ... }
```

This is explicitly required by the project rule "Name plugin points explicitly".

### Code-standards skill — new pattern observed

None of these are general enough to warrant a new `/code-standards` rule. I-1 (defer React unmount in cleanup) is React-specific and the `code-standards` skill is Java/Vert.x-focused.

---

## Routing

- **I-1 → coder-activity-bar** (`src/App.tsx:46,57` — wrap `root.unmount()` in `queueMicrotask`).
- **I-2 → coder-activity-bar** (`src/App.tsx:229-253` — cancel pending timer + cancelled flag).
- **I-3 → coder-activity-bar** (`src/App.tsx:244-245` — drop `pluginSub`).
- **I-4 → coder-activity-bar** (at minimum, add the doc comment on `ActivityItem.render` in `src/layout/activityBar.ts`).
- N-1..N-10 → keep as FYI for next iteration unless any are easy wins (N-1 is one line; N-10 is doc-only).

Sent to coder-activity-bar.

---

## Stage 3 — Iteration verification

Commit `135cbe4` ("fix(activity-bar): address code review findings I-1 through I-4") from coder-activity-bar addresses all four IMPORTANTs. Verified by reading the diff and re-running the suite:

- **I-1 verified.** Built-in render closures now create an isolated `wrapper` div per render (`App.tsx:46-49,69-72`), `container.appendChild(wrapper)`, mount `createRoot(wrapper)`. `dispose()` calls `wrapper.remove()` synchronously (detaching the old subtree from the live DOM before the next render mounts) and then `queueMicrotask(() => root.unmount())` deferred. This is a stronger fix than my proposal — the synchronous `wrapper.remove()` also fixes a separate `NotFoundError` race where `@testing-library`'s document teardown detaches the root before the deferred `root.unmount()` runs. The React "synchronous unmount during render" warning no longer appears in `vitest run` stderr for `layout.test.tsx`.
- **I-2 verified.** `App.tsx:251-275`: `let cancelled = false; let pendingTimer: ReturnType<typeof setTimeout> | null = null;`. `trySubscribe` short-circuits on `cancelled`. Recursive `setTimeout` is stored into `pendingTimer`. Cleanup: `cancelled = true; if (pendingTimer) clearTimeout(pendingTimer); topSub?.dispose();`.
- **I-3 verified.** `pluginSub` declaration and assignment both removed. Single `topSub = composite.onDidChange(...)` remains (`App.tsx:269`). Inline comment explains the rationale.
- **I-4 verified.** `activityBar.ts:5-15`: JSDoc block above `ActivityItem` documents the cleanup contract — "`dispose()` MUST remove every DOM node and tear down every observer the render created. The host no longer clears `container.innerHTML` after calling `dispose()` — doing so would collide with React root tracking when the item uses `createRoot`/`unmount`."

**Post-fix baseline:** `npx vitest run` → **379/379 PASS** across 59 files · `npx tsc --noEmit` → 0 errors. The React unmount warning that surfaced under Stage 2 (I-1) is gone from `layout.test.tsx`'s stderr. Other warnings present in the test output (act() wrapping, Tauri `invoke` undefined in jsdom for settings persist) are pre-existing and unrelated to this branch.

NITs N-1 through N-10 remain as deferred FYI for the next iteration; none required for this review to converge.

---

## Verdict: APPROVED




---

# PR 2 — Dialogs & Results refactor (cycle 1)

Reviewer: reviewer-ui-pr2. Diff: `38de9c2..5c77d59` (PR-1 tip → coder-ui-features-pr2 head).
8 commits. vitest 546/546 + tsc clean per coder report.

## Stage 1 — Spec compliance vs plan Tasks 14–19

### Checks PASSED

| # | Check | Evidence |
|---|---|---|
| 1 | Feature folders moved | `ls src/components/features` → ai, connections, editor, layout, results, saved-scripts. Old `src/components/{ai,connections,editor,layout,results,saved-scripts}` directories gone. |
| 2 | No stale imports to old paths | `git grep -n "components/{results,ai,connections,editor,saved-scripts,layout}" -- 'src/*' ':!*.md' ':!src/components/features/**'` → 0 hits. App.tsx:4–9,21–22 and the two `src/services/records/actions/*.ts` consumers point at the new paths. |
| 3 | 4 dialogs use Dialog+FormField, no hand-rolled modal | ConnectionDialog.tsx:56,164–169 / HostKeyDialog.tsx:28,43–47 / PassphraseDialog.tsx:26,48–51 / SaveScriptDialog.tsx:34,56–61 — all wrap `<Dialog open onClose=…>` with `Dialog.Header/Body/Footer`. `grep -n 'role="dialog"' src/components/features/{connections,saved-scripts}` returns 0 hits (the lone `role="dialog"` in features is `results/RecordModalShell.tsx:56`, which is out-of-scope for PR 2 — slated for PR 3+). No inline color/spacing/padding/margin/border in any of the 4 dialog files; all sizing/spacing flows through their `.module.css` siblings or design-system components. |
| 4 | ConnectionDialog preserves `<details>` SSH section | ConnectionDialog.tsx:121–157 — `<details className={styles.ssh}><summary>SSH Tunnel (optional)</summary>…` with all four SSH FormFields inside, unchanged shape. |
| 5 | Public APIs unchanged | Diff vs PR-1 baseline for each dialog: prop names + types identical (ConnectionDialog Props initial/onSave/onCancel; HostKeyDialog host/port/algorithm/fingerprint/onAccept/onReject; PassphraseDialog connectionName/onConfirm/onCancel; SaveScriptDialog initialName/initialTags/onSave/onCancel). Caller sites in `EditorArea.tsx`, `ConnectionPanel.tsx`, `App.tsx` unmodified beyond import paths. |
| 6 | ViewModeRegistry with required interface + extension comment | `src/components/features/results/viewModes/ViewModeRegistry.ts:1–8` JSDoc names the plugin point ("To add a new result view (Tree, Chart, …): implement `ResultViewMode`, register on module load in `viewModes/index.ts`. No edits to ResultsPanel or the registry itself are needed."). Interface lines 12–19 expose `id: string`, `label: string`, `Component: (props: { group: ResultGroup }) => ReactNode` — matches plan Task 17 exactly. Idiom mirrors `src/services/records/RecordActionRegistry.ts` (class with private map + singleton export). |
| 7 | TableViewMode + JsonViewMode self-register on import | `src/components/features/results/viewModes/index.ts:1–6` imports the singleton + both modes and calls `viewModeRegistry.register(TableViewMode/JsonViewMode)` at module load. ResultsToolbar.tsx:26 + ResultsPanel.tsx:20 import from this barrel so registration is guaranteed to run before first render. |
| 8 | ResultsPanel ≤ 250 lines & registry dispatch | `wc -l src/components/features/results/ResultsPanel.tsx` → 224. ResultsPanel.tsx:194–199 dispatches `const ViewComponent = viewModeRegistry.get(view)?.Component; … <ViewComponent group={activeGroup} />` — no `if (view === 'table') … else if (view === 'json')` branching remains. |
| 9 | Toolbar/Pagination/Console/ErrorBanner extracted | ResultsToolbar.tsx (46L), ResultsPagination.tsx (84L), ConsolePanel.tsx (10L), ErrorBanner.tsx (18L) all exist as separate files. ErrorBanner.tsx:14–16 uses `<Text variant="error" selectable>` per spec. |
| 10 | No `src/components/ui/` modifications | `git diff 38de9c2..HEAD -- src/components/ui/` → empty. FormField did not need widening. |
| 11 | No Zustand store / src-tauri changes | `git diff 38de9c2..HEAD --name-only` shows only `src/services/records/actions/{edit,view}RecordAction.ts` outside `src/components/` — both are 1-line import-path updates (line 5 / line 3 respectively). No store, no src-tauri. |
| 12 | Commit hygiene | 8 commits, each a logical unit with conventional prefix: `refactor: move feature components…`, `refactor(connections): migrate ConnectionDialog…`, `refactor(connections): migrate HostKeyDialog…`, `refactor(connections): migrate PassphraseDialog…`, `refactor(saved-scripts): migrate SaveScriptDialog…`, `feat(results): introduce ViewModeRegistry`, `refactor(results): decompose ResultsPanel into Toolbar/Pagination/Console/ErrorBanner`, `docs(pr2): tick Task 19 checkboxes and append implementation report`. Plan Task 16 ↔ 4 separate dialog commits ✓ (one per dialog, slightly exceeds the "3 separate dialog commits" hint in the task description — that's an improvement, not a violation). |
| Test fixups | `editor-area.test.tsx` and `integration/save-flow.test.tsx` changes are test-only | Diff inspected line-by-line: only `within(getByRole('dialog'))` scoping + the new import path. No production module touched. The dialog button-selector `dialog.querySelector('button:last-child')` was replaced by `dialogScope.getByRole('button', { name: /^Save$/i })` — strictly more robust, same semantics. |

### Checks FAILED

**S1-F1 — Behavior regression: arrow-key (F3 ↑/↓ etc.) navigation no longer follows the sorted table order.** ❌ (blocks Stage 1)

- File / line: `src/components/features/results/ResultsPanel.tsx:103–114` (new) vs PR-1 baseline `src/components/results/ResultsPanel.tsx:159–199` (`sortedDocs` + `docsRef.current = sortedDocs`).
- Coder also flagged this in their handoff. Confirmed by reading both versions side-by-side.
- Root cause: when sort state moved out of ResultsPanel into `TableViewMode`, ResultsPanel lost its view of the sorted-doc order. It now feeds `allDocs = activeGroup.docs` (insertion order) into `docsRef`. The keyboard nav handler at `src/hooks/useRecordActions.ts:142–156` does `const docs = dRef.current; … docs[nextRow]`, so arrow-key cell navigation walks insertion order while the user sees sorted order. This is a user-visible behavior regression.
- Why this fails Stage 1: plan Task 17/18 spec is **behavior-preserving** for the ResultsPanel decomposition (the plan only allows visual/architectural changes, not semantic ones). No tests cover sorted-table + arrow nav, which is why the suite still passes despite the regression — this is a coverage gap, not a green-light.
- Required fix (preferred): widen the `ResultViewMode.Component` contract now in PR 2 rather than carrying the regression into PR 3+. Concretely:

  ```ts
  // ViewModeRegistry.ts
  export interface ViewRenderContext {
    group: ResultGroup;
    /** Views call this with the docs they actually render (sorted, filtered, …)
     *  so the host can keep record-action navigation in display order. */
    onRenderedDocsChange?: (docs: unknown[], columns: string[]) => void;
  }
  export interface ResultViewMode {
    id: string;
    label: string;
    Component: (props: ViewRenderContext) => ReactNode;
  }
  ```

  Then:
  - `ResultsPanel.tsx`: pass `onRenderedDocsChange={(docs, cols) => { docsRef.current = docs; columnsRef.current = cols; }}` and drop the existing `useEffect(() => { docsRef.current = allDocs; …})` writes.
  - `TableViewMode.tsx`: `useEffect(() => { onRenderedDocsChange?.(sortedDocs, columnsOf(sortedDocs)); }, [sortedDocs, onRenderedDocsChange])`.
  - `JsonViewMode.tsx`: `useEffect(() => { onRenderedDocsChange?.(group.docs, []); }, [group, onRenderedDocsChange])` (JSON view is not navigable by arrow keys, but publishing keeps the ref consistent if the user switches view → switch back).

  This is the extensibility-first move from CLAUDE.md ("Document the extension contract"): the registry should describe how a view participates in host-side state, not assume a closed contract that loses behavior on the first non-trivial migration. Comment block in `ViewModeRegistry.ts` should mention this new responsibility explicitly.

- Optional minimum fix (NOT recommended): keep the registry as-is and document the regression behind a user sign-off. CLAUDE.md's "extensibility-first" + plan's "behavior-preserving" both argue against this. Flagging here per the team-lead's instruction so they can override if desired.

### Status

**Stage 1 cycle 1: NOT PASSED.** One blocking item (S1-F1). Sending feedback to coder-ui-features-pr2 with the required fix. Re-review on next message.

Context-health: comfortable headroom, well under 50% used.

