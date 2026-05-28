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


---

# PR 4 — Final inline-style sweep + layout primitives (cycle 1)

Reviewer: reviewer-ui-pr4. Diff base: `7201ae1` (PR 3 tip).
4 commits (`3469368..35ce7f1`): `refactor(layout): ContextBar/IconRail/SidePanel/StatusBar use primitives` · `refactor(saved-scripts): use Panel + ListRow` · `refactor(editor): decompose EditorArea` · `chore(ui): final inline-style sweep`.
Coder report: vitest 553/553, tsc clean. Independently re-run: vitest 553/553 (93 files), tsc clean.

## Stage 1 — Spec compliance vs plan Tasks 24–28

### Acceptance grep recipes (the §Acceptance gates — global across all 4 PRs)

| Recipe | Result | Target | Status |
|---|---|---|---|
| `git grep -nE 'style=\{\{' src/components/features/ src/App.tsx \| wc -l` | **2** | < 20 | ✅ |
| `git grep -nE '(color:\|background:\|padding:\|margin:)' src/components/features/ src/App.tsx \| grep -v '\.css' \| wc -l` | **0** | 0 | ✅ |
| `find src/components/features -name "*.tsx" -exec wc -l {} + \| sort -rn \| head` top entry | **236** (ResultsPanel.tsx) | < 280 | ✅ |
| `npx vitest run` | **553/553 pass** (93 files) | green | ✅ |
| `npx tsc --noEmit` | **0 errors** | clean | ✅ |

The 2 remaining inline styles are both dynamic-pixel cases per spec ("Dynamic pixel from a prop/runtime value → keep"):
- `src/components/features/ai/AIChatPanel.tsx:103` — `style={{ width: width }}` (panel width from `useResizable`; pre-existing from PR 3).
- `src/components/features/layout/SidePanel.tsx:69` — `style={{ display: item && !error ? 'block' : 'none' }}` (runtime visibility toggle gating the imperatively-rendered plugin host; cannot be expressed as a static class).

### Per-file LOC vs targets

| File | Pre-PR4 | Post-PR4 | Target | Status |
|---|---|---|---|---|
| editor/EditorArea.tsx | 312 | **143** | ≤ 240 | ✅ |
| saved-scripts/SavedScriptsPanel.tsx | 216 | **127** | < 280 | ✅ |
| editor/ContextBar.tsx | 192 | **165** | < 280 | ✅ |
| layout/IconRail.tsx | 76 | **47** | < 280 | ✅ |
| layout/SidePanel.tsx | 99 | **78** | < 280 | ✅ |
| layout/StatusBar.tsx | 32 | **20** | < 280 | ✅ |

### Stage-1 checklist (8 items from task description)

| # | Check | Evidence |
|---|---|---|
| 1 | EditorArea ≤ 240L; EditorTabBar + (EditorEmptyState) extracted | `EditorArea.tsx`=143L. `EditorTabBar.tsx`=73L hosts the tab strip + cancel button. The empty state is a single `<div className={styles.empty}>No editor tab open.</div>` (EditorArea.tsx:96) — extraction to a dedicated `EditorEmptyState.tsx` would be over-engineering for one line of static markup. Task description explicitly permits skipping it; confirmed against `7201ae1:EditorArea.tsx:226` where the empty case was identically a one-liner. Acceptable. |
| 2 | SavedScriptsPanel wrapped in `<Panel>`; rows are `<ListRow>` w/ trailing IconButton | `SavedScriptsPanel.tsx:65-67` (`<Panel><Panel.Header title="Saved Scripts" /><Panel.Body>`). Lines 78-100: each script renders `<ListRow onClick={...} trailing={<div>… two `<IconButton>` …</div>}>{script.name}…</ListRow>`. Delete uses `IconButton` (line 92-99) with destructive `:hover` styling in `.delete:hover` (SavedScriptsPanel.module.css:39-43). ✅ |
| 3 | ContextBar → `<Toolbar>`; IconRail → `<VStack>` of `<IconButton>`; SidePanel → `<Panel>`; StatusBar 0 inline styles | ContextBar.tsx:152 `<Toolbar data-tab-id={tabId} left={left} right={right} />`. IconRail.tsx:14 `<VStack gap="none" className={styles.rail}>` wrapping `<IconButton ... pressed={isActive} />` (lines 21-32) + settings button (lines 36-43). SidePanel.tsx:58 `<Panel className={styles.shell}>` with `<Panel.Header title={…} />` and host div. StatusBar.tsx:9-21 contains zero `style={` occurrences — all sizing/colour moves to StatusBar.module.css (`.bar`, `.dot`, `.dotConnected`, `.spacer`). ✅ |
| 4 | Overall acceptance grep recipes pass | See table above. All 3 grep gates plus tests + tsc. ✅ |
| 5 | No file in features/ exceeds 280L | Top entry ResultsPanel.tsx=236L (untouched by PR 4, inherited from PR 2 baseline). ✅ |
| 6 | PR 1 primitives untouched (or minor widening + justification) | `git diff 7201ae1..HEAD -- src/components/ui/` → **empty**. No PR 1 primitive widened. ✅ |
| 7 | Stores / services / src-tauri untouched | `git diff 7201ae1..HEAD --name-only` lists only `docs/...plans...`, `src/components/features/**`, `src/components/shared/KeyboardScopeZone.tsx`. No `src/store/**`, `src/services/**`, `src-tauri/**`. ✅ |
| 8 | Behavior preserved end-to-end | Detail below. ✅ |

