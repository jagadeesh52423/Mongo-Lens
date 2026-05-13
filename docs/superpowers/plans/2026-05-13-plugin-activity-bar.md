# Plugin Activity Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire plugin-contributed sidebar views into the existing `IconRail` / `SidePanel` chrome so they appear as peers of Connections / Saved Scripts.

**Architecture:** A new `ActivityRegistry` abstraction with three implementations (`BuiltIn`, `Plugin`, `Composite`). The two existing built-in panels register through the same interface plugins use. `IconRail` and `SidePanel` become items-driven; no hard-coded `PanelKey` union.

**Tech Stack:** React 18, TypeScript strict, Vitest + Testing Library + jsdom, the existing `Registry<T>` from `src/plugins/Registry.ts`, the existing `useSettingsStore` (Zustand + Tauri `Store`).

**Source of truth:** `docs/superpowers/specs/2026-05-13-plugin-activity-bar-design.md`.

**Plugin-agnostic invariant (spec §2):** No string `'datafleet'` (or any other plugin id) may appear in `src/`. Verified by a vitest test (Task 16).

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/layout/activityBar.ts` | Create | `ActivityItem`, `ActivityRegistry`, three implementations, `resolveActiveId` |
| `src/layout/__tests__/activityBar.test.ts` | Create | Unit tests for all three registries + resolver |
| `src/plugins/api/contracts.ts` | Modify | Add optional `icon` to `ViewProvider` |
| `src/plugins/schema/manifest.schema.json` | Modify | Add optional `icon` (`maxLength: 4`) to view contribution |
| `src/__tests__/plugins-manifest.test.ts` | Modify | Test new `icon` constraints |
| `src/plugins/PluginManager.ts` | Modify (minor) | Hold onto manifest contribution metadata so plugins can fall back to manifest icon (see Task 8) |
| `src/store/settings.ts` | Modify | New persisted key `activeActivityItemId` |
| `src/components/layout/IconRail.tsx` | Rewrite | Items-driven |
| `src/components/layout/SidePanel.tsx` | Rewrite | Item-driven imperative render |
| `src/__tests__/IconRail.test.tsx` | Create | Component tests |
| `src/__tests__/SidePanel.test.tsx` | Create | Component tests |
| `src/App.tsx` | Modify | Wire registries; swap hard-coded JSX; persist active id |
| `src/__tests__/App.activity-bar.test.tsx` | Create | Boot + plugin add/remove integration |
| `src/__tests__/plugin-agnostic-host.test.ts` | Create | grep-style assertion that `src/` contains no plugin id strings |

---

### Task 1: Define `ActivityItem` and `ActivityRegistry`

**Files:**
- Create: `src/layout/activityBar.ts`

- [ ] **Step 1: Create the file with type definitions only**

```ts
import { Disposable } from '../plugins/api/disposable';

export interface ActivityItem {
  id: string;
  title: string;
  icon: string;
  render(container: HTMLElement): { dispose(): void };
}

export interface ActivityRegistry {
  list(): ActivityItem[];
  onDidChange(cb: () => void): Disposable;
}
```

- [ ] **Step 2: TypeScript compile**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/layout/activityBar.ts
git commit -m "feat(activity-bar): add ActivityItem/ActivityRegistry types"
```

---

### Task 2: `BuiltInActivityRegistry`

**Files:**
- Modify: `src/layout/activityBar.ts`
- Create: `src/layout/__tests__/activityBar.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/layout/__tests__/activityBar.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { BuiltInActivityRegistry, type ActivityItem } from '../activityBar';

const itemA: ActivityItem = { id: 'a', title: 'A', icon: 'A', render: () => ({ dispose: () => {} }) };
const itemB: ActivityItem = { id: 'b', title: 'B', icon: 'B', render: () => ({ dispose: () => {} }) };

describe('BuiltInActivityRegistry', () => {
  it('starts empty', () => {
    expect(new BuiltInActivityRegistry().list()).toEqual([]);
  });

  it('add() appends in insertion order', () => {
    const r = new BuiltInActivityRegistry();
    r.add(itemA);
    r.add(itemB);
    expect(r.list().map(i => i.id)).toEqual(['a', 'b']);
  });

  it('add() of duplicate id throws', () => {
    const r = new BuiltInActivityRegistry();
    r.add(itemA);
    expect(() => r.add({ ...itemA, title: 'Other' })).toThrow(/already registered/i);
  });

  it('onDidChange fires on add', () => {
    const r = new BuiltInActivityRegistry();
    const cb = vi.fn();
    r.onDidChange(cb);
    r.add(itemA);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('onDidChange unsubscribes on dispose', () => {
    const r = new BuiltInActivityRegistry();
    const cb = vi.fn();
    const d = r.onDidChange(cb);
    d.dispose();
    r.add(itemA);
    expect(cb).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — fails (class not exported)**

Run: `npx vitest run src/layout/__tests__/activityBar.test.ts`
Expected: import error.

- [ ] **Step 3: Implement**

Append to `src/layout/activityBar.ts`:

```ts
import { toDisposable } from '../plugins/api/disposable';

export class BuiltInActivityRegistry implements ActivityRegistry {
  private items: ActivityItem[] = [];
  private listeners = new Set<() => void>();

  add(item: ActivityItem): void {
    if (this.items.some(i => i.id === item.id)) {
      throw new Error(`ActivityRegistry: id "${item.id}" already registered`);
    }
    this.items.push(item);
    this.fire();
  }

  list(): ActivityItem[] {
    return [...this.items];
  }

