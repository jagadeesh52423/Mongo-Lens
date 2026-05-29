# Design: Connections Panel — "Connect" Launcher & Polish

**Date:** 2026-05-29
**Status:** Approved (design) — pending spec review
**Topic:** Reframe the Connections side panel around a lively "Connect" launcher and remove the "dull" flat-list look

---

## 1. Overview & Goals

The Connections panel (`src/components/features/connections/`) opens "dull": when nothing is
connected it shows a flat `<ul>` of every saved connection, each row carrying a **raw, unstyled
`<button>`** for Connect/Disconnect, a text-bullet status dot, and a hairline `border-bottom`
divider between rows. It never adopted the **"Linear Precision"** visual language defined in
`docs/superpowers/specs/2026-05-28-ui-precision-refactor-design.md`.

**Goal:** Reframe the panel around a single, lively **Connect** action and show only what matters
on open — nothing else. Picking a connection from a dropdown connects it; connected connections
then live in the panel body with their existing database → collection tree for browsing.

**Confirmed decisions (from brainstorming):**

| Decision | Choice |
|---|---|
| What's "dull" | The empty/opening state **and** the flat populated list |
| Reveal mechanism | **Dropdown launcher** (floating menu anchored under a Connect button) |
| Active-connection model | **Multiple** connections active at once (model A — matches today) |
| Connect button style | **Solid accent** (`--accent`) fill — it is the panel's single primary CTA |
| Dropdown contents | **Only not-yet-connected** connections + a "New connection…" entry |
| Row dividers | **Removed** — borderless, rounded, hover-highlighted rows |
| Icons | Refined per mockups — lightning Connect glyph, env-color dots, glowing live dot, cylinder DB/collection icons, chevron carets |

**Non-goals (YAGNI):**
- No change to the connect/disconnect IPC, the `useConnectionsV2` store, or `useConnectionActions`.
- No change to `ConnectionDialogV2`, the SSH passphrase/host-key/error dialogs, or the context menu's Edit/Duplicate/Delete actions (we only **add** Disconnect).
- No search/filter box in the dropdown (revisit only if a user has many connections).
- No new animation library — CSS transitions only, gated by `prefers-reduced-motion`.
- No layout changes outside this panel.

---

## 2. Current State (what we're replacing)

`ConnectionPanel.tsx` renders:

```
<Panel>
  <Panel.Header title="Connections" right={+ IconButton} />
  <Panel.Body>
    <ul>
      {connections.map(c =>
        <li class=item>                      // .item has border-bottom (the divider)
          <div class=row borderLeft=envColor> // sticky
            ● name  <button>Connect|Disconnect</button>  // raw native button
          </div>
          {connected && expanded && <ConnectionTree/>}
        </li>
      )}
    </ul>
  </Panel.Body>
  ... dialogs + context menu ...
</Panel>
```

Problems: every saved connection is always listed (no "empty" calm); the native `<button>` is
visually jarring against the near-black panel; `.item { border-bottom }` reads as a cheap table;
the `●` dot and thin left border are the only visual signal.

---

## 3. Target Behavior

### 3.1 States

1. **Opening / none connected** — Body shows only the sticky **Connect** button. Calm and intentional. (No "Active" section, no rows.)
2. **Launcher open** — Clicking Connect opens a dropdown anchored under the button.
3. **Connected** — Each connected connection appears in the body under an **"Active"** group label, expandable into its DB→collection tree. The Connect button stays at the top for connecting more.

### 3.2 The Connect launcher (dropdown)

- **Trigger:** solid-accent button, full width within panel padding: lightning icon + label `Connect` + chevron (`▾` closed / `▴` open). Sticky at `top: 0` so it is reachable while trees scroll. `aria-haspopup="menu"`, `aria-expanded`.
- **Menu items** = `connections.filter(c => !connectedIds.has(c.id))`, each rendered as:
  - env-color dot (`connection.color`, falls back to `--fg-dim` when unset),
  - `name` (primary),
  - **subtitle** = `connectionSummary(connection.target)` (see §4.2), monospace, dimmed, truncated,
  - an `SSH` badge when `connection.ssh` is present.