### Behavior preservation (item 8) — side-by-side checks against `7201ae1:` baseline

- **Tab close/reorder.** EditorTabBar.tsx:39-50 preserves the close-button click semantics: `handleClose(e, id)` calls `e.stopPropagation()` before `onClose(id)` — matches PR-3 `EditorArea.tsx:118-119` inline `onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}`. The `+ New` button (line 56-58) and the conditional Cancel button in the right-slot (lines 61-66) preserve PR-3 wiring; `isRunning` is the gating predicate in both versions. Tab-row scroll uses the same `.tab-scroll` utility (kept in globals.css; pinned via comment in EditorTabBar.module.css:1-7 + EditorTabBar.tsx:21-24 docstring).
- **Saved-script flow.** `confirmingId` state, `confirmDelete`, `handleDuplicate`, `open(script)`, `nextDuplicateName` are byte-identical to baseline except for the wrapping JSX shifting from a hand-rolled list to `<Panel> / <Panel.Body> / <ul> / <li> / <ListRow>`. Inline confirmation strip (lines 102-113) preserves "Cancel"/"Delete" buttons with the same destructive styling — moved to `.confirmDelete` / `.confirmCancel` CSS modules. Duplicate and Delete `IconButton`s remain hover-revealed (`.actions { opacity: 0 }` → `.rowWrap:hover .actions { opacity: 1 }` at SavedScriptsPanel.module.css:24-32) — same UX as baseline's `setHoveredId(...)` JS toggle.
- **Status-bar messages.** StatusBar.tsx:10-20 renders `<span>● connectionName ?? 'No connection'</span> · <span>database</span> · <span class=spacer>nodeStatus ?? ''</span>` — identical content/order to baseline. The connected/disconnected dot colour (green vs dim) moves from inline `style` to `.dotConnected` / `.dot` classes; visual output unchanged given `var(--accent-green)` and `var(--fg-dim)` are reused.
- **Breadcrumb / ContextBar context.** ContextBar.tsx:84-129 (left slot) preserves the empty-state message ("No connections — connect in sidebar"), connection select, database select with disabled-when-loading state, and the warning icon. Right slot (133-149) preserves `Save` (only when `hasSavedScript`), `Save As`, and the execution-mode buttons with filled/outlined variants and disabled state via `modeButtonClass(...)`. `data-tab-id={tabId}` is forwarded onto the `<Toolbar>` root (Toolbar accepts `...rest`) so any consumer keyed off `[data-tab-id]` keeps working.
- **Icon-rail pressed state.** IconRail.tsx:23-33 sets `pressed={isActive}` on the `<IconButton>` (this drives `aria-pressed`) AND applies `${styles.active}` for the left-edge accent stripe. Behaviour matches baseline: `border-left: 2px solid var(--accent)` activates iff `isActive`, achieved via `.railBtn.active` selector in IconRail.module.css:25-30. Settings button (36-43) follows the same shape with `settingsOpen` as the pressed predicate.

### Coder's 4 flagged decisions (D1-D4)

