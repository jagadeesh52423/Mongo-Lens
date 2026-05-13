# Writing a Mongo Lens Plugin (v1)

A Mongo Lens plugin is a folder with a `manifest.json` and a JS entry that exports `activate(context)`.

## Hello, plugin

Folder layout:

```
my-plugin/
  ├── manifest.json
  ├── README.md
  └── dist/main.js
```

`manifest.json`:

```json
{
  "id": "yourname.hello",
  "name": "Hello Plugin",
  "version": "1.0.0",
  "engines": { "mongolens": "^1.0.0" },
  "main": "dist/main.js",
  "permissions": [],
  "activationEvents": ["onCommand:hello.say"],
  "contributes": {
    "commands": [{ "id": "hello.say", "title": "Say Hello" }]
  }
}
```

`dist/main.js`:

```js
export function activate(context) {
  const d = mongolens.commands.register('hello.say', () => 'Hello, Mongo Lens!');
  context.subscriptions.push(d);
}
```

> ⚠️ **Capture `mongolens` once at the top of `activate()`.** The global
> `mongolens` binding is only guaranteed to exist *during* `activate()`. Any
> callback that fires later (view render, command handler, async work) must
> use a closure-captured reference, not re-resolve `mongolens` each call.
>
> ```js
> export function activate(context) {
>   const ml = mongolens;          // capture once
>   const conns = ml.connections;  // optionally narrow per-namespace
>
>   ml.views.register({
>     id: 'my.view', title: 'My View', location: 'sidebar',
>     render(container) {
>       // BAD: () => mongolens.connections.list()  — ReferenceError later
>       // GOOD:
>       return renderInto(container, () => conns.list());
>     },
>   });
> }
> ```
>
> The host plans to keep `globalThis.mongolens` alive for the plugin's full
> lifetime in a future release; until then, capture explicitly.

## Required files & enforcement rules

Every plugin is checked against a set of enforcement rules at discovery. Findings appear in **Settings → Plugins** beside the plugin and on its detail pane.

| Rule id | Required file / check | Severity | Fix |
|---------|----------------------|----------|-----|
| `core.readme-present` | `README.md` at plugin root, non-empty | warning | Add a `README.md` describing what your plugin does, how to enable it, and any permissions it requests. |

**Severities:**

- **`error`** — the plugin cannot be enabled until you fix it. The Enable button is disabled and the failure message appears on the detail pane.
- **`warning`** — the plugin can still be enabled, but the ⚠ badge stays in the list until you fix it.

**README content.** Rendered on the plugin's detail pane as sanitized markdown. Headings, lists, code blocks, tables, and intra-document anchor links (`[section](#section)`) are supported. **Images, external links (`http(s):`, `mailto:`, etc.), `<script>`, `<style>`, inline event handlers, and `<form>` are stripped** — README content ships with untrusted plugin code, so the host treats it as untrusted text.

Write your README assuming it will be the first thing a user sees when they click on your plugin in Settings.

## Install

- Open Mongo Lens → Settings → Plugins → **Install from folder…**
- Pick your `my-plugin/` directory.
- Approve any permissions in the consent dialog.
- The plugin is now installed at `~/.mongomacapp/plugins/yourname.hello/`.

## Run

Trigger your command (palette, key binding, or programmatically). The host activates your plugin on first trigger; your `activate()` runs and registers handlers.

## Extension points (v1)

| Surface | Manifest key | API |
|---------|-------------|-----|
| Commands | `contributes.commands` | `mongolens.commands.register(id, fn)` |
| Keybindings | `contributes.keybindings` | — declarative only |
| Views | `contributes.views` | `mongolens.views.register(provider)` |
| Result viewers | `contributes.resultViewers` | `mongolens.resultViewers.register(v)` |
| Execution modes | `contributes.executionModes` | `mongolens.executionModes.register(m)` |
| AI tools | `contributes.aiTools` | `mongolens.aiTools.register(t)` |
| Connection providers | `contributes.connectionProviders` | `mongolens.connectionProviders.register(p)` |
| Themes | `contributes.themes` | — declarative only |
| Export targets | `contributes.exportTargets` | `mongolens.exportTargets.register(t)` |

## Permission scopes (v1)

- `database:read`, `database:write`
- `network:fetch:<url-pattern>` — host glob, e.g. `network:fetch:https://*.acme.com`
- `secrets:read`, `secrets:write`
- `workspace:read`, `workspace:write`

Unknown scopes fail validation at install time.

## Cleanup

Everything you allocate (commands, view providers, listeners) returns a `Disposable`. Push it into `context.subscriptions` and the host disposes it on deactivate/uninstall/reload.

## What's coming in Part 2

- `@mongolens/plugin-api` published on npm with full TypeScript types.
- `create-mongolens-plugin` scaffolder.
- Dev mode with hot reload.
- An in-app **Plugin Console** showing your plugin's logger output and permission-broker decisions.
