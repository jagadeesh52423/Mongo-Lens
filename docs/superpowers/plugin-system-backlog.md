# Plugin System Backlog

Deferred follow-ups discovered while shipping the plugin host, DataFleet plugin, and activity bar. Each item names the discovery context and proposes a minimum-viable fix. Items are not prioritised here — pull when their pain becomes the top one.

---

## H-1. Keep `globalThis.mongolens` alive for the plugin's lifetime

**Discovered:** 2026-05-13, while running the DataFleet plugin. Plugin's `render(container)` callback hit `ReferenceError: Can't find variable: mongolens` because `globalThis.mongolens` is injected only during `activate()` and deleted on completion (`src/plugins/PluginManager.ts` `finally` block).

**Why it matters:** Plugins reasonably reference `mongolens.xxx` from any callback they register (view renderers, command handlers, async fetches). The current contract — "capture references once at activate-time, never read `mongolens` again" — is a foot-gun and isn't enforced by types. Every plugin author will eventually trip on it.

**Today's workaround:** plugins capture `const ml = mongolens;` at the top of `activate()` and use the local binding everywhere. Documented in `docs/plugins/authoring.md`.

**Proposed fix:** keep `globalThis.mongolens` set for the *active lifetime* of a plugin, not just for its `activate()` call. Delete only on deactivate/uninstall.

Complication: only one plugin's API can be at `globalThis.mongolens` at a time, but more than one plugin can be active simultaneously (post-activate, their callbacks run on demand). A naive "leave it set" approach picks whichever plugin activated *last*, which is silently wrong for the others. Two real fixes:

1. **Per-call injection.** Wrap each registered handler (commands, views, etc.) so the host swaps `globalThis.mongolens` to the right plugin's API for the duration of that call. Adds host overhead per dispatch but makes plugins agnostic to lifecycle.

2. **Migrate to `activate(context)` pattern.** Pass the API as `context.mongolens` instead of relying on a global. Document `mongolens` as a *startup convenience* available only during `activate()`. Cheap to implement but breaks every existing plugin's view/command callbacks.

Recommendation: do (1) — the per-handler wrap is local to `PluginManager` + the registries' dispatch sites, doesn't touch plugin code, and matches what plugin authors expect.

**Acceptance:** the DataFleet plugin's `extension.ts` could revert to `() => mongolens.connections.list()` arrow-style callbacks and still work.

**Estimated size:** 1–2 days of focused work + a careful review (touches the sandbox layer).

---

## H-2. Manifest validation `additionalProperties: false` at the top level rejects `$schema`

**Discovered:** 2026-05-13 during DataFleet install. The plugin's `manifest.json` originally carried a `$schema` hint pointing at the local schema — common in JSON tooling for IDE autocomplete. The host's manifest schema sets `additionalProperties: false` on the root object, so `$schema` is rejected with "must NOT have additional properties".

**Why it matters:** Plugin authors who use JSON Schema-aware editors (VS Code, JetBrains) will want `$schema` for autocompletion. Rejecting it costs nothing in safety and hurts DX.

**Proposed fix:** in `src/plugins/schema/manifest.schema.json`, either allow `$schema` explicitly:

```json
"properties": { "$schema": { "type": "string" }, ... }
```

or drop `additionalProperties: false` at the root (keep it on nested objects).

**Estimated size:** 15 minutes.

---

## H-3. Plugin installer copies the entire source folder, including `node_modules/`

**Discovered:** 2026-05-13, install of DataFleet's dev folder failed with "forbidden path … node_modules/define-data-property/.eslintrc" because Tauri's fs scope rejected dotfiles.

**Why it matters:** A plugin's runtime needs only `manifest.json` + `dist/extension.js`. Shipping `node_modules/` is wasteful (megabytes), insecure (every transitive dep's source readable from disk), and trips fs-scope dotfile restrictions. The workaround today is a separate `…-deploy/` folder; that's clunky and error-prone.

**Proposed fix:** Either:

1. Installer reads `manifest.json` first, then copies *only* the files referenced by `main` + any declared `assets` (a new manifest field).
2. Installer honours a `.mongolensignore` file in the plugin folder (gitignore-style) so authors can exclude dev-only artefacts.

(1) is cleaner; (2) is more familiar. Probably (1).

**Estimated size:** 1 day in `src/plugins/PluginManager.install`.

---

## H-4. Source-map directives in plugin bundles cause devtools 404s

**Discovered:** 2026-05-13. Plugins loaded via blob URL have a `//# sourceMappingURL=extension.js.map` directive that can't be resolved relative to a blob URL, producing devtools-only 404 errors.