- **D1 — KeyboardScopeZone widened with `className?` prop.** ✅ Confirmed at `src/components/shared/KeyboardScopeZone.tsx:7,11,17`. Purely additive (default undefined → element renders without a `className` attribute, behaviour unchanged for prior callers). `src/components/shared/` is outside the "do NOT modify ui/" hard constraint, so this is legitimate. Consumers: `ResultsPanel.tsx:169,177` and `viewModes/TableViewMode.tsx:50` use the new prop. No JSX warning from unused `className` (React passes `undefined` through harmlessly). Accept.
- **D2 — IconButton uses `className` override in IconRail.** ✅ The `className` prop is part of IconButton's public surface (`src/components/ui/IconButton/IconButton.tsx:12-13` — already merges into `cls`). `.railBtn` rule (IconRail.module.css:23-30) is scoped through CSS Modules (no `:global(...)`) so it cannot leak. The override widens hit area from 28px → 44px and adds the left-edge accent stripe — both rail-specific concerns that don't belong in the generic primitive. Correct use of the documented extension path.
- **D3 — SidePanel.Header wraps title in `<span data-testid="side-panel-title">`.** ✅ The two test files `src/__tests__/SidePanel.test.tsx:19` and `src/__tests__/layout.test.tsx:31` rely on this testid; preserving them avoided churn in tests outside PR 4 scope. **Interesting twist:** `Panel.Header`'s `title` prop is already typed `ReactNode` (`src/components/ui/Panel/Panel.tsx:17`), so the wrapping `<span>` is a clean use of the existing API — no Panel-primitive change required. (Future enhancement could let `Panel.Header` accept `titleTestId?: string` to avoid the wrapper entirely, but that's a Panel-API change → out of scope and not worth a follow-up.)
- **D4 — ScriptEditor moved highlight CSS from runtime `<style>` injection to a CSS-Modules side-effect import.** ✅ `src/components/features/editor/ScriptEditor.module.css:4` uses `:global(.current-statement-highlight) { background: var(--bg-hover); }`. `ScriptEditor.tsx:9` imports the module purely for side-effects (`import './ScriptEditor.module.css'`). The constant `HIGHLIGHT_CLASS = 'current-statement-highlight'` at line 28 is unchanged — Monaco's `deltaDecorations({ className: HIGHLIGHT_CLASS })` (line 173) references the same global class name string. No CSP issue (no `document.createElement('style')` at runtime). Net positive: removes mutable DOM-head side effect, removes the `HIGHLIGHT_STYLE_ID` / `ensureHighlightStyle()` ceremony. The lone caveat is the `:global(...)` selector itself — but since Monaco's decoration API only accepts a class-name string and cannot consume a CSS-Modules locally-scoped name, `:global` is the only viable path. Comment at top of ScriptEditor.module.css:1-3 explains this clearly.

### Stage 1 verdict: **PASS** — all 8 checklist items, 3 acceptance gates, 6 per-file LOC targets, behavior preservation, and 4 coder-flagged decisions all hold.

## Stage 2 — Code-review (uncapped over `git diff 7201ae1..HEAD`)

Cross-referenced against project `/code-standards`. No BLOCKING findings.

### IMPORTANT — 0 findings.

### NIT (informational, not blocking)

**S4-N1.** `SavedScriptsPanel.tsx:69-72` — search input is a raw `<input>` rather than a design-system `FormField` / TextInput. This was the same shape before PR 4 (baseline `7201ae1:SavedScriptsPanel.tsx:154-167`), so it's pre-existing tech debt, not a PR 4 regression. Out of scope; keep as-is.

**S4-N2.** `ContextBar.tsx:94-128` — connection/database `<select>` elements are raw HTML, not a design-system `Select` primitive. Same as N1: pre-existing, no `Select` primitive exists in `src/components/ui/`. Out of scope.

**S4-N3.** `ContextBar.tsx:133-149` — Save/Save As/mode buttons are raw `<button>` not design-system `Button`. The mode buttons in particular have bespoke filled/outlined variants. The PR plan §HARD CONSTRAINTS forbids widening PR 1 primitives in PR 4. Acceptable; would be the natural follow-up for a "PR 5 — promote Button to handle filled/outlined variants" task.

