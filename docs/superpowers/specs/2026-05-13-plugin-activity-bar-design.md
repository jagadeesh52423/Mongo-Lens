# Plugin Activity Bar — Design Spec

**Date:** 2026-05-13
**Status:** Draft
**Type:** Host UI change (no plugin-API breakage)

## 1. Goal

Make `ViewProvider` contributions (`location: 'sidebar'`) discovered through `mongolens.views.register(...)` actually appear and render inside Mongo Lens. Today the registry accepts registrations but nothing consumes them, so an active plugin with a registered view is invisible. After this change, plugin views show up as peers of the existing Connections / Saved Scripts panels in the same activity bar.

## 2. Non-functional requirement: plugin-agnostic host

**The host must contain no traces of any specific plugin.** No string `'datafleet'`, no hardcoded id, no special-case branch keyed by plugin id. The activity bar reads from a generic `ActivityRegistry`; plugins drive themselves entirely through the existing `mongolens.views.register(...)` API plus their manifest. Anything DataFleet-specific lives in the DataFleet plugin folder, not in `src/`.

This is verified at review time by a grep: `grep -rn -i "datafleet\|<other plugin id>" src/` must return nothing.

## 3. Scope

**In.**
- A new `ActivityRegistry` abstraction with three implementations (BuiltIn, Plugin, Composite).
- Rewrite of `IconRail` and `SidePanel` to consume `ActivityItem`s instead of a hard-coded `PanelKey` union.
- Built-in re-registration of Connections + Saved Scripts panels through the same interface plugins use.
- Optional `icon` field on view contributions (manifest schema + `ViewProvider` type).
- Persistence of the active panel id across restarts.
- Graceful fallback when the persisted id is missing (plugin uninstalled / not yet activated).

**Out (explicitly).**
- `location: 'panel'` views — no consumer yet.
- View containers (multiple plugin views grouped under one icon). One icon per view is intentional.
- Drag-to-reorder activity items.
- "Click active icon to collapse the side panel."
- SVG/PNG plugin icons. Manifest strings only (max 4 chars, typically emoji).
- Moving Connections / Saved Scripts into the plugin model. They are built-ins, registered through the same interface, but live in the host.

## 4. Architecture

### 4.1 The `ActivityRegistry` contract

New module `src/layout/activityBar.ts`:

```ts
export interface ActivityItem {
  id: string;
  title: string;
  icon: string;              // 1–4 char string (emoji or label)
  render(container: HTMLElement): { dispose(): void };
}

export interface ActivityRegistry {
  list(): ActivityItem[];
  onDidChange(cb: () => void): { dispose(): void };
}
```

### 4.2 Three implementations

**`BuiltInActivityRegistry`** — pure in-memory list with `add(item)` and `onDidChange`. Mongo Lens registers Connections + Saved Scripts into it at app boot. Adding a new built-in panel becomes a one-line registration; no switch-statement edits.

**`PluginActivityRegistry`** — adapter around the existing `registries.views` (the `Registry<ViewProvider>` from `src/plugins/registries.ts`). `list()` returns `views.list().filter(v => v.location === 'sidebar').map(toActivityItem)`. `onDidChange` proxies the registry's existing change stream. `toActivityItem` builds an `ActivityItem` whose `icon` comes from (priority order): the `register()` call's `icon` field, then the manifest contribution's `icon`, then `title[0].toUpperCase()` as fallback. `render(container)` calls `viewProvider.render(container, ctx)` and forwards the disposable.