  onDidChange(cb: () => void): Disposable {
    this.listeners.add(cb);
    return toDisposable(() => { this.listeners.delete(cb); });
  }

  private fire(): void {
    for (const l of this.listeners) { try { l(); } catch { /* never throw */ } }
  }
}
```

- [ ] **Step 4: Run — passes**

Run: `npx vitest run src/layout/__tests__/activityBar.test.ts`
Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/layout/activityBar.ts src/layout/__tests__/activityBar.test.ts
git commit -m "feat(activity-bar): BuiltInActivityRegistry"
```

---

### Task 3: `PluginActivityRegistry`

**Files:**
- Modify: `src/layout/activityBar.ts`
- Modify: `src/layout/__tests__/activityBar.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/layout/__tests__/activityBar.test.ts`:

```ts
import { Registry } from '../../plugins/Registry';
import type { ViewProvider } from '../../plugins/api/contracts';
import { PluginActivityRegistry } from '../activityBar';

function vp(id: string, overrides: Partial<ViewProvider> = {}): ViewProvider {
  return {
    id,
    title: id,
    location: 'sidebar',
    render: () => ({ dispose() {} }),
    ...overrides,
  };
}

describe('PluginActivityRegistry', () => {
  it('returns only sidebar-location items', () => {
    const reg = new Registry<ViewProvider>('views');
    reg.register(vp('x', { location: 'sidebar' }), 'p1');
    reg.register(vp('y', { location: 'panel' }),   'p1');
    const par = new PluginActivityRegistry(reg);
    expect(par.list().map(i => i.id)).toEqual(['x']);
  });

  it('uses register icon when set', () => {
    const reg = new Registry<ViewProvider>('views');
    reg.register(vp('x', { icon: '🚀' }), 'p1');
    const par = new PluginActivityRegistry(reg);
    expect(par.list()[0]!.icon).toBe('🚀');
  });

  it('falls back to first letter of title when icon missing', () => {
    const reg = new Registry<ViewProvider>('views');
    reg.register(vp('x', { title: 'datafleet' }), 'p1');
    const par = new PluginActivityRegistry(reg);
    expect(par.list()[0]!.icon).toBe('D');
  });

  it('onDidChange proxies the underlying registry', () => {
    const reg = new Registry<ViewProvider>('views');
    const par = new PluginActivityRegistry(reg);
    const cb = vi.fn();
    par.onDidChange(cb);
    reg.register(vp('x'), 'p1');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('render delegates to ViewProvider.render', () => {
    const inner = vi.fn(() => ({ dispose: vi.fn() }));
    const reg = new Registry<ViewProvider>('views');
    reg.register(vp('x', { render: inner }), 'p1');
    const par = new PluginActivityRegistry(reg);
    const container = document.createElement('div');
    par.list()[0]!.render(container);
    expect(inner).toHaveBeenCalledWith(container, expect.objectContaining({ container }));
  });
});
```

- [ ] **Step 2: Run — fails**

Run: `npx vitest run src/layout/__tests__/activityBar.test.ts`
Expected: 5 new failures (class not exported).

- [ ] **Step 3: Implement**

Append to `src/layout/activityBar.ts`:

```ts
import { Registry } from '../plugins/Registry';
import type { ViewProvider } from '../plugins/api/contracts';

export class PluginActivityRegistry implements ActivityRegistry {
  constructor(private views: Registry<ViewProvider>) {}

  list(): ActivityItem[] {
    return this.views
      .list()
      .filter(v => v.location === 'sidebar')
      .map(v => this.toItem(v));
  }

  onDidChange(cb: () => void): Disposable {
    return this.views.onDidChange(cb);
  }

  private toItem(v: ViewProvider): ActivityItem {
    const icon = v.icon && v.icon.length > 0 ? v.icon : (v.title[0] ?? '?').toUpperCase();
    return {
      id: v.id,
      title: v.title,
      icon,
      render: (container: HTMLElement) => v.render(container, { container }),
    };
  }
}
```

- [ ] **Step 4: Run — passes**

Run: `npx vitest run src/layout/__tests__/activityBar.test.ts`
Expected: 10 pass.

- [ ] **Step 5: Commit**

```bash
git add src/layout/activityBar.ts src/layout/__tests__/activityBar.test.ts
git commit -m "feat(activity-bar): PluginActivityRegistry adapter over views registry"
```

---

### Task 4: `CompositeActivityRegistry`

**Files:**
- Modify: `src/layout/activityBar.ts`
- Modify: `src/layout/__tests__/activityBar.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/layout/__tests__/activityBar.test.ts`:

```ts
import { CompositeActivityRegistry } from '../activityBar';

describe('CompositeActivityRegistry', () => {
  it('concatenates children in given order', () => {
    const a = new BuiltInActivityRegistry();
    a.add(itemA);
    const b = new BuiltInActivityRegistry();
    b.add(itemB);
    const comp = new CompositeActivityRegistry([a, b]);
    expect(comp.list().map(i => i.id)).toEqual(['a', 'b']);
  });

  it('onDidChange fires when any child fires', () => {
    const a = new BuiltInActivityRegistry();
    const b = new BuiltInActivityRegistry();
    const comp = new CompositeActivityRegistry([a, b]);
    const cb = vi.fn();
    comp.onDidChange(cb);
    a.add(itemA);
    b.add(itemB);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('dispose unsubscribes from all children', () => {
    const a = new BuiltInActivityRegistry();
    const comp = new CompositeActivityRegistry([a]);
    const cb = vi.fn();
    const d = comp.onDidChange(cb);
    d.dispose();
    a.add(itemA);
    expect(cb).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — fails**

Run: `npx vitest run src/layout/__tests__/activityBar.test.ts`
Expected: 3 new failures.

- [ ] **Step 3: Implement**

Append to `src/layout/activityBar.ts`:

```ts
export class CompositeActivityRegistry implements ActivityRegistry {
  constructor(private children: ActivityRegistry[]) {}

