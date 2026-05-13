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
| `core.required-config` | All keys in `configuration.required` are set | warning, or error if `activation.requireConfig: true` | Fill in the missing fields in the Settings section. |

**Severities:**

- **`error`** — the plugin cannot be enabled until you fix it. The Enable button is disabled and the failure message appears on the detail pane.
- **`warning`** — the plugin can still be enabled, but the ⚠ badge stays in the list until you fix it.

**README content.** Rendered on the plugin's detail pane as sanitized markdown. Headings, lists, code blocks, tables, and intra-document anchor links (`[section](#section)`) are supported. **Images, external links (`http(s):`, `mailto:`, etc.), `<script>`, `<style>`, inline event handlers, and `<form>` are stripped** — README content ships with untrusted plugin code, so the host treats it as untrusted text.

Write your README assuming it will be the first thing a user sees when they click on your plugin in Settings.

### Plugin icon (optional)

Drop one of `icon.svg`, `icon.png`, `logo.svg`, or `logo.png` at the plugin root and the host will render it in the activity bar rail in place of the first-letter fallback. Probed in that order; first match wins. Square assets sized for ~22×22 display work best.

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

## Configuration (`contributes.configuration`)

Declare a JSON Schema describing your settings. The host renders a form in the
plugin's detail pane (and a dedicated route accessible from "Configure…"), users
fill it in, and your plugin reads values via `mongolens.config.*`.

```json
"contributes": {
  "configuration": {
    "title": "My Plugin",
    "properties": {
      "myplugin.apiUrl":   { "type": "string",  "title": "API URL", "format": "uri" },
      "myplugin.username": { "type": "string",  "title": "Username", "minLength": 1 },
      "myplugin.password": { "type": "string",  "title": "Password", "x-secret": true },
      "myplugin.timeout":  { "type": "integer", "title": "Timeout", "default": 30, "minimum": 0, "maximum": 300 }
    },
    "required": ["myplugin.apiUrl", "myplugin.username", "myplugin.password"]
  }
}
```

**Supported keywords:** `type` (`string` / `number` / `integer` / `boolean` /
`array` / `object`), `title`, `description`, `default`, `enum`, `minimum`,
`maximum`, `minLength`, `maxLength`, `pattern`, `format`, `items` (for arrays),
`properties` / `required` (for objects), and `x-secret: true` on strings.
Anything else is rejected at install time.

### `x-secret`

Adding `"x-secret": true` to a string property routes the value through the OS
keychain. The form renders a password input with a reveal toggle. The plugin
must also declare `secrets:read` in `permissions` if it needs to read the value.

### Required configuration

If your plugin truly cannot function without certain settings (e.g. an API
endpoint), list them in `configuration.required`. By default this produces a
warning in the plugin's detail pane. To **block activation** until they are
set, also declare:

```json
"activation": { "requireConfig": true }
```

The Enable button is disabled and a finding shows the user what's missing.

### Plugin API

```ts
// At activate(), capture the API once (see "Capture mongolens once" above).
const { get, getAll, set, onDidChange } = mongolens.config;

const apiUrl   = await get<string>('myplugin.apiUrl');
const username = await get<string>('myplugin.username');
const password = await get<string>('myplugin.password');   // requires secrets:read

context.subscriptions.push(onDidChange(async ({ keys }) => {
  if (keys.some(k => k.startsWith('myplugin.'))) {
    // re-read values and rebuild whatever depends on them
  }
}));
```

- `get` returns the schema default when nothing is stored.
- `set` validates against the schema; throws on failure. Use it for migration
  or "Reset to defaults" UX; ordinary edits flow through the host form.
- `onDidChange` fires **once per Save** with the keys that actually changed.
  Secret values are omitted from the event payload unless the plugin has
  `secrets:read`.

### Saving and undo

The form uses explicit **Save** / **Cancel**. While editing, ⌘Z / ⌘⇧Z (or
Ctrl+Z / Ctrl+Y) walks back and forward through field commits across the
whole form. Stacks clear on Save and Cancel.

## Cleanup

Everything you allocate (commands, view providers, listeners) returns a `Disposable`. Push it into `context.subscriptions` and the host disposes it on deactivate/uninstall/reload.

## What's coming in Part 2

- `@mongolens/plugin-api` published on npm with full TypeScript types.
- `create-mongolens-plugin` scaffolder.
- Dev mode with hot reload.
- An in-app **Plugin Console** showing your plugin's logger output and permission-broker decisions.
