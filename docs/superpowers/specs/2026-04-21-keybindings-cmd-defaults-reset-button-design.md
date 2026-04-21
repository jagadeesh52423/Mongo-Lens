# Keybindings: Mac Cmd Defaults + Per-Row Reset Button

**Date:** 2026-04-21  
**Scope:** `src/shortcuts/defaults.ts`, `src/settings/sections/ShortcutsSection.tsx`

---

## Summary

Two changes to the keyboard shortcut system:

1. Change Mac default shortcuts from Ctrl to Cmd where appropriate
2. Add a visible per-row reset button in the Shortcuts settings UI

---

## 1. Default Shortcut Changes

**File:** `src/shortcuts/defaults.ts`

Replace `ctrl: true` with `cmd: true` for the following shortcuts:

| ID | Old Combo | New Combo |
|---|---|---|
| `tab.close` | Ctrl+W | Cmd+W |
| `tab.new` | Ctrl+T | Cmd+T |
| `tab.goTo.1` | Ctrl+1 | Cmd+1 |
| `tab.goTo.2` | Ctrl+2 | Cmd+2 |
| `tab.goTo.3` | Ctrl+3 | Cmd+3 |
| `tab.goTo.4` | Ctrl+4 | Cmd+4 |
| `tab.goTo.5` | Ctrl+5 | Cmd+5 |
| `tab.goTo.6` | Ctrl+6 | Cmd+6 |
| `tab.goTo.7` | Ctrl+7 | Cmd+7 |
| `tab.goTo.8` | Ctrl+8 | Cmd+8 |
| `tab.goTo.9` | Ctrl+9 | Cmd+9 |

**Unchanged (intentional):**
- `tab.next`: Ctrl+Tab — macOS convention for tab cycling
- `tab.prev`: Ctrl+Shift+Tab — macOS convention for tab cycling
- `cell.copyField`: Ctrl+Cmd+C — kept as-is (combined modifier, no conflict)

---

## 2. Per-Row Reset Button

**File:** `src/settings/sections/ShortcutsSection.tsx`

### Behavior

- A ↺ (reset) icon button appears at the far right of each shortcut row on hover
- Visible on **every** row hover, regardless of override status
- **Disabled** (greyed out, non-interactive) when the shortcut is already at its default (no override in store)
- **Enabled** when the shortcut has a custom override — clicking calls `resetShortcut(id)`
- Tooltip: `"Reset to default"`
- Existing right-click → "Reset to default" context menu is preserved
- Existing "Reset All" button is preserved

### Implementation

- Add `group` Tailwind class to the shortcut row container
- Reset button uses `opacity-0 group-hover:opacity-100` transition for hover reveal
- Disabled state: `opacity-50 cursor-not-allowed` when no override exists
- Icon: use an existing icon from the project's icon set (e.g., `RotateCcw` from lucide-react)
- `resetShortcut(id)` already exists in `src/store/settings.ts` — no store changes needed

### Logic

```
hasOverride = shortcutOverrides[shortcut.id] !== undefined
isDisabled  = !hasOverride
onClick     = () => resetShortcut(shortcut.id)
```

---

## Files Changed

| File | Change |
|---|---|
| `src/shortcuts/defaults.ts` | Update 11 shortcut entries from ctrl to cmd |
| `src/settings/sections/ShortcutsSection.tsx` | Add hover reset button per row |

No changes to: `KeyboardService.ts`, `settings.ts`, hooks, tests.