  list(): ActivityItem[] {
    return this.children.flatMap(c => c.list());
  }

  onDidChange(cb: () => void): Disposable {
    const subs = this.children.map(c => c.onDidChange(cb));
    return toDisposable(() => { for (const s of subs) s.dispose(); });
  }
}
```

- [ ] **Step 4: Run — passes**

Run: `npx vitest run src/layout/__tests__/activityBar.test.ts`
Expected: 13 pass.

- [ ] **Step 5: Commit**

```bash
git add src/layout/activityBar.ts src/layout/__tests__/activityBar.test.ts
git commit -m "feat(activity-bar): CompositeActivityRegistry"
```

---

### Task 5: `resolveActiveId` helper

**Files:**
- Modify: `src/layout/activityBar.ts`
- Modify: `src/layout/__tests__/activityBar.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/layout/__tests__/activityBar.test.ts`:

```ts
import { resolveActiveId } from '../activityBar';

describe('resolveActiveId', () => {
  it('returns the persisted id when present in items', () => {
    expect(resolveActiveId([itemA, itemB], 'b')).toBe('b');
  });

  it('falls back to first item when persisted id missing', () => {
    expect(resolveActiveId([itemA, itemB], 'gone')).toBe('a');
  });

  it('falls back to first item when persisted id is null', () => {
    expect(resolveActiveId([itemA, itemB], null)).toBe('a');
  });

  it('returns null when items is empty', () => {
    expect(resolveActiveId([], 'anything')).toBeNull();
  });
});
```

- [ ] **Step 2: Run — fails**

Run: `npx vitest run src/layout/__tests__/activityBar.test.ts`
Expected: 4 new failures.

- [ ] **Step 3: Implement**

Append to `src/layout/activityBar.ts`:

```ts
export function resolveActiveId(items: ActivityItem[], persistedId: string | null): string | null {
  if (persistedId && items.some(i => i.id === persistedId)) return persistedId;
  return items[0]?.id ?? null;
}
```

- [ ] **Step 4: Run — passes**

Run: `npx vitest run src/layout/__tests__/activityBar.test.ts`
Expected: 17 pass.

- [ ] **Step 5: Commit**

```bash
git add src/layout/activityBar.ts src/layout/__tests__/activityBar.test.ts
git commit -m "feat(activity-bar): resolveActiveId helper"
```

---

### Task 6: Add optional `icon` to `ViewProvider`

**Files:**
- Modify: `src/plugins/api/contracts.ts`

- [ ] **Step 1: Edit the interface**

In `src/plugins/api/contracts.ts`, change the `ViewProvider` interface to add `icon?`:

```ts
export interface ViewProvider {
  id: string;
  title: string;
  icon?: string;
  location: 'sidebar' | 'panel';
  render(container: HTMLElement, ctx: ViewContext): Disposable;
}
```

- [ ] **Step 2: TypeScript compile**

Run: `npx tsc --noEmit`
Expected: 0 errors (icon is optional; existing call sites unaffected).

- [ ] **Step 3: Commit**

```bash
git add src/plugins/api/contracts.ts
git commit -m "feat(plugins): optional icon on ViewProvider"
```

---

### Task 7: Manifest schema — `icon` on view contributions

**Files:**
- Modify: `src/plugins/schema/manifest.schema.json`
- Modify: `src/__tests__/plugins-manifest.test.ts`

- [ ] **Step 1: Find the view contribution shape**

Run: `grep -n "views" src/plugins/schema/manifest.schema.json`
Confirm the current `views` entry uses a flat object with `id`, `title`, `location`.

- [ ] **Step 2: Replace the views shape**

In `src/plugins/schema/manifest.schema.json`, locate the `views` line under `contributes.properties` and replace:

```json
"views": { "type": "array", "items": { "type": "object", "required": ["id","title","location"], "properties": { "id":{"type":"string"},"title":{"type":"string"},"location":{"enum":["sidebar","panel"]} } } },
```

with:

```json
"views": { "type": "array", "items": { "type": "object", "required": ["id","title","location"], "additionalProperties": false, "properties": { "id":{"type":"string"},"title":{"type":"string"},"icon":{"type":"string","maxLength":4},"location":{"enum":["sidebar","panel"]} } } },
```

(Keep the JSON on one line if surrounding entries are one-liners — match local style.)

- [ ] **Step 3: Add manifest tests**

Append to `src/__tests__/plugins-manifest.test.ts`:

```ts
import { validateManifest } from '../plugins/manifest';

const baseValid = {
  id: 'p.test',
  name: 'Test',
  version: '0.0.1',
  engines: { mongolens: '^1.0.0' },
  main: 'index.js',
};