**Why it matters:** Cosmetic — three console errors per plugin activation. Doesn't break anything but obscures real errors.

**Proposed fix:** Host can either strip the sourceMappingURL line before passing the source to the blob loader, or inline an `Object URL` for the map. Stripping is simpler.

Today's workaround: deploy script strips the line manually (see `~/OwnCode/MongoMacAppPlugins/datafleet/package.json`'s `deploy` script).

**Estimated size:** 30 minutes in `src/plugins/sandbox/moduleLoader.ts`.

---

## H-5. `SecretStorage` Keychain backend (was Part 2 backlog)

**Discovered:** Part 1 plugin system design. Carried forward.

Today, `InMemorySecretStorage` is the only backend wired. Plugin secrets are lost on restart. The DataFleet plugin re-prompts for LDAP creds every session because of this.

**Proposed fix:** Implement a `KeychainSecretStorage` backed by macOS Keychain (and OS-equivalents on other platforms), wire it into `App.tsx`'s plugin-host bootstrap, and gate selection behind a settings toggle for opt-out.

**Estimated size:** 2–3 days (mostly platform plumbing + permission prompts).

---

## H-6. `WorkspaceStore` persistence (was Part 2 backlog)

**Discovered:** Same as H-5.

Today, `InMemoryWorkspaceStore` is the only backend. Plugins lose all stored state on restart. DataFleet's saved-request history dies on every restart.

**Proposed fix:** A small persistent KV (Tauri `Store` or a SQLite-backed adapter — `Store` likely sufficient). Per-plugin file in `~/.mongomacapp/plugins/<id>/workspace.json` or a shared store keyed by `plugin:<id>:<key>`. Eviction policy is not needed at this scale.

**Estimated size:** 1 day.

---

## H-7. Plugin Console panel

**Discovered:** Same as H-5/H-6.

The audit broker is wired (`PermissionBroker.onAudit`) and emits useful events ("datafleet wrote password for connection X"), but nothing consumes them in the UI. Without a consumer, the audit log is invisible to users — they have no way to see what a plugin did.

**Proposed fix:** Add a built-in `ActivityItem` "Plugin Console" that subscribes to the audit broker and renders an append-only log. Could also surface plugin `console.log` output by intercepting the wrapped sandbox's console. The host now has an `ActivityRegistry` (activity-bar work), so the panel is just another `BuiltInActivityRegistry.add(...)` call.

**Estimated size:** 0.5 day for an MVP.

---

## H-8. `@mongolens/plugin-api` types package

**Discovered:** DataFleet plugin had to copy the `Mongolens` interface inline because there's no published types package.

**Why it matters:** Every plugin author re-derives the API shape from authoring.md, which inevitably drifts. A typed package gives autocompletion and breaks the build if the API moves.

**Proposed fix:** Publish (or just vendor as a local workspace package) the API contract types from `src/plugins/api/contracts.ts` minus host-internal helpers.

**Estimated size:** 0.5 day to extract; 1 day to publish.

---

## H-9. `create-mongolens-plugin` scaffolder

**Discovered:** Same as H-8.

**Why it matters:** Setting up a plugin folder requires copying `manifest.json` + `tsconfig.json` + `tsup.config.ts` + `package.json` from somewhere. A scaffolder (`npx create-mongolens-plugin my-plugin`) makes this two commands instead of fifteen.

**Estimated size:** 0.5 day.

---

## H-10. Dev-mode file watcher + hot reload

**Discovered:** Original Part 2 backlog.

Today, iterating on a plugin means: edit source → `npm run deploy` → uninstall + reinstall in app → reload renderer. A dev-mode hot reload that watches `dist/extension.js` and re-activates the plugin would cut this to: edit source → tsup auto-rebuilds → host re-activates.

**Estimated size:** 1–2 days (file watcher + plugin re-activation flow).

---

## Conventions

- Tag items `H-N` (H for "host backlog") for grep-ability.
- When pulling an item, link the spec/plan file you'll write for it (e.g. `→ docs/superpowers/specs/2026-MM-DD-globalthis-lifecycle-design.md`).
- When finished, leave the item with a "**Resolved by:** `<commit-sha>`" line rather than deleting it — gives future readers the history.