**S4-N4.** `SavedScriptsPanel.tsx:113-122` — inline confirmation strip uses raw `<button>` for Cancel/Delete instead of `Button`. Same pre-existing tech debt; the inline confirm pattern itself is intentional (avoid full Dialog for a single delete).

**S4-N5.** `EditorTabBar.tsx:43-58` — tabs themselves are `<div>` elements that act as buttons (cursor:pointer, onClick) and the close affordance is a `<span>` with `onClick`. This is preserved exactly from PR-3 baseline. Strict a11y reading would want `<button role="tab">` inside `role="tablist"`, but converting the tab strip to ARIA tabs is a larger UX/keyboard-nav change (arrow-key tab navigation, Home/End, etc.) that's out of scope. Documented as deferred.

**S4-N6.** `SidePanel.tsx:25-27` — the imperative `el.style.display = ...` mutation on the cached view element remains (cannot be expressed via CSS Modules since cache entries are dynamic IDs). This is a content-script-style pattern that's necessary for the plugin-host's "cache & toggle" architecture. Same as baseline; not a finding.

**S4-N7.** `SidePanel.tsx:68-72` — the host `<div>` uses `style={{ display: item && !error ? 'block' : 'none' }}` to hide the cache container when no item is selected (so the empty-state message can occupy the space). This is one of the 2 remaining inline-style hits and is the "dynamic from runtime value" case the spec explicitly permits. An alternative would be two sibling DOM nodes plus conditional render of one or the other, but that would orphan the cached plugin views. Accept.

**S4-N8.** `EditorTabBar.module.css:45-50` — `.toolbar` rule overrides `<Toolbar>`'s default padding and min-height (`padding: 0; min-height: 32px; height: 32px;`). This is one of the few "primitive overrides via className" callouts in the diff. The Toolbar primitive accepts `className` for exactly this purpose (extension via composition), and the override is necessary because tabs fill the row edge-to-edge with their own internal padding. Clean.

**S4-N9.** `RecordModalShell.tsx` — this file got moved to CSS Modules in PR 4 (`RecordModalShell.module.css`) which is a clean win. The lingering `role="dialog"` here (line 56) is intentional: PR 2's plan flagged this as a separate concern from the connection/save dialogs, and the rich content-bearing record modal is a different beast than the form dialogs (it doesn't fit `Dialog.Body`/`Dialog.Footer` cleanly because the footer height + body height + 80vh max-height all interact). Migrating it to `Dialog` is a v-next concern; out of scope for PR 4.

**S4-N10.** `useEditorActions.ts` — clean extraction (127 lines) of run/page/save handlers + per-tab cursor + page-size state. One pre-existing pattern carried in: handler bodies reference `active` after a null-guard (`if (!active) return`) and then rely on `active` being non-null — TypeScript narrows this correctly under `noUncheckedIndexedAccess`/strict mode. Verified `npx tsc --noEmit` is clean. No change.

### Code-standards skill — new pattern observed

`/code-standards` is Java/Vert.x/MongoDB-focused; the patterns in this diff (React composition, CSS Modules, primitive className overrides, dynamic-style pixel exceptions) are out of skill scope. No new rule to add.

### Cross-reference to PR 1–3 deferred items (S2-N1..N6 ish & F1-F5 from prior reviews)

The team-lead asked me to re-check the deferred FYI items from PR 1-3 against PR 4 changes. The labels `S2-N1..N6` and `F1-F5` in the prompt don't all correspond to exact section IDs in `CODE_REVIEW.md` (the file uses `N-1..N-10`, `S1-F1`, etc.), so I read the classes of concerns rather than literal IDs.

