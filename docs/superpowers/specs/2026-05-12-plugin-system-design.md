# Mongo Lens Plugin System — Design Spec

**Date:** 2026-05-12
**Status:** Approved (brainstorming)
**Scope:** Plugin architecture, first-class extension points, local install + dev-mode flow. Marketplace, signing, and auto-update are deliberately out of scope and tracked as follow-ups.

---

## 1. Goals & Non-Goals

### Goals
- Let external developers extend Mongo Lens through a stable, versioned API — VS Code style.
- Cover a broad initial extension surface: commands, keybindings, views, result viewers, execution modes, AI tools, connection providers, themes, export targets.
- Lazy activation — installed plugins must not slow app startup.
- Declared, user-approved permissions for any access to database, network, or secrets.
- Open/Closed: adding a new extension point requires only a new registry, no edits to existing code or installed plugins.
- First-class developer experience: TypeScript types, a `create-mongolens-plugin` scaffolder, and an in-app "Load Unpacked Plugin" dev mode with hot reload.

### Non-Goals (v1)
- Plugin marketplace, discovery feed, ratings.
- Code signing or publisher verification.
- Auto-update of installed plugins.
- WASM / non-JS plugin runtimes.
- Cross-process or sidecar plugin runtimes.
- Mobile/web targets — macOS desktop only.

---

## 2. Top-Level Architecture

```
┌─────────────────────── Mongo Lens (Tauri renderer) ───────────────────────┐
│                                                                             │
│  ┌──────────────────┐    ┌────────────────────────────────────────────┐   │
│  │  PluginManager   │───▶│  Contribution Registries (Registry<T>)      │   │
│  │  discover/install│    │  ─ CommandRegistry                          │   │
│  │  enable/disable  │    │  ─ KeybindingRegistry                       │   │
│  │  activate        │    │  ─ ViewRegistry                             │   │
│  │  dispose         │    │  ─ ResultViewerRegistry                     │   │
│  └─────────┬────────┘    │  ─ ExecutionModeRegistry                    │   │
│            │             │  ─ AIToolRegistry                            │   │
│            │             │  ─ ConnectionProviderRegistry                │   │
│            │             │  ─ ThemeRegistry                             │   │
│            │             │  ─ ExportTargetRegistry                      │   │
│            │             └────────────────────────────────────────────┘   │
│            ▼                                                                 │
│  ┌──────────────────┐    ┌────────────────────────────────────────────┐   │
│  │ PermissionBroker │◀───│  `mongolens` API (injected per plugin)      │   │
│  └──────────────────┘    └────────────────────────────────────────────┘   │
│            ▲                                  ▲                              │
│            │                                  │ activate(context)            │
│  ┌─────────┴────────┐    ┌──────────────────┴───────────────────────┐    │
│  │  Host services   │    │  Plugin module scope (per-plugin)         │    │
│  │  (DB, net, ui,   │    │   ─ dynamic import of dist/main.js        │    │
│  │   secrets, log)  │    │   ─ no window/fetch/__TAURI__ in scope    │    │
│  └──────────────────┘    └──────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

Disk:  ~/.mongomacapp/plugins/<plugin-id>/{manifest.json, dist/main.js, ...}
```

- `PluginManager` owns lifecycle. It is the only component that imports plugin code.
- Each extension point is its own `Registry<T>` implementing a shared interface (see §5). New extension points are added by dropping in a new registry — no other code changes.
- The `mongolens` namespace is generated from the registry set. Anything that touches DB/network/secrets routes through `PermissionBroker`.
- Plugins run in the renderer process but in a per-plugin module scope where ambient globals (`window`, `fetch`, `localStorage`, the Tauri `__TAURI__` bridge) are not in lexical scope. The only escape hatch is the `mongolens` API.

### On-disk layout
```
~/.mongomacapp/plugins/
  └── <plugin-id>/
        ├── manifest.json
        ├── dist/main.js          # entry, imported lazily on activation
        ├── package.json          # informational; not used at runtime
        └── .data/                # per-plugin private storage (ExtensionContext.storagePath)
```

---

## 3. Manifest (`manifest.json`)

