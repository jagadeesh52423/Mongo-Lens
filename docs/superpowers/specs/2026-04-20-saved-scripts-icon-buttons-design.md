# Saved Scripts Panel — Icon Buttons & Duplicate Design

**Date:** 2026-04-20  
**Status:** Approved

---

## Overview

Replace the text "Delete" button in the saved scripts panel with icon buttons for delete and duplicate. Add an inline confirmation popover for delete. Add smart duplicate naming that increments a trailing counter.

---

## Decisions

| Topic | Decision |
|---|---|
| Button style | Ghost borders (neutral, color reveals on hover) |
| Action visibility | Hidden until row hover |
| Delete confirmation | Inline popover below the row (Approach A) |
| Duplicate implementation | Frontend-only via existing `createScript` IPC |

---

## Component Changes

**File:** `src/components/saved-scripts/SavedScriptsPanel.tsx`

### New State

```ts
const [confirmingId, setConfirmingId] = useState<string | null>(null);
```

### Row Layout

Each `<li>` row renders:
1. Script name + tags (clickable, `flex: 1`)
2. `.actions` div — two ghost-border icon buttons: ⧉ (duplicate) and 🗑 (delete)
3. If `confirmingId === s.id`: a `.confirm-popover` div rendered after the row content

Actions div is `opacity: 0` by default; `opacity: 1` on row hover via CSS group pattern (CSS-in-JS `onMouseEnter`/`onMouseLeave` on the `<li>`, or a hover state variable per row).

### Delete Flow

1. Click 🗑 → `setConfirmingId(s.id)`
2. Inline popover shows: `Delete "name"? This cannot be undone.` + Cancel + Delete buttons
3. Cancel → `setConfirmingId(null)`
4. Delete → `deleteScript(s.id)`, `reload()`, `setConfirmingId(null)`

Removes the existing `browser.confirm()` call entirely.

### Duplicate Flow

1. Click ⧉ → `handleDuplicate(s)`
2. Compute `newName = nextDuplicateName(scripts.map(s => s.name), s.name)`
3. Call `createScript(newName, s.content, s.tags, s.connectionId)` (existing IPC)
4. `reload()`

### Naming Logic

```ts
function nextDuplicateName(existingNames: string[], base: string): string {
  const match = base.match(/^(.*?)\((\d+)\)$/);
  const stem = match ? match[1] : base;
  const start = match ? parseInt(match[2], 10) + 1 : 1;
  for (let n = start; ; n++) {
    const candidate = `${stem}(${n})`;
    if (!existingNames.includes(candidate)) return candidate;
  }
}
```

**Examples:**
- `script` → `script(1)`
- `script(1)` → `script(2)`
- `find-duplicates(23)` → `find-duplicates(24)`
- `script(1)` when `script(2)` already exists → `script(3)`

### Icon Button Styles (inline CSS)

```ts
// Ghost border base
{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 4,
  width: 22, height: 22, cursor: 'pointer', color: 'var(--fg-dim)', fontSize: 13 }

// Duplicate hover: blue tint
{ background: '#2d4a6e', color: '#7cb8f0', borderColor: '#2d4a6e' }

// Delete hover: red tint
{ background: '#5c1f1f', color: '#f07070', borderColor: '#5c1f1f' }
```

### Confirm Popover Styles (inline CSS)

Renders as a `<div>` inside the `<li>` after the flex row, full width:

```ts
{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 6,
  padding: '10px 12px', marginTop: 4, fontSize: 13 }
```

Contains: message text + Cancel + Delete buttons right-aligned.

---

## Files Changed

| File | Change |
|---|---|
| `src/components/saved-scripts/SavedScriptsPanel.tsx` | All changes — state, handlers, JSX, styles |

No IPC changes. No backend changes. No new files.

---

## IPC Used

| Function | Already exists? |
|---|---|
| `listScripts()` | Yes |
| `deleteScript(id)` | Yes |
| `createScript(name, content, tags, connectionId?)` | Yes |