| Class of deferred concern (from PR 1-3 reviews) | Status after PR 4 |
|---|---|
| `useResizable` invert-mode extensibility doc | **CLOSED** by `4b6d50f` (docs(ui): document useResizable invert extension contract) in PR 3 docs sweep |
| AI panel `style={{ width }}` dynamic pixel | **STILL OPEN** (one of the 2 remaining; permitted by spec — `keep` per Task 27 Step 2) |
| `App.tsx` plugin-host window-shape duplication (N-5 from PR 1 review) | **OUT OF SCOPE** for PR 4 — App.tsx not touched here. Still deferred. |
| Activity-bar test that mounts `<App />` (N-2 from PR 1 review) | **OUT OF SCOPE** — tests untouched. Still deferred. |
| `ActivityRegistry` extension-point JSDoc (N-10 from PR 1) | Was **CLOSED in PR 1 cycle 2** per existing review log. |
| `ResultsPanel` arrow-key sorted-nav (S1-F1 from PR 2 review) | Was **CLOSED in PR 2 cycle 2** (`a388bed fix(results): preserve sorted-order keyboard navigation across view migration`). Verified still in place — `ResultsPanel.tsx:115-118` uses `onRenderedDocsChange` callback; `TableViewMode.tsx:39-42` publishes `sortedDocs`. |
| `RecordModalShell` migration to `Dialog` | **STILL OPEN** — CSS Modules migration happened in PR 4 (S4-N9), but the `Dialog` primitive migration is still deferred. |
| `Select` / `Button` design-system primitives for ContextBar selects + mode buttons | **STILL OPEN** (S4-N1, N2, N3 above) — would require new primitives in `src/components/ui/`, which PR 4's HARD CONSTRAINTS forbid. |
| ARIA tab semantics for `EditorTabBar` | **STILL OPEN** (S4-N5). |

### Stage 2 verdict: **PASS** — no blocking, all NITs informational or out-of-scope.

## Verdict: **APPROVED**

Both Stage 1 + Stage 2 pass on cycle 1. No fixes required. Forwarding to tester-ui-pr4 + team-lead.

---

# Final summary — across all 4 PRs

The `feat-ui-design-system-pr4-final-sweep` branch lands the **final PR of a 4-PR refactor** that ports the entire feature surface onto a typed design-system primitive layer.

## Key wins