```jsonc
{
  "id": "acme.schema-viz",                  // globally unique, "<publisher>.<name>"
  "name": "Schema Visualizer",
  "version": "1.2.0",                       // semver
  "engines": { "mongolens": "^1.0.0" },     // host API range this plugin targets
  "main": "dist/main.js",                   // entry; exports activate / deactivate

  "permissions": [
    "database:read",
    "network:fetch:https://*.acme.com"
  ],

  "activationEvents": [
    "onCommand:schemaViz.open",
    "onView:schemaViz.panel",
    "onStartup"
  ],

  "contributes": {
    "commands":            [ { "id": "schemaViz.open", "title": "Open Schema Viz", "category": "Schema" } ],
    "keybindings":         [ { "command": "schemaViz.open", "mac": "cmd+shift+g" } ],
    "views":               [ { "id": "schemaViz.panel", "title": "Schema", "location": "sidebar" } ],
    "resultViewers":       [ { "id": "schemaViz.tree", "title": "Tree", "when": "result.isArray" } ],
    "executionModes":      [ { "id": "schemaViz.dryRun", "title": "Dry Run" } ],
    "aiTools":             [ { "id": "schemaViz.inferTypes", "schema": "tools/inferTypes.json" } ],
    "connectionProviders": [ { "id": "vaultMongo", "title": "Vault-backed Mongo" } ],
    "themes":              [ { "id": "acme-dark", "path": "themes/dark.json" } ],
    "exportTargets":       [ { "id": "s3", "title": "Amazon S3", "formats": ["json","csv"] } ]
  }
}
```