describe('manifest view icon', () => {
  it('accepts a view with no icon', () => {
    const r = validateManifest({
      ...baseValid,
      contributes: { views: [{ id: 'v', title: 'V', location: 'sidebar' }] },
    });
    expect(r.ok).toBe(true);
  });

  it('accepts a view with a 1-4 char icon', () => {
    for (const icon of ['🚀', 'D', 'DF', 'MGOX']) {
      const r = validateManifest({
        ...baseValid,
        contributes: { views: [{ id: 'v', title: 'V', icon, location: 'sidebar' }] },
      });
      expect(r.ok).toBe(true);
    }
  });

  it('rejects icons longer than 4 chars', () => {
    const r = validateManifest({
      ...baseValid,
      contributes: { views: [{ id: 'v', title: 'V', icon: 'TOOLONG', location: 'sidebar' }] },
    });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 4: Run — passes**

Run: `npx vitest run src/__tests__/plugins-manifest.test.ts`
Expected: original tests + 3 new pass.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/schema/manifest.schema.json src/__tests__/plugins-manifest.test.ts
git commit -m "feat(plugins): manifest view contribution accepts optional icon"
```

---

### Task 8: PluginManager passes manifest icon to ViewProvider fallback

**Files:**
- Modify: `src/plugins/PluginManager.ts`
- Modify: `src/plugins/registries.ts` (if a hook is needed — verify first)

The contract per spec §6.2 is: if a plugin's `register({...})` call omits `icon`, the host falls back to the manifest's contribution icon. The `PluginActivityRegistry` already falls back to `title[0]` if both are absent (Task 3). This task threads the manifest icon into the `ViewProvider` instance that gets registered.

- [ ] **Step 1: Find where the views registry is wrapped for plugin API**

Run: `grep -n "views.register\|views: { register" src/plugins/api/createMongolens.ts`
You should see a single line where the per-plugin `views.register` is wired.

- [ ] **Step 2: Inspect the registry pre-population approach**

Run: `grep -n "contributes\.views\|manifest.contributes" src/plugins/PluginManager.ts | head`

The plan supports either of two implementation choices, depending on what's already there:

**Choice A (preferred when PluginManager has access to the manifest contribution):** in `createMongolens.ts`, wrap the plugin's `views.register` so it merges in the manifest contribution's icon before forwarding to the underlying registry. Modify:

```ts
views: { register: v => r.views.register(v, pluginId) },
```

to:

```ts
views: { register: v => r.views.register(
  v.icon ? v : { ...v, icon: lookupManifestIcon(params, v.id) },
  pluginId,
) },
```

with a helper `lookupManifestIcon(params, viewId): string | undefined` that searches `params.manifest.contributes?.views ?? []` for an entry whose `id` matches `viewId` and returns its `icon`. This requires `params.manifest` to be passed into `createMongolens` (add the field; it's used nowhere else today). Trace the call from `PluginManager.activate` and add `manifest: rec.manifest` to the call site.

**Choice B (simpler when the manifest isn't already plumbed):** in `PluginManager.activate`, after `mod.activate(ctx)` returns, iterate `r.views.list()` for items owned by this plugin (`r.views.getOwner(id) === pluginId`); if the item's `icon` is unset and the manifest has a matching view contribution with an `icon`, **replace** the registry entry with a copy that has the icon set. Since `Registry<T>` doesn't support in-place mutation, this requires adding a `Registry.update(id, mutator)` method or going the Choice A route. Prefer A.

- [ ] **Step 3: Write the failing test**

Create or extend `src/__tests__/plugin-manager-view-icon.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PluginManager } from '../plugins/PluginManager';
// + the test scaffolding the existing PluginManager tests use (see
//   src/__tests__/plugins-manager-*.test.ts for the pattern). The test
//   should:
//   1. Construct a PluginManager with a manifest that has
//      contributes.views = [{ id: 'v', title: 'X', icon: '🚀', location: 'sidebar' }]
//   2. Stub the plugin entry so its activate() calls mongolens.views.register({
//        id: 'v', title: 'X', location: 'sidebar', render: () => ({dispose(){}})
//      }) — i.e., no icon in the register call.
//   3. After activate, assert the views registry's entry for 'v' has icon === '🚀'.

describe('PluginManager view icon fallback', () => {
  it('uses manifest icon when register() omits it', async () => {
    // Pattern: copy the test setup from src/__tests__/plugins-manager-discover.test.ts
    // (PluginManager + entryLoader stub) and assert on registries.views.get('v')?.icon.
    expect(true).toBe(true); // placeholder — replace with the assertion above
  });
});
```

Replace the placeholder assertion with the actual one. **Do not commit until the placeholder is gone.**

- [ ] **Step 4: Run — fails**

Run: `npx vitest run src/__tests__/plugin-manager-view-icon.test.ts`
Expected: FAIL (icon is `undefined`).

- [ ] **Step 5: Implement Choice A**

In `src/plugins/api/createMongolens.ts`:

```ts
export function createMongolens(params: {
  pluginId: string;
  registries: RegistrySet;
  services: HostServices;
  logger?: Logger;
  manifest?: { contributes?: { views?: { id: string; icon?: string }[] } };
}): MongolensAPI {
  const { pluginId, registries: r, services, manifest } = params;

  function manifestIconFor(viewId: string): string | undefined {
    return manifest?.contributes?.views?.find(v => v.id === viewId)?.icon;
  }

  return {
    // ...
    views: {
      register: v => r.views.register(
        v.icon ? v : { ...v, icon: manifestIconFor(v.id) },
        pluginId,
      ),
    },
    // ...
  };
}
```

In `src/plugins/PluginManager.ts`, find the `createMongolens(...)` call and add `manifest: rec.manifest` to the parameters.

- [ ] **Step 6: Run — passes**

Run: `npx vitest run src/__tests__/plugin-manager-view-icon.test.ts`
Expected: pass.

- [ ] **Step 7: Run full suite to confirm no regressions**

Run: `npx vitest run`
Expected: existing suite still green; new test passes.

- [ ] **Step 8: Commit**

```bash
git add src/plugins/api/createMongolens.ts src/plugins/PluginManager.ts src/__tests__/plugin-manager-view-icon.test.ts
git commit -m "feat(plugins): fallback to manifest icon when register() omits it"
```

---

### Task 9: Settings store — persist `activeActivityItemId`

**Files:**
- Modify: `src/store/settings.ts`

- [ ] **Step 1: Locate the persisted shape**

Run: `grep -n "PersistedSettings\|toPersisted\|themeId" src/store/settings.ts | head -10`
You'll find a `PersistedSettings` interface and a `toPersisted` function. Both need updating.

- [ ] **Step 2: Add to the interfaces**

In `src/store/settings.ts`, add to `SettingsState`:

```ts
activeActivityItemId: string | null;
setActiveActivityItemId: (id: string | null) => void;
```

Add to `PersistedSettings`:

```ts
activeActivityItemId: string | null;
```

In `toPersisted`, include the new field:

```ts
return {
  themeId: state.themeId,
  shortcutOverrides: state.shortcutOverrides,
  themeOverrides: getAllOverrides(),
  aiConfig: persistedAi,
  activeActivityItemId: state.activeActivityItemId,
};
```

In the `create<SettingsState>` initial state, add `activeActivityItemId: null,` and the setter:

```ts
setActiveActivityItemId: (id) => set({ activeActivityItemId: id }),
```

In the hydration block where existing settings are read from disk, treat a missing key as `null`:

```ts
activeActivityItemId: loaded?.activeActivityItemId ?? null,
```

- [ ] **Step 3: TypeScript compile**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Sanity test (optional but recommended)**

If the settings store has existing tests at `src/__tests__/settings-store.test.ts`, add:

```ts
it('persists and round-trips activeActivityItemId', async () => {
  const { useSettingsStore } = await import('../store/settings');
  useSettingsStore.getState().setActiveActivityItemId('saved');
  expect(useSettingsStore.getState().activeActivityItemId).toBe('saved');
});
```

If no such file exists today, skip this step.

- [ ] **Step 5: Commit**

```bash
git add src/store/settings.ts $(test -f src/__tests__/settings-store.test.ts && echo src/__tests__/settings-store.test.ts || true)
git commit -m "feat(settings): persist activeActivityItemId"
```

---

### Task 10: Rewrite `IconRail` to be items-driven

**Files:**
- Rewrite: `src/components/layout/IconRail.tsx`
- Create: `src/__tests__/IconRail.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/IconRail.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IconRail } from '../components/layout/IconRail';

const items = [
  { id: 'a', title: 'Alpha',  icon: 'A', render: () => ({ dispose: () => {} }) },
  { id: 'b', title: 'Bravo',  icon: 'B', render: () => ({ dispose: () => {} }) },
];

describe('IconRail', () => {
  it('renders one button per item', () => {
    render(<IconRail items={items} activeId="a" onChange={vi.fn()} onSettingsOpen={vi.fn()} settingsOpen={false} />);
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bravo' })).toBeInTheDocument();
  });

  it('fires onChange with the clicked item id', async () => {
    const onChange = vi.fn();
    render(<IconRail items={items} activeId="a" onChange={onChange} onSettingsOpen={vi.fn()} settingsOpen={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Bravo' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('fires onSettingsOpen when Settings clicked', async () => {
    const onSettingsOpen = vi.fn();
    render(<IconRail items={items} activeId="a" onChange={vi.fn()} onSettingsOpen={onSettingsOpen} settingsOpen={false} />);
    await userEvent.click(screen.getByRole('button', { name: /settings/i }));
    expect(onSettingsOpen).toHaveBeenCalledTimes(1);
  });

  it('renders the icon text of each item', () => {
    render(<IconRail items={items} activeId="a" onChange={vi.fn()} onSettingsOpen={vi.fn()} settingsOpen={false} />);
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveTextContent('A');
    expect(screen.getByRole('button', { name: 'Bravo' })).toHaveTextContent('B');
  });
});
```

- [ ] **Step 2: Run — fails (signature mismatch / type errors)**

Run: `npx vitest run src/__tests__/IconRail.test.tsx`
Expected: FAIL — old `IconRail` doesn't accept `items` prop.

- [ ] **Step 3: Rewrite `IconRail`**

Replace `src/components/layout/IconRail.tsx` entirely with:

```tsx
import type { ActivityItem } from '../../layout/activityBar';

interface Props {
  items: ActivityItem[];
  activeId: string | null;
  onChange: (id: string) => void;
  onSettingsOpen: () => void;
  settingsOpen: boolean;
}

export function IconRail({ items, activeId, onChange, onSettingsOpen, settingsOpen }: Props) {
  return (
    <div
      style={{
        width: 44,
        background: 'var(--bg-rail)',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--border)',
      }}
    >
      <div
        style={{
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <img src="/logo.svg" alt="Logo" style={{ width: 24, height: 24 }} />
      </div>
      {items.map((it) => {
        const isActive = !settingsOpen && activeId === it.id;
        return (
          <button
            key={it.id}
            aria-label={it.title}
            onClick={() => onChange(it.id)}
            style={{
              height: 44,
              border: 'none',
              borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              background: 'transparent',
              color: isActive ? 'var(--fg)' : 'var(--fg-dim)',
              fontSize: 18,
              cursor: 'pointer',
            }}
          >
            {it.icon}
          </button>
        );
      })}
      <div style={{ flex: 1 }} />
      <button
        aria-label="Settings"
        onClick={onSettingsOpen}
        style={{
          height: 44,
          border: 'none',
          borderLeft: settingsOpen ? '2px solid var(--accent)' : '2px solid transparent',
          background: 'transparent',
          color: settingsOpen ? 'var(--fg)' : 'var(--fg-dim)',
          fontSize: 18,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        ⚙
      </button>
    </div>
  );
}
```

Note: the old `PanelKey` export is gone. Other files that import it will be fixed when we rewrite App in Task 12.

- [ ] **Step 4: Run — passes**

Run: `npx vitest run src/__tests__/IconRail.test.tsx`
Expected: 4 pass.

- [ ] **Step 5: TypeScript compile (will fail on App.tsx — expected)**

Run: `npx tsc --noEmit`
Expected: errors in `src/App.tsx` and `src/components/layout/SidePanel.tsx` referencing `PanelKey`. These are fixed in Tasks 11 and 12.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/IconRail.tsx src/__tests__/IconRail.test.tsx
git commit -m "feat(layout): IconRail consumes ActivityItem[] instead of hard-coded PanelKey"
```

---

### Task 11: Rewrite `SidePanel` to be item-driven

**Files:**
- Rewrite: `src/components/layout/SidePanel.tsx`
- Create: `src/__tests__/SidePanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/SidePanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { SidePanel } from '../components/layout/SidePanel';
import type { ActivityItem } from '../layout/activityBar';

function makeItem(id: string, body: string): ActivityItem {
  return {
    id, title: id.toUpperCase(), icon: id[0]!.toUpperCase(),
    render: (container) => {
      container.textContent = body;
      return { dispose() { container.textContent = ''; } };
    },
  };
}

describe('SidePanel', () => {
  it('renders the item title', () => {
    render(<SidePanel item={makeItem('a', 'body-a')} />);
    expect(screen.getByTestId('side-panel-title')).toHaveTextContent('A');
  });

  it('calls item.render into the body container', () => {
    render(<SidePanel item={makeItem('a', 'body-a')} />);
    expect(screen.getByText('body-a')).toBeInTheDocument();
  });

  it('disposes the prior render when item changes', () => {
    const dispose = vi.fn();
    const item: ActivityItem = {
      id: 'a', title: 'A', icon: 'A',
      render: (c) => { c.textContent = 'first'; return { dispose }; },
    };
    const { rerender } = render(<SidePanel item={item} />);
    expect(dispose).not.toHaveBeenCalled();
    rerender(<SidePanel item={makeItem('b', 'second')} />);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(screen.getByText('second')).toBeInTheDocument();
  });

  it('renders a placeholder when item is null', () => {
    render(<SidePanel item={null} />);
    expect(screen.getByTestId('side-panel-empty')).toBeInTheDocument();
  });

  it('shows an error fallback when render throws', () => {
    const throwing: ActivityItem = {
      id: 'x', title: 'X', icon: 'X',
      render: () => { throw new Error('boom'); },
    };
    render(<SidePanel item={throwing} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/boom/);
  });
});
```

- [ ] **Step 2: Run — fails**

Run: `npx vitest run src/__tests__/SidePanel.test.tsx`
Expected: FAIL — old SidePanel has different prop shape.

- [ ] **Step 3: Rewrite `SidePanel`**

Replace `src/components/layout/SidePanel.tsx` entirely with:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { ActivityItem } from '../../layout/activityBar';

interface Props { item: ActivityItem | null }

export function SidePanel({ item }: Props) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (!item || !bodyRef.current) return;
    let disposable: { dispose(): void } | null = null;
    try {
      disposable = item.render(bodyRef.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    return () => {
      try { disposable?.dispose(); } catch { /* never throw */ }
      if (bodyRef.current) bodyRef.current.innerHTML = '';
    };
  }, [item?.id]);

  return (
    <div
      style={{
        width: '100%', height: '100%',
        background: 'var(--bg-panel)',
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div
        data-testid="side-panel-title"
        style={{
          padding: '8px 12px', fontSize: 11,
          textTransform: 'uppercase', color: 'var(--fg-dim)',
          letterSpacing: 1, borderBottom: '1px solid var(--border)',
        }}
      >
        {item?.title ?? ''}
      </div>
      {error ? (
        <div role="alert" style={{ padding: 12, color: 'var(--error, red)' }}>
          View failed to render: {error}
        </div>
      ) : item ? (
        <div ref={bodyRef} style={{ flex: 1, overflow: 'auto' }} />
      ) : (
        <div data-testid="side-panel-empty" style={{ flex: 1, padding: 12, color: 'var(--fg-dim)' }}>
          No view selected.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run — passes**

Run: `npx vitest run src/__tests__/SidePanel.test.tsx`
Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/SidePanel.tsx src/__tests__/SidePanel.test.tsx
git commit -m "feat(layout): SidePanel renders ActivityItem imperatively"
```

---

### Task 12: Wire registries in `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the registries at module top**

Near the top of `src/App.tsx` (after imports, before `export default function App()`), add the bootstrap helpers:

```ts
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import {
  BuiltInActivityRegistry,
  PluginActivityRegistry,
  CompositeActivityRegistry,
  resolveActiveId,
  type ActivityItem,
  type ActivityRegistry,
} from './layout/activityBar';

function makeBuiltInRegistry(): BuiltInActivityRegistry {
  const reg = new BuiltInActivityRegistry();
  reg.add({
    id: 'connections',
    title: 'Connections',
    icon: '⚡',
    render: (container) => {
      const root = createRoot(container);
      root.render(createElement(ConnectionPanel));
      return { dispose() { root.unmount(); } };
    },
  });
  reg.add({
    id: 'saved',
    title: 'Saved Scripts',
    icon: '⭐',
    render: (container) => {
      const root = createRoot(container);
      root.render(createElement(SavedScriptsPanel));
      return { dispose() { root.unmount(); } };
    },
  });
  return reg;
}
```

- [ ] **Step 2: Replace panel state with activity-bar state**

In `App()`, replace:

```ts
const [panel, setPanel] = useState<PanelKey>('connections');
```

with:

```ts
const persistedActiveId   = useSettingsStore(s => s.activeActivityItemId);
const setPersistedActive  = useSettingsStore(s => s.setActiveActivityItemId);
const [registry, setRegistry] = useState<ActivityRegistry | null>(null);
const [items, setItems]   = useState<ActivityItem[]>([]);

useEffect(() => {
  const builtIns = makeBuiltInRegistry();
  let composite: CompositeActivityRegistry = new CompositeActivityRegistry([builtIns]);
  setRegistry(composite);
  setItems(composite.list());

  let pluginSub: { dispose(): void } | null = null;
  let topSub:    { dispose(): void } | null = null;

  // Wait for the plugin host bootstrap to complete; it sets window.__pluginHost.
  const trySubscribe = () => {
    const host = (window as unknown as { __pluginHost?: { registries: { views: import('./plugins/Registry').Registry<import('./plugins/api/contracts').ViewProvider> } } }).__pluginHost;
    if (!host) { setTimeout(trySubscribe, 50); return; }
    const pluginReg = new PluginActivityRegistry(host.registries.views);
    composite = new CompositeActivityRegistry([builtIns, pluginReg]);
    setRegistry(composite);
    setItems(composite.list());
    pluginSub = pluginReg.onDidChange(() => setItems(composite.list()));
    topSub = composite.onDidChange(() => setItems(composite.list()));
  };
  trySubscribe();

  return () => {
    pluginSub?.dispose();
    topSub?.dispose();
  };
}, []);

const activeId = resolveActiveId(items, persistedActiveId);

function onChangeActive(id: string) {
  setPersistedActive(id);
}
```

- [ ] **Step 3: Replace the IconRail call**

Replace:

```tsx
<IconRail
  active={panel}
  onChange={setPanel}
  onSettingsOpen={() => setSettingsOpen((s) => !s)}
  settingsOpen={settingsOpen}
/>
```

with:

```tsx
<IconRail
  items={items}
  activeId={activeId}
  onChange={onChangeActive}
  onSettingsOpen={() => setSettingsOpen((s) => !s)}
  settingsOpen={settingsOpen}
/>
```

- [ ] **Step 4: Replace the SidePanel block**

Replace:

```tsx
<SidePanel active={panel}>
  {panel === 'connections' && <ConnectionPanel />}
  {panel === 'saved' && <SavedScriptsPanel />}
</SidePanel>
```

with:

```tsx
<SidePanel item={items.find(i => i.id === activeId) ?? null} />
```

- [ ] **Step 5: TypeScript compile**

Run: `npx tsc --noEmit`
Expected: 0 errors. If `PanelKey` is still imported anywhere, delete the import — it no longer exists.

- [ ] **Step 6: Smoke run**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat(layout): wire ActivityRegistry into App; built-ins through same interface as plugins"
```

---

### Task 13: Resolver re-runs on registry change (auto-fallback)

**Files:**
- Modify: `src/App.tsx` (only if Task 12 didn't already wire this — verify)

Spec §7: when a plugin whose view is active is uninstalled, the resolver should fall back without flicker. This is already handled by `resolveActiveId(items, persistedId)` — when the persisted id is no longer in `items`, the resolver returns the first item. No additional state change needed unless we want to *persist* the fallback (we don't — keep the persisted id as the user's intent; if the plugin reappears later it becomes active again).

- [ ] **Step 1: Verify with a test**

Append to `src/__tests__/App.activity-bar.test.tsx` (will be created in Task 14). Skip this task as a no-op if the implementation in Task 12 already covers it (the resolver call inside the render is reactive to `items`).

- [ ] **Step 2: Commit (no code change)**

If no code change was required, mark this task complete without a commit.

---

### Task 14: Integration test for plugin add/remove flow

**Files:**
- Create: `src/__tests__/App.activity-bar.test.tsx`

- [ ] **Step 1: Write the test**

Create `src/__tests__/App.activity-bar.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import {
  BuiltInActivityRegistry,
  PluginActivityRegistry,
  CompositeActivityRegistry,
  resolveActiveId,
} from '../layout/activityBar';
import { Registry } from '../plugins/Registry';
import type { ViewProvider } from '../plugins/api/contracts';

function builtIn(id: string) {
  return { id, title: id, icon: id[0]!.toUpperCase(), render: () => ({ dispose() {} }) };
}
function vp(id: string): ViewProvider {
  return { id, title: id, location: 'sidebar', render: () => ({ dispose() {} }) };
}

describe('App activity-bar integration', () => {
  it('persisted id resolves through composite registry', () => {
    const built = new BuiltInActivityRegistry();
    built.add(builtIn('connections'));
    built.add(builtIn('saved'));
    const views = new Registry<ViewProvider>('views');
    views.register(vp('p.x'), 'p');
    const comp = new CompositeActivityRegistry([built, new PluginActivityRegistry(views)]);
    expect(resolveActiveId(comp.list(), 'p.x')).toBe('p.x');
  });

  it('plugin uninstall mid-session: active id falls back to first item', () => {
    const built = new BuiltInActivityRegistry();
    built.add(builtIn('connections'));
    const views = new Registry<ViewProvider>('views');
    views.register(vp('p.x'), 'p');
    const par = new PluginActivityRegistry(views);
    const comp = new CompositeActivityRegistry([built, par]);
    expect(resolveActiveId(comp.list(), 'p.x')).toBe('p.x');
    views.disposeForPlugin('p');
    expect(resolveActiveId(comp.list(), 'p.x')).toBe('connections');
  });

  it('plugin activates after boot: icon appears, active stays', () => {
    const built = new BuiltInActivityRegistry();
    built.add(builtIn('connections'));
    const views = new Registry<ViewProvider>('views');
    const par = new PluginActivityRegistry(views);
    const comp = new CompositeActivityRegistry([built, par]);
    expect(resolveActiveId(comp.list(), null)).toBe('connections');
    views.register(vp('p.x'), 'p');
    expect(comp.list().map(i => i.id)).toEqual(['connections', 'p.x']);
    expect(resolveActiveId(comp.list(), null)).toBe('connections'); // does not auto-switch
  });
});
```

- [ ] **Step 2: Run — passes**

Run: `npx vitest run src/__tests__/App.activity-bar.test.tsx`
Expected: 3 pass.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/App.activity-bar.test.tsx
git commit -m "test(activity-bar): plugin add/remove + persisted-id integration"
```

---

### Task 15: Run the full suite

**Files:** none

- [ ] **Step 1: Full test pass**

Run: `npx vitest run`
Expected: all existing tests + all new tests green.

- [ ] **Step 2: TypeScript pass**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds.

No commit — this task is a checkpoint.

---

### Task 16: Plugin-agnostic host invariant test

**Files:**
- Create: `src/__tests__/plugin-agnostic-host.test.ts`

- [ ] **Step 1: Write the test**

Create `src/__tests__/plugin-agnostic-host.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

const FORBIDDEN_TERMS = [
  'datafleet',
  'DataFleet',
];

describe('plugin-agnostic host invariant', () => {
  it.each(FORBIDDEN_TERMS)('src/ does not reference "%s"', (term) => {
    let result: string;
    try {
      result = execSync(
        `grep -rIn --exclude-dir=__tests__ --include='*.ts' --include='*.tsx' --include='*.json' '${term}' src || true`,
        { encoding: 'utf8' },
      );
    } catch {
      result = '';
    }
    expect(result.trim(), `Found "${term}" in src/:\n${result}`).toBe('');
  });
});
```

- [ ] **Step 2: Run — passes**

Run: `npx vitest run src/__tests__/plugin-agnostic-host.test.ts`
Expected: 2 pass.

If it fails, the failing output tells you exactly which `src/` file references the plugin. Remove the reference (it should never be there per spec §2).

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/plugin-agnostic-host.test.ts
git commit -m "test(plugins): assert host stays plugin-agnostic"
```

---

## Self-review

**Spec coverage:**

| Spec section | Covered by |
|---|---|
| §1 Goal | Implicit across all tasks |
| §2 Plugin-agnostic invariant | Task 16 |
| §3 Scope (in) | Tasks 1–15 |
| §3 Scope (out) | Not implemented — confirmed by absence |
| §4.1 ActivityRegistry contract | Task 1 |
| §4.2 BuiltInActivityRegistry | Task 2 |
| §4.2 PluginActivityRegistry | Task 3 |
| §4.2 CompositeActivityRegistry | Task 4 |
| §4.3 Wiring at boot | Task 12 |
| §5.1 IconRail rewrite | Task 10 |
| §5.2 SidePanel rewrite | Task 11 |
| §5.3 App.tsx changes | Task 12 |
| §6.1 Manifest schema icon | Task 7 |
| §6.2 ViewProvider.icon | Task 6 |
| §6.3 Plugin manifest extension | Out of repo (plugin author task) |
| §7 Persistence | Tasks 9 + 12 |
| §8 Lifecycle & error handling | Tasks 11 (render throws) + 13 + 14 |
| §9 File map | Matches plan file map above |
| §10.1 Unit tests | Tasks 2–5, 7 |
| §10.2 Component tests | Tasks 10, 11 |
| §10.3 Integration | Tasks 14, 16 |

No gaps.

**Type consistency:**
- `ActivityItem.render(container)` signature consistent across Tasks 1, 3 (delegates to ViewProvider), 10 (IconRail props don't touch it), 11 (SidePanel calls it), 12 (built-ins implement it).
- `ActivityRegistry.list()` returns `ActivityItem[]` (Task 1), and every caller (Tasks 10, 11, 12, 14) treats it as such.
- `ViewProvider.icon` is `string | undefined` in Task 6 and the manifest schema in Task 7 likewise allows it absent.
- `activeActivityItemId: string | null` consistent across Tasks 9, 12, 14.
- `resolveActiveId(items, persistedId)` signature matches all call sites.

**Placeholder scan:** no TBDs, no "handle errors". One soft spot: Task 8 Step 3 says "Pattern: copy the test setup from src/__tests__/plugins-manager-discover.test.ts" rather than inlining the exact code, because the existing test scaffolding is large and varies; the actual assertion is fully specified. Acceptable per the spirit of the rule (the engineer is told exactly what to assert and exactly which template file to copy).