1. **Inline-style elimination.** Across `src/components/features/` + `src/App.tsx`, total inline `style={{}}` occurrences fell from ~110+ at PR-1 start to **2 in this final tip** — both of which are the spec-permitted "dynamic pixel from runtime value" exception (AI panel width, SidePanel host visibility). Static CSS literals (`color:`, `background:`, `padding:`, `margin:`) in JSX are **at 0**. All remaining styling flows through CSS Modules backed by design tokens (`var(--bg)`, `var(--accent)`, `var(--space-*)`, `var(--fs-*)`).
2. **Primitive layer fully adopted.** Every meaningful surface now composes through `Panel`, `Panel.Header/Body/Footer`, `Toolbar`, `VStack`, `IconButton`, `ListRow`, `Dialog`, `FormField`, `Button`, `Text`, `ResizableSplit`, `useResizable`. The primitives themselves remain a closed kernel: `git diff` from PR-1 tip through this branch shows zero modifications to `src/components/ui/` after the PR 1 freeze (with one documented widening: `useResizable.invert` in PR 3 for edge-docked panels).
3. **Component decomposition.** Top-LOC files in `features/` ended at 236L (ResultsPanel.tsx, against a 280L cap). The headline PRs each carved their giants: ResultsPanel 800+→236 (PR 2), ConnectionPanel/App.tsx (PR 3), EditorArea 312→143 + SavedScriptsPanel 216→127 (PR 4). The `ViewModeRegistry` (PR 2) and `ActivityRegistry` (PR 1) are real extension points with documented "implement X to add a new variant" contracts — satisfying CLAUDE.md's extensibility-first mandate.
4. **Behavior preservation.** Sorted-table arrow-nav (PR 2 S1-F1), AI panel resize semantics with edge-dock invert (PR 3), tab close/reorder, script save/delete, status messages, breadcrumb context, icon-rail pressed state, Monaco statement highlight (PR 4 D4 — runtime style injection → CSS Modules side-effect import) — all preserved end-to-end. **vitest 553/553 PASS · tsc 0 errors** at branch tip.
5. **Zero impact on the platform layer.** No `src/store/**`, `src/services/**`, `src-tauri/**` changes across the entire 4-PR span (each PR's review independently verified this). The refactor is strictly a presentation-layer rewrite.

## Remaining tech debt (deferred to future work, not gating this branch)

1. **Raw `<select>` / raw `<button>` in ContextBar and `<input>` in SavedScriptsPanel.** Would need new `Select`, `Input`, and a variant-aware `Button` (filled/outlined) in `src/components/ui/`. Out of scope for the design-system *adoption* phase; appropriate for a "PR 5 — primitive coverage extensions" follow-up. (Refs: S4-N1, S4-N2, S4-N3, S4-N4.)
2. **`RecordModalShell` migration to `Dialog`.** The CSS-Module migration happened in PR 4 (S4-N9); the structural migration to the `Dialog` compound primitive is still pending because the modal's 80vh max-height + body/footer interactions don't fit `Dialog.Body`/`Dialog.Footer` cleanly. Needs a small `Dialog.size="fullscreen"` variant.
3. **EditorTabBar ARIA tabs.** The tab strip uses `<div onClick>` rather than `<button role="tab">` inside `role="tablist"`. Keyboard navigation (Home/End/arrows) would need to follow. (Ref: S4-N5.)
4. **AppShell main split → `ResizableSplit`.** AppShell.tsx still uses `react-resizable-panels` directly because the design-system primitive lacks drag-to-collapse (`collapsible` + `collapsedSize={0}`). Documented inline at `AppShell.tsx:30-37`. Migrate once `ResizableSplit` grows a `collapseThreshold` prop.
5. **Plugin-host window-shape duplication in App.tsx** (from PR 1 N-5) — minor type-shape inconsistency between two `(window as ...).__pluginHost` casts. Trivial fix; deferred because App.tsx wasn't touched by PRs 2-4 after PR 3's `KeyboardWiring` extraction.
6. **`Panel.Header` testid forwarding.** SidePanel uses a wrapper `<span data-testid="side-panel-title">` to keep two existing tests green (D3). Could be replaced by a `Panel.Header titleTestId?: string` prop; would clean up SidePanel and any future testid consumers.
7. **Activity-bar registry caching** (PR 1 N-7) — `PluginActivityRegistry.list()` re-allocates item objects on every call. Only matters if a future consumer memoises on item reference equality.
8. **Plugin-source glob extension** (PR 1 N-1) — `plugin-agnostic-host.test.ts` doesn't yet glob `.json` files; spec §2 had intended it to.

None of the above blocks merge. The branch is **production-ready** at `35ce7f1`.

---

## Task 11 Review (commits 7bcb8e4 + 5994f34)

**Files added/modified:**
- 7bcb8e4: `src-tauri/src/connection/migration.rs` (new), `src-tauri/src/connection/mod.rs` (+`pub mod migration;`), `src-tauri/src/state.rs` (+`connection_secrets` field + getter/setter), `src-tauri/src/main.rs` (+`bootstrap_conn_v2` gated on `CONN_V2`), `src-tauri/src/commands/connection.rs` (+`sync_v2_after_save` called after both `create_connection` and `update_connection`)
- 5994f34: `src-tauri/src/connection/secrets.rs` (SecretSlot rename: `MongoPassword` → `AuthPassword`, `AwsSessionToken` → `AwsSecretKey`; Phase-2 hardening items captured as docstring), `src-tauri/src/connection/migration.rs` (call sites updated to `AuthPassword`)

**Plan ref:** §Task 11 and §Migration

> **Build verification (isolated):** `git worktree add /tmp/task11-review 5994f34` → `cargo test --bin mongo-lens connection::` → **67/67 PASS** (1.14s). `cargo build` clean. Worktree removed.

### Stage 1 — Spec compliance: **PASS**

#### `migrate(legacy) → Connection` mirrors `src/connection/migration.ts`

- Module doc reproduces the 5 migration rules verbatim — diff-able against the TS migrator.
- **Critical: tests load the SAME paired fixtures Task 4 created** (`tests/fixtures/connection/{legacy,migrated}/`). Six fixture-pair tests (`pair_host_no_auth`, `pair_host_scram`, `pair_host_scram_missing_authdb`, `pair_host_scram_with_ssh_key`, `pair_uri_only`, `pair_uri_with_ssh_key`) load the legacy fixture, run `migrate()`, serialize via serde_json, and `assert_eq!` against the pre-computed migrated fixture. This locks Rust and TS to byte-equal output on the wire contract.
- Constants extracted (`DEFAULT_HOST`/`DEFAULT_PORT`/`DEFAULT_AUTH_DB`/`DEFAULT_SSH_PORT`/`MIGRATED_SSH_HOST_KEY_POLICY`), one named constant per defaulted value — matches the TS migrator's style.
- Edge cases beyond the fixture matrix: bare `bare` connection (all defaults), `migrate_clamps_out_of_range_port_to_default` (port=99_999 and ssh_port=-1 both fall back to defaults), `migrate_empty_username_treated_as_no_auth`, `migrate_empty_authdb_falls_back_to_admin`.

#### Port i64→u16 bounds check

```rust
fn to_u16_or(value: Option<i64>, default: u16) -> u16 {
    match value {
        Some(n) if (0..=u16::MAX as i64).contains(&n) => n as u16,
        _ => default,
    }
}
```

Explicit range guard prevents a corrupted SQLite INTEGER (negative or > 65535) from wrapping into a valid u16. Test `migrate_clamps_out_of_range_port_to_default` exercises both bounds.

#### `sync_row_to_v2` semantics

- Upserts the v2 payload row via `store::upsert(sqlite, &connection)?`.
- **Writes the legacy password to `SecretSlot::AuthPassword`** only when `legacy_password` is `Some(non_empty)`. Test `sync_writes_v2_row_and_keychain_slot` confirms the secret is at the right slot. Tests `sync_does_not_write_secret_when_password_is_none` and `sync_does_not_write_secret_when_password_is_empty` cover the absent/empty branches.
- **Never touches the legacy keychain entry** — verified by code (no `keychain::set_password` / `keychain::delete_password` calls in migration.rs) and by test `sync_does_not_touch_legacy_secret_or_row` which seeds a legacy row, calls sync, and confirms the legacy row survives.
- After the 5994f34 fix, the slot wire name is `auth-password` — matches plan §Migration's `conn:<id>:auth-password` requirement. **Cross-task coordination resolved.**

#### `migrate_all` shape + safety

- Returns `MigrationSummary { total, migrated, skipped_secret, failed }` — exactly the team-lead-specified shape.
- Per-row failure paths: password-fetch failure → `skipped_secret += 1`, the row is still upserted (test `migrate_all_counts_password_fetch_failures_as_skipped_secret`); upsert failure → `failed += 1`, the row is logged and skipped.
- Top-level only errors on the initial `legacy_db::list(sqlite)?` query — once the row list is in hand, nothing else can bubble up to bootstrap.
- Idempotent: test `migrate_all_is_idempotent` runs migrate_all twice and asserts exactly one v2 row exists.
- Empty-table edge case: test `migrate_all_handles_empty_legacy_table` returns `MigrationSummary::default()` (all zeros).

#### `bootstrap_conn_v2` cannot block startup

Every step in `main.rs::bootstrap_conn_v2` is independently recoverable:
1. **CONN_V2 env-var gate**: `if std::env::var("CONN_V2").is_ok()` — entire function is a no-op without the flag.
2. **Open secret store**: failure → `log.warn(...)` + `return`. App continues.
3. **Install on AppState**: infallible (mutex set).
4. **Open db handle**: failure → `log.warn(...)` + `return`. App continues.
5. **Run migrate_all**: errors are caught at the `match` level and warn-logged; nothing propagates back to the caller.

The function returns unit. Bootstrap cannot panic and cannot return an error that the Tauri setup hook would surface. ✓

#### Legacy paths untouched

- **`src-tauri/src/keychain.rs`** — `git diff 7bcb8e4~1 5994f34 --stat -- src-tauri/src/keychain.rs` shows zero changes. Legacy single-password path intact.
- **`src-tauri/src/db/migrate.rs`** — also unchanged in this range. Legacy `connections` table DDL untouched (`connections_v2` was added in Task 5 and is not modified here).
- **Old dialog still reads/writes `connections`** — `commands/connection.rs` still calls `db::connections::insert`, `keychain::set_password`, `keychain::delete_password` for the legacy paths. The new `sync_v2_after_save` runs **after** those, additively.

#### `commands/connection.rs` integration

The diff is small and surgical. In both `create_connection` and `update_connection`:
1. Legacy save happens first (`db::connections::insert/update`).
2. Legacy keychain write happens next (`keychain::set_password` / `delete_password`).
3. **Then** `sync_v2_after_save(&state, &conn, &rec, input.password.as_deref(), log.as_ref())` is called.
4. Within `sync_v2_after_save`, if `state.connection_secrets()` returns `None` (CONN_V2 disabled), the function is a pure no-op.
5. If `Some(store)`, any error from `migration::sync_row_to_v2` is **logged at warn** and swallowed: `if let Err(err) = ... { log.warn(...) }`. The user's save has already succeeded. ✓

One subtle cosmetic change: `input.password` is now bound by reference (`if let Some(ref pw) = input.password`) so it survives past the legacy write into the v2 sync call. UX behaviour identical; just borrow-lifetime accommodation.

### 5994f34 — Wire-name fix verified

- **`MongoPassword` → `AuthPassword`** (wire: `mongo-password` → `auth-password`). Resolves the Task 6 deviation flagged earlier; the new wire name matches plan §Migration's `conn:<id>:auth-password` exactly.
- **`AwsSessionToken` → `AwsSecretKey`** (wire: `aws-session-token` → `aws-secret-key`). Doc comment now distinguishes "long-lived IAM secret access key" (this slot, persisted) from "short-lived STS-derived `sessionToken`" (model field, not persisted). Explicit guidance: "if a future flow needs to cache it across launches, add a new `AwsSessionToken` slot rather than overloading this one."
- **`OidcRefreshToken` kept** — additive, no plan conflict.
- **Phase-2 hardening items captured in secrets.rs module docstring** — both `delete_all_for` prefix-collision and `fetch_or_create_master_key` silent overwrite are now tracked items inside the codebase, with concrete remediation sketches. ✓

### Stage 2 — Code quality: **PASS**

- **Layering** — `migrate()` is pure (no I/O); `sync_row_to_v2` is side-effectful but tightly scoped (one upsert + one secret write); `migrate_all` is the only function with a database-list operation. Each layer is independently testable.
- **`MigrationError`** uses thiserror with `#[from]` for both `StoreError` and `SecretError`. `?` works across both failure modes.
- **`MigrationSummary`** derives `Default`, `PartialEq`, `Eq`, `Copy` — fits cleanly with `migrate_all_handles_empty_legacy_table`'s `assert_eq!(summary, MigrationSummary::default())`.
- **`AppState::set_connection_secrets` / `connection_secrets()`** — late-binding via `Mutex<Option<Arc<dyn SecretStore>>>`. Caller gets an `Arc` clone (cheap), no allocation. Lock is not held across migrate_all (clone first, then call).
- **`bootstrap_conn_v2` uses `app.state::<AppState>()`** to install the store inside a tight scope, then drops the State guard before opening the db handle. Avoids holding the State guard across long-running work. Clean.
- **Documentation** — migration.rs has the migration rules reproduced inline as a checklist against the TS migrator. Module docs on every public function. `sync_v2_after_save` doc explicitly says "user-visible save has already succeeded" so any future reader understands the warn-and-swallow choice.

### Minor findings (non-blocking)

1. **`sync_v2_after_save` could filter empty passwords to `None`** before calling `sync_row_to_v2`. As-is, it passes `Some("")` through and the downstream `if !password.is_empty()` check absorbs it. Cosmetic; current behaviour is correct.
2. **`bootstrap_conn_v2` opens a second DB handle** rather than reusing the AppState one. Intentional (migrate_all needs a raw `&SqliteConnection`), but it means migrate_all and the very-first user save could race on `connections_v2`. SQLite WAL/locks handle this safely; just noting the read-after-write semantics.
3. **`sync_does_not_touch_legacy_secret_or_row` only verifies the legacy DB row** — a complete invariant test would also seed a legacy keychain entry and assert it survives. Acceptable: a code-level grep confirms migration.rs never calls `keychain::delete_password`, and `secrets::` only writes to v2 slots.
4. **`AppState::set_connection_secrets` uses `.unwrap()` on the mutex lock.** A poisoned mutex here would mean a previous panic happened mid-set — defensible to propagate, but a one-line comment matching `MemStore::locked`'s "panic = unrecoverable" rationale would help future readers.

### Result

**Stage 1: PASS · Stage 2: PASS · 0 blocking · 4 minor findings.**

The wire-name fix (5994f34) closes the cross-task coordination concern raised in Task 6. The Phase-2 hardening items now live as tracked docstrings in `secrets.rs`. Task 11 wires the legacy→v2 sync end-to-end without touching a single legacy code path. Task 12 (IPC + frontend bindings) is the next unlock; Task 13 is manual QA.
