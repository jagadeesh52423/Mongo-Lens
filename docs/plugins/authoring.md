# Writing a Mongo Lens Plugin (v1)

A Mongo Lens plugin is a folder with a `manifest.json` and a JS entry that exports `activate(context)`.

## Hello, plugin

Folder layout:

```
my-plugin/
  ├── manifest.json
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