- A separator, then **"New connection…"** → sets `creating = true` (opens `ConnectionDialogV2` in create mode — the existing path).
- **Empty inventory** (`connections.length === 0`): menu shows a muted "No saved connections yet" line above "New connection…".
- **All connected** (filter yields none): menu shows a muted "All connections are active" line above "New connection…".
- **Pick an item** → call `actions.connect(c)` and close the menu. The existing `connect` flow auto-marks connected, expands the tree, and sets active; SSH passphrase / host-key / error dialogs fire unchanged.
- **Right-click an item** → the launcher closes and bubbles the request up via `onItemContextMenu(connection, x, y)`; the panel renders its existing `ContextMenu` with **Edit / Duplicate / Delete** (no Disconnect — the connection isn't live). This preserves CRUD for not-yet-connected connections, which previously lived on the inline row.
- **Dismissal:** Escape, outside-click (mousedown outside), or selecting an item. Reuse the dismissal effect pattern from `ContextMenu.tsx`.
- **Keyboard:** `↑`/`↓` move highlight, `Enter` activates, `Esc` closes, focus returns to the trigger on close.

### 3.3 Active connections (body)

Body maps `connections.filter(c => connectedIds.has(c.id))`. Each connected connection:

- **Header row** — borderless, `border-radius: var(--radius-sm)`, `:hover { background: var(--bg-hover) }`, sticky (pins while its tree scrolls). Contents: a caret (expand/collapse, driven by `actions.expandedConns`), env-color dot, `name` (semibold), and a **live indicator** — a small `--accent` dot with a soft glow (`box-shadow: 0 0 7px var(--accent)`). The old `<button>` is gone.
- **Click name/caret** → `actions.toggleExpanded(c.id)`.
- **Expanded** → existing `<ConnectionTree>` (unchanged logic; icon CSS polish only).
- **Right-click** → existing `ContextMenu` with items **Disconnect** (new, → `actions.disconnect(c)`), Edit, Duplicate, Delete.

### 3.4 Header

Keep `Panel.Header` `title="Connections"` and the `+` `IconButton` (quick New connection). It is redundant with the dropdown's "New connection…" but is a cheap always-visible affordance; retained.

---

## 4. Component Architecture

### 4.1 New: `ConnectLauncher`

`src/components/features/connections/ConnectLauncher.tsx` (+ `ConnectLauncher.module.css`).

```ts
interface ConnectLauncherProps {
  // connections not currently connected — the menu's pickable items
  available: Connection[];
  hasAnySaved: boolean;          // distinguishes "no saved" vs "all connected" empty copy
  onConnect: (c: Connection) => void;
  onNewConnection: () => void;
  // right-click on an item → panel renders its ContextMenu (Edit/Duplicate/Delete)
  onItemContextMenu: (c: Connection, x: number, y: number) => void;
}
```

Owns only open/close state + keyboard/dismiss handling + anchored positioning (menu positioned
relative to the trigger via a wrapping `position: relative` container, not fixed x/y — it tracks
the button). Purely presentational beyond that; all data/actions are passed in. The menu item is a
small internal `LauncherItem` subcomponent so its markup stays isolated and testable.

**Why not reuse `ContextMenu`?** `ContextMenu` items are `{label, action}` only — no room for the
dot/subtitle/badge layout, and it positions at fixed `(x, y)` for right-click. The launcher is a
button-anchored, richly-rendered popover; a dedicated component is the right boundary. `ContextMenu`
is left untouched for the right-click menu.

**Extension contract:** to add a new launcher entry type (e.g. a "Recent" group), add it to the
items the panel passes in and extend `LauncherItem`'s union; no change to dismissal/positioning.

### 4.2 New: `connectionSummary` (registry, pure, tested)

`src/components/features/connections/connectionSummary.ts` — derives the subtitle from
`Connection['target']`. Implemented as a **registry keyed by `target.kind`** to match the connection
model's stated extension contract (new target kinds are expected):

```ts
// One formatter per target kind. Each receives the narrowed variant.
const SUMMARY_BY_KIND = {
  uri:    (t: Extract<ConnectionTarget, { kind: 'uri' }>)    => redactUri(t.uri),  // strip user:pass@
  direct: (t: Extract<ConnectionTarget, { kind: 'direct' }>) =>
            `${t.host}:${t.port}${t.replicaSet ? ` · ${t.replicaSet}` : ''}`,
} satisfies { [K in ConnectionTarget['kind']]: (t: Extract<ConnectionTarget, { kind: K }>) => string };

export function connectionSummary(t: ConnectionTarget): string {
  return (SUMMARY_BY_KIND[t.kind] as (t: ConnectionTarget) => string)(t);
}
```

The `satisfies` clause makes the compiler fail if a future `ConnectionTarget` kind is added without
a matching formatter — enforcing the extension contract at build time.

`// implement a new entry in SUMMARY_BY_KIND to support a new target kind. No other changes needed.`
`redactUri` removes credentials from the authority (`mongodb+srv://user:pass@host` → `mongodb+srv://host`).

### 4.3 Changed: `ConnectionPanel.tsx`

- Render `<ConnectLauncher>` as the first element of `Panel.Body`, fed `available = connections.filter(c => !connectedIds.has(c.id))`, `hasAnySaved = connections.length > 0`, `onConnect = actions.connect`, `onNewConnection = () => setCreating(true)`, and `onItemContextMenu = (c, x, y) => setContextMenu({ x, y, connection: c })` (reuses the existing `contextMenu` state and `ContextMenu` render).
- The `ContextMenu` items become a function of whether the target is connected: connected → `[Disconnect, Edit, Duplicate, Delete]`; not connected → `[Edit, Duplicate, Delete]`.
- Body list maps **only connected** connections; wrap in an "Active" group label that renders only when ≥1 is connected.
- Delete the inline raw `<button>` Connect/Disconnect block.
- Context menu: add a leading `Disconnect` item (→ `actions.disconnect`).
- Everything else (dialogs, SSH prompts, effects) unchanged.

### 4.4 Changed: CSS

- `ConnectionPanel.module.css`: **remove** `.item { border-bottom }`. Rework `.row` → borderless, `border-radius`, hover bg, keep `position: sticky` but its `top` becomes the launcher's height (see §5). Status dot rule → env dot + `.live` glow class. Add `.groupLabel` (uppercase, `--fg-dim`, `--fs-xs`).
- `ConnectionTree.module.css`: minor polish only — confirm caret/`.colIcon`/`.children::before` guide match the mockup; no structural change.

### 4.5 Unchanged

`useConnectionsV2`, `useConnectionActions`, `ConnectionTree.tsx` logic, `ConnectionDialogV2`,
`PassphraseDialog`, `HostKeyDialog`, `ConnectionErrorDialog`, `ContextMenu.tsx`.

---

## 5. Sticky / Scroll Handling

The panel mounts inside `.viewSlotScrollable` (SidePanel), which owns vertical scroll — so
`Panel.Body` keeps `overflow: visible` and children use `position: sticky` (see the comment block
atop `ConnectionPanel.module.css`). With the launcher now sticky at the top, the sticky offsets must
stack:

- Connect button: `position: sticky; top: 0; z-index: 3;`
- Connection header row: `top: var(--connect-btn-h); z-index: 2;`
- DB row (in `ConnectionTree`): `top: calc(var(--connect-btn-h) + var(--conn-row-h));`

Introduce a `--connect-btn-h` CSS variable (button height incl. its margin) alongside the existing
`--conn-row-h`, declared where both are visible (panel scope) so the tree's offset stays correct.
All sticky elements need an opaque `background: var(--bg-panel)` so scrolled content is masked.

---

## 6. Accessibility & Motion

- Trigger: `aria-haspopup="menu"`, `aria-expanded={open}`. Menu: `role="menu"`, items `role="menuitem"`.
- Full keyboard support in the menu (§3.2); focus returns to the trigger on close.
- Env dot is decorative; the connection name is the accessible label. The `SSH` badge has an accessible label ("SSH tunnel").
- Open/close and hover transitions use `--dur-fast`/`--ease-standard`; **all motion disabled under `prefers-reduced-motion`** (consistent with the precision refactor).
- Accent button text uses `--accent-contrast` for AA contrast on the accent fill (already a token).

---

## 7. Edge Cases

| Case | Behavior |
|---|---|
| Zero saved connections | Launcher visible; menu shows "No saved connections yet" + New connection… |
| All saved are connected | Menu shows "All connections are active" + New connection… |
| Connect in flight (SSH prompt) | Existing passphrase/host-key dialog shows; row appears in body once `connectedIds` includes it |
| Connection drops (`ssh_session_lost`) | Existing effect marks disconnected → it leaves the body and re-appears in the dropdown |
| Disconnect | Row leaves the body (existing `disconnect` clears expanded + active); becomes available in the dropdown again |
| `color` unset | Env dot uses `--fg-dim` |
| Long name / URI | Truncate with ellipsis (existing pattern) |

---

## 8. Testing Plan

**Unit — `connectionSummary.test.ts` (new):**
- `uri` target → credentials redacted; bare URI passthrough.
- `direct` target → `host:port`; with `replicaSet` → appended.
- Unknown-kind safety (type-level; registry covers all current kinds).

**Component — `ConnectLauncher.test.tsx` (new):**
- Closed by default; click opens; `aria-expanded` toggles.
- Lists exactly the `available` connections with name + subtitle (+ SSH badge when tunneled).
- Picking an item calls `onConnect` with that connection and closes.
- Right-clicking an item calls `onItemContextMenu` with the connection + coords and closes.
- "New connection…" calls `onNewConnection`.
- Escape and outside-click close; focus returns to trigger.
- Empty-inventory and all-connected copy variants render.

**Component — `ConnectionPanel` tests (update existing):**
- `connection-panel.test.tsx` / `connection-panel.dialog-v2.test.tsx`: remove assertions on the old inline Connect/Disconnect buttons; assert (a) launcher present, (b) empty state shows only launcher (no rows), (c) only connected connections appear in the body, (d) no `.item` divider, (e) right-click menu includes Disconnect/Edit/Duplicate/Delete.
- `connection-tree.test.tsx`: unaffected logically; adjust only if icon markup assertions break.

Run `npm test` (vitest) — all green before merge.

---

## 9. File Change Summary

| File | Change |
|---|---|
| `connections/ConnectLauncher.tsx` | **new** — anchored dropdown launcher |
| `connections/ConnectLauncher.module.css` | **new** — button + menu styling (tokens only) |
| `connections/connectionSummary.ts` | **new** — target→subtitle registry |
| `connections/__tests__/connectionSummary.test.ts` | **new** |
| `connections/__tests__/ConnectLauncher.test.tsx` | **new** |
| `connections/ConnectionPanel.tsx` | launcher at top; body = connected-only; drop raw buttons; +Disconnect menu item |
| `connections/ConnectionPanel.module.css` | remove divider; borderless rows; env dot + live glow; sticky offsets; group label |
| `connections/ConnectionTree.module.css` | minor icon/guide polish |
| `connections/__tests__/connection-panel*.test.tsx` | update for new structure |

---

## 10. Extension Contract (summary)

- **New connection target kind** → add one formatter to `SUMMARY_BY_KIND` in `connectionSummary.ts`. Nothing else changes.
- **New launcher entry / group** → extend the items the panel passes to `ConnectLauncher` and the `LauncherItem` union. Dismissal/positioning untouched.
- **New per-connection right-click action** → add a `ContextMenu` item in `ConnectionPanel.tsx` (unchanged pattern).