**`CompositeActivityRegistry`** — accepts an ordered list of child registries; `list()` concatenates their lists; `onDidChange` subscribes to all children and re-emits. Order: built-ins first, then plugins. Within plugins, insertion order (the registry's existing semantics).

### 4.3 Wiring at boot

In `App.tsx`:

```ts
const builtIns = new BuiltInActivityRegistry();
builtIns.add({ id: 'connections', title: 'Connections', icon: '⚡', render: renderConnections });
builtIns.add({ id: 'saved',       title: 'Saved Scripts', icon: '⭐', render: renderSavedScripts });

const pluginViews = new PluginActivityRegistry(pluginHost.registries.views);
const activityRegistry = new CompositeActivityRegistry([builtIns, pluginViews]);
```

`renderConnections` / `renderSavedScripts` wrap the existing React subtrees behind the `(container) => Disposable` interface:

```ts
function renderConnections(container: HTMLElement) {
  const root = createRoot(container);
  root.render(<ConnectionPanel />);
  return { dispose() { root.unmount(); } };
}
```

No new content, no logic moved — purely a wrapper.

## 5. UI changes

### 5.1 `IconRail` (rewrite)

Props become:

```ts
interface Props {
  items: ActivityItem[];
  activeId: string | null;
  onChange(id: string): void;
  onSettingsOpen(): void;
  settingsOpen: boolean;
}
```

The component subscribes to `ActivityRegistry.onDidChange` externally (`App.tsx` passes the latest `items` snapshot). Each item renders a 44px button identical to today's: `aria-label={item.title}`, border-left accent when `item.id === activeId && !settingsOpen`, body text `item.icon`. Logo top, Settings bottom — unchanged. The hard-coded `PanelKey` union is deleted from this file.

### 5.2 `SidePanel` (rewrite)

Props become:

```ts
interface Props { item: ActivityItem | null }
```

Header renders `item?.title`. Body is a `<div ref>` mounted on first render. On `item` change:

```ts
useEffect(() => {
  if (!item || !bodyRef.current) return;
  const disposable = item.render(bodyRef.current);
  return () => disposable.dispose();
}, [item?.id]);
```

If `item` is null (registry empty edge case), the body shows a small placeholder.

### 5.3 `App.tsx` changes

- Remove `<ConnectionPanel/>` and `<SavedScriptsPanel/>` JSX from the SidePanel-rendering block (those are now mounted through `ActivityItem.render`).
- Replace `useState<PanelKey>('connections')` with `useState<string | null>(...)` bootstrapped from `useSettingsStore`.
- The state setter writes back to the settings store on every change so the value persists.

## 6. Plugin contribution shape

### 6.1 Manifest schema

Modify `src/plugins/schema/manifest.schema.json` — the `views[]` item shape:

```json
{
  "type": "object",
  "required": ["id", "title", "location"],
  "additionalProperties": false,
  "properties": {
    "id":       { "type": "string" },
    "title":    { "type": "string" },
    "icon":     { "type": "string", "maxLength": 4 },
    "location": { "enum": ["sidebar", "panel"] }
  }
}
```

`icon` is optional. `maxLength: 4` permits emoji + 1-3 char text labels. Schema regex change is the only host-side manifest-validator update.

### 6.2 `ViewProvider` type

Extend `ViewProvider` in `src/plugins/api/contracts.ts`:

```ts
export interface ViewProvider {
  id: string;
  title: string;
  icon?: string;             // NEW
  location: 'sidebar' | 'panel';
  render(container: HTMLElement, ctx: ViewContext): Disposable;
}
```

Existing plugins continue to work — field is optional. The `PluginActivityRegistry` falls back to the manifest icon, then to `title[0]`.

### 6.3 Plugin manifest extension (in plugin repo, not host)

Plugins add `"icon": "..."` to their view contribution. The DataFleet plugin (lives outside this repo at `~/OwnCode/MongoMacAppPlugins/datafleet/`) will be updated separately. **This spec does not enumerate any specific plugin id in `src/`.**

## 7. Persistence

`useSettingsStore` gains one new key:

```ts
activeActivityItemId: string | null
```

Default: `null`. Persisted through the existing settings IPC (same path as other settings). On boot, `App.tsx` reads the value; the activity registry resolver does:

```ts
function resolveActive(items: ActivityItem[], persistedId: string | null): string | null {
  if (persistedId && items.some(i => i.id === persistedId)) return persistedId;
  return items[0]?.id ?? null;
}
```

Every `onDidChange` of the registry re-runs the resolver; if the previously-active id reappears (a plugin just activated), we **don't** auto-switch back. The resolver only changes the active id when the current one becomes invalid (plugin gone). This avoids flicker on plugin activation.

## 8. Lifecycle & error handling

| Event | Behavior |
|---|---|
| Plugin activates with `views.register({ location: 'sidebar', ... })` | `registries.views` fires `onDidChange` → `PluginActivityRegistry` fires `onDidChange` → IconRail re-renders → icon appears. |
| Plugin deactivates / uninstalls | `disposeAllForPlugin` removes the entry → registry fires `onDidChange` → IconRail re-renders without it. If that view was active, resolver picks the first remaining item. |
| `item.render(container)` throws | Caught in `SidePanel`'s effect; body renders "View failed to render: {message}". Icon stays. `disposable` is whatever `render` returned before the throw (or no-op). |
| `item.render` returns no `dispose()` | `SidePanel` wraps with a no-op. Logged once at debug level. |
| Persisted id missing at boot | Resolver falls back to first item (typically `connections`). Silent. |
| Persisted id is a plugin not yet active | Same — falls back. When the plugin activates later, the new icon appears; we do **not** auto-switch to it. |
| Registry empty (no built-ins registered — bug state) | `SidePanel` shows placeholder; Settings still reachable. |

## 9. File map

### 9.1 Host changes (this repo)

| File | Action | Notes |
|---|---|---|
| `src/layout/activityBar.ts` | Create | `ActivityItem`, `ActivityRegistry`, `BuiltInActivityRegistry`, `PluginActivityRegistry`, `CompositeActivityRegistry` |
| `src/layout/__tests__/activityBar.test.ts` | Create | Unit tests for all three registries + composite |
| `src/components/layout/IconRail.tsx` | Rewrite | Props become items-driven |
| `src/components/layout/SidePanel.tsx` | Rewrite | Props become item-driven with imperative render |
| `src/App.tsx` | Modify | Wire registries; remove hard-coded panel JSX; subscribe to changes; persist active id |
| `src/plugins/api/contracts.ts` | Modify | Add optional `icon` to `ViewProvider` |
| `src/plugins/schema/manifest.schema.json` | Modify | Add `icon` to view contribution |
| `src/plugins/PluginManager.ts` | Modify (minor) | Pass manifest's view icon through to the registered `ViewProvider` if `register()` call doesn't supply one |
| `src/store/settings.ts` (or whichever houses `useSettingsStore`) | Modify | New persisted key `activeActivityItemId` |
| `src/__tests__/IconRail.test.tsx`, `SidePanel.test.tsx` | Modify or create | Component-level tests |
| `src/__tests__/App.activity-bar.test.tsx` | Create | Boot + plugin add/remove integration |

No new dependencies. No Rust-side changes.

### 9.2 Out of repo (plugin authors)

Plugins update their own manifests to set `icon`. **This spec does not touch any plugin folder.**

## 10. Testing

### 10.1 Unit

- `BuiltInActivityRegistry`: `add()`, `list()` preserves insertion order, `onDidChange` fires on add/remove, double-add of same id is rejected.
- `PluginActivityRegistry` against a fake `Registry<ViewProvider>`: returns only `location: 'sidebar'`; icon priority (register > manifest > first letter); `onDidChange` proxied; entries vanish when the underlying registry disposes them.
- `CompositeActivityRegistry`: concatenation order, single `onDidChange` fan-in, child unsubscription on `dispose()`.
- Manifest schema: `icon` optional, accepted at length ≤ 4, rejected at length 5.
- Resolver: persisted-id present → returns it; missing → first item; null inputs → first item.

### 10.2 Component (Vitest + Testing Library)

- `IconRail`: renders one button per item, accent on active, `onChange` fired with item id, re-renders when items prop changes.
- `SidePanel`: calls `item.render(container)` on mount; calls `dispose()` then re-mounts on item change; renders error fallback when `render` throws.

### 10.3 Integration

- App boot with two built-ins → both icons present, Connections active by default.
- Activate a stub plugin that registers a sidebar view → third icon appears within one render cycle.
- Deactivate that plugin while its view is active → icon vanishes; active item falls back to Connections.
- Restart the app with persisted active id pointing at the stub plugin → boot shows Connections; once plugin activates, the icon appears but Connections stays active until user clicks.
- **`grep -rn -i "datafleet" src/` returns nothing.** This is a literal CI-style assertion in the integration test.

## 11. Risks

- **Built-in render wrapped in `createRoot` / `unmount` adds React-root overhead per panel switch.** Today the React tree is mounted once and just toggled. Switching to per-panel mount/unmount is a per-click cost, not a per-render cost — measured in single-digit ms. Acceptable.
- **Settings store schema change** needs to handle pre-upgrade settings files cleanly. The new key reads as `null` when missing; resolver falls back. No migration required.
- **Active-id race at boot** if a plugin activates very early via `onStartup` activation and changes the registry while `App.tsx`'s initial state is being computed. Resolver runs every `onDidChange`, so the worst case is one extra re-render with the fallback then the persisted id resolving. Visible as a single-frame flash of "Connections" before the user's previous view, only on startup, only when a sidebar plugin uses `onStartup` activation. Acceptable.
- **No way to hide a built-in.** Users who want to permanently remove "Saved Scripts" from the rail can't. Out of scope; revisit if asked.

## 12. Out-of-spec follow-ups

- `location: 'panel'` viewer support (separate spec; needs a layout slot first).
- VS Code-style view containers (multiple views per plugin icon).
- "Collapse panel on second click" polish.
- SVG icon support (requires plugin fs-asset resolution work).