### Rules
- `contributes` is **purely metadata** — host reads it without executing plugin code, so commands, keybindings, and views appear in UI before the plugin ever activates.
- `activationEvents` decide *when* `main.js` is imported. Supported triggers in v1: `onCommand:<id>`, `onView:<id>`, `onExecutionMode:<id>`, `onConnectionProvider:<id>`, `onExportTarget:<id>`, `onStartup`.
- `permissions` is a closed vocabulary; unknown scopes fail validation at install time. v1 vocabulary:
  - `database:read`, `database:write`
  - `network:fetch:<url-pattern>` (RFC 6570-style host glob; `*` allowed in host only)
  - `secrets:read`, `secrets:write` (scoped to the plugin's own namespace)
  - `workspace:read`, `workspace:write` (open scripts, saved scripts)
- Manifests are validated against a JSON Schema (shipped under `src/plugins/schema/manifest.schema.json`). Invalid manifests are surfaced in the Plugins UI as "broken" and never activated.

---

## 4. Plugin Runtime Contract

### Entry shape
```ts
export function activate(context: ExtensionContext): void | Promise<void>;
export function deactivate?(): void | Promise<void>;
```

### `ExtensionContext`
```ts
interface ExtensionContext {
  pluginId: string;
  storagePath: string;          // ~/.mongomacapp/plugins/<id>/.data
  subscriptions: Disposable[];  // push everything you allocate here
  secrets: SecretStorage;       // per-plugin namespace; gated by `secrets:*`
  logger: Logger;               // structured; routed to ~/.mongomacapp/logs/
}

interface Disposable { dispose(): void | Promise<void>; }
```

### The `mongolens` namespace (registry mirror)
```ts
mongolens.commands.register(id, handler): Disposable
mongolens.commands.execute(id, ...args): Promise<unknown>

mongolens.views.registerProvider(id, provider): Disposable
mongolens.resultViewers.register(id, viewer): Disposable
mongolens.executionModes.register(id, mode): Disposable
mongolens.aiTools.register(id, tool): Disposable
mongolens.connectionProviders.register(id, provider): Disposable
mongolens.themes.register(id, theme): Disposable
mongolens.exportTargets.register(id, target): Disposable

mongolens.workspace.activeConnection      // read-only snapshot
mongolens.workspace.activeScript          // read-only snapshot
mongolens.workspace.onDidChangeResults(listener): Disposable
mongolens.workspace.onDidChangeConnection(listener): Disposable

mongolens.db.find(coll, filter, opts?)    // gated: database:read
mongolens.db.run(command)                  // gated: database:write
mongolens.net.fetch(url, init?)            // gated: network:fetch:<pattern>
mongolens.ui.showMessage(level, text, actions?)
mongolens.ui.prompt(spec)
```

### Contracts for each contribution
- `ResultViewer { match(result): boolean; render(container: HTMLElement, ctx: ResultContext): Disposable }`
- `ViewProvider  { render(container: HTMLElement, ctx: ViewContext): Disposable }`
- `ExecutionMode { id; title; run(script: string, ctx: ExecCtx): AsyncIterable<ExecEvent> }`
- `AITool        { schema: JSONSchema; invoke(args, ctx): Promise<unknown> }`
- `ConnectionProvider { id; createConfig(ui): Promise<ConnectionConfig>; connect(cfg): Promise<DriverHandle> }`
- `ExportTarget  { id; formats: string[]; export(rows, format, ctx): Promise<void> }`

### Non-negotiable rules
1. **All registrations return `Disposable`.** Host disposes everything in `context.subscriptions` on deactivate/uninstall/reload.
2. **All side-effect APIs go through `PermissionBroker`.** Plugin code cannot reach `fetch`, `localStorage`, or the Tauri IPC directly — those identifiers are stripped from the plugin's module scope.
3. **No globals leak between plugins.** Each plugin gets its own module scope and its own `mongolens` binding.

### API surface delivery
Types ship as `@mongolens/plugin-api` on npm. The scaffolder depends on it; authors import only types, never runtime code (the host injects `mongolens` at activation).

---

## 5. Registry Abstraction (OCP guarantee)

```ts
interface Registry<T extends { id: string }> {
  register(item: T, ownerPluginId: string): Disposable;
  get(id: string): T | undefined;
  list(): readonly T[];
  onDidChange(listener: () => void): Disposable;
}
```

- Every extension point has exactly one registry instance.
- The host exposes registries on `mongolens.<name>` via a generated facade so the public API surface mirrors the registry set automatically.
- **Adding a new extension point**: implement `Registry<T>` for the new type, instantiate it in `PluginManager`, expose it on `mongolens`, document the contract. No edits to existing registries, no edits to installed plugins. This is the explicit OCP contract for the system.
- Built-in app features (the existing `smart` / `full-script` execution modes, the JSON/Table result viewers, the built-in themes) register themselves through the same registries at app startup, so plugins and core code share one mechanism.

---

## 6. Lifecycle

### 6.1 Discovery
On startup, `PluginManager` scans `~/.mongomacapp/plugins/*/manifest.json`, validates each manifest against the JSON Schema, checks `engines.mongolens` against the host's API version, and registers each plugin's `contributes` block with the relevant registries. **No plugin JS is imported at this stage.**

### 6.2 Install
Two paths:
1. **Folder install** — Settings → Plugins → "Install from Folder" → user picks a directory. Host validates the manifest, copies the tree to `~/.mongomacapp/plugins/<id>/`, shows the permission consent dialog, persists grants, registers contributions.
2. **Dev mode** — Settings → Plugins → "Load Unpacked Plugin" → user picks a directory which the host references *in place* (no copy). Host watches files; on change it deactivates, re-imports `main.js`, and re-activates.

### 6.3 Permission consent
- Before first activation (and on any change to the `permissions` array between versions), host shows a modal listing each requested scope in human-readable form. User must approve to proceed.
- Grants persist in `settings.json` under `plugins.<id>.grants`.
- Plugins can be installed but left ungranted; they stay in a "permission pending" state and do not activate.

### 6.4 Activation
- When an activation event fires (user runs a contributed command, opens a contributed view, app startup for `onStartup`, etc.), host:
  1. Builds the plugin's `ExtensionContext` and per-plugin `mongolens` facade.
  2. `import()`s `main.js` once per session.
  3. `await activate(context)` inside the sandbox wrapper.
  4. Marks the plugin active.
- `onStartup` plugins activate after the main UI is interactive, not before — startup is never blocked by plugin code.

### 6.5 Deactivation / uninstall / reload
- **Deactivate**: call `deactivate()` (best-effort, 2s budget), then dispose every entry in `context.subscriptions`.
- **Uninstall**: deactivate → delete folder → drop grants → drop contributions from registries.
- **Disable**: deactivate + drop contributions; folder and grants kept so re-enable is instant.
- **Reload** (dev mode): deactivate → re-import → activate.

### 6.6 Versioning
- The host advertises a single API semver (e.g. `1.0.0`). Plugins declare a range in `engines.mongolens`.
- Mismatch → plugin shown in UI as "incompatible," never activated. This lets the host evolve the API without silently breaking installed plugins.
- API changes follow strict semver: breaking changes bump the major.

---

## 7. Security & Error Isolation

### Trust model
- **Trust-on-install + declared permissions.** Installing a plugin authorizes its declared scopes. The user is the trust authority; the host enforces the declared scope vocabulary.
- Plugins from disk are treated as untrusted code until grants are recorded.

### Enforcement
- `PermissionBroker` wraps every API method that touches DB, network, secrets, or workspace mutation. Calls are rejected with `PermissionDeniedError` if the corresponding scope isn't granted.
- `network:fetch:<pattern>` is checked against the requested URL host with strict glob matching; non-matching hosts are refused.
- Plugin module scope omits `window`, `document` writes outside the plugin's allocated container, `fetch`, `XMLHttpRequest`, `localStorage`, `indexedDB`, and the Tauri `__TAURI__` global. The only host channel is `mongolens`.

### Error isolation
- Every host→plugin call (activate, command handler, viewer render, listener, AI tool invoke) is wrapped in:
  ```ts
  runInPluginSandbox(pluginId, async () => { ... })
  ```
  which catches throws/rejections, routes them to the plugin logger plus a non-blocking UI toast, and never propagates to the host.
- ≥3 consecutive activation failures auto-disable the plugin with a clear notification and a "Try again" action.
- A plugin throwing inside a render callback is unmounted but the rest of the UI is unaffected.

### Audit
- Every permission-gated call is logged with `pluginId`, scope, target, and outcome to `~/.mongomacapp/logs/plugins.log`. Users can review and revoke grants from the Plugins UI.

---

## 8. Developer Experience

### Types
`@mongolens/plugin-api` on npm — TypeScript declarations for `ExtensionContext`, `mongolens`, every registry contract, and the manifest schema. No runtime code.

### Scaffolder
`npx create-mongolens-plugin <name>` generates:
```
my-plugin/
  ├── manifest.json           # pre-filled with id placeholders
  ├── package.json            # depends on @mongolens/plugin-api
  ├── tsconfig.json
  ├── vite.config.ts          # builds dist/main.js as ESM
  └── src/main.ts             # sample activate() registering a command
```

### In-app dev mode
- Settings → Plugins → "Load Unpacked Plugin" loads a folder in place.
- Host watches `manifest.json` and the `dist/` output; on change → deactivate → re-import → activate.
- A "Plugin Console" panel shows the plugin's logger output and permission-broker decisions in real time.

---

## 9. Internal Code Layout (new modules)

```
src/plugins/
  ├── PluginManager.ts          # lifecycle owner
  ├── PermissionBroker.ts       # scope enforcement
  ├── Registry.ts               # Registry<T> interface + base class
  ├── api/
  │     ├── createMongolens.ts  # per-plugin facade builder
  │     ├── contracts.ts        # ResultViewer, ViewProvider, etc.
  │     └── disposable.ts
  ├── registries/
  │     ├── CommandRegistry.ts
  │     ├── KeybindingRegistry.ts
  │     ├── ViewRegistry.ts
  │     ├── ResultViewerRegistry.ts
  │     ├── ExecutionModeRegistry.ts        # built-in modes register here too
  │     ├── AIToolRegistry.ts
  │     ├── ConnectionProviderRegistry.ts
  │     ├── ThemeRegistry.ts
  │     └── ExportTargetRegistry.ts
  ├── schema/
  │     └── manifest.schema.json
  ├── sandbox/
  │     ├── runInPluginSandbox.ts
  │     └── moduleLoader.ts                  # dynamic import + scope scrubbing
  └── ui/
        ├── PluginsSettingsPane.tsx
        ├── PermissionConsentDialog.tsx
        └── PluginConsolePanel.tsx
```

Existing `src/execution-modes/registry.ts` is generalized into `ExecutionModeRegistry` and re-homed here; the existing `smart` and `full-script` modes register through it on startup. This is the only existing-code touch — everything else is additive.

---

## 10. Risks & Open Questions

- **Renderer-process trust boundary is weak.** Scope-scrubbing the module environment raises the bar but is not a true sandbox; a determined plugin could still escape. Acceptable for v1 given the trust-on-install model, but the consent dialog must surface this honestly.
- **API stability cost.** Every method on `mongolens` is a long-lived public contract. The registry facade pattern helps, but additions still need API review.
- **Conflict resolution.** Two plugins registering the same `command.id` or claiming the same keybinding — first-wins with a UI warning in v1; richer resolution is a follow-up.
- **Performance budget for `onStartup` plugins** — needs a watchdog. Auto-disable on ≥3 startup failures covers crashes but not slow-but-passing plugins; a soft timeout warning is a v1.x candidate.

---

## 11. Out of Scope (Follow-ups)

- Plugin marketplace + discovery feed.
- Publisher signing and identity verification.
- Auto-update of installed plugins.
- True sandboxing (Web Worker / iframe / WASM runtimes).
- Cross-plugin dependencies / shared libraries.
- Localization of plugin manifests.
