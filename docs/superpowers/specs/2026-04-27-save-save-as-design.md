# Save/Save As Functionality Design

## Overview

Add "Save" (update existing) and "Save As" (create new) functionality to the script editor. Current behavior only supports creating new scripts. This design enables updating existing saved scripts and tracking which saved script a tab is associated with.

## User Stories

1. **Load and update saved script**: User opens a script from SavedScriptsPanel, edits it, clicks "Save" to update the original without renaming
2. **Save unsaved script once, then update**: User double-clicks a collection to open a script tab, clicks "Save As" to create a saved script, then clicks "Save" on subsequent edits to update that script
3. **Save as new variant**: User opens a saved script, modifies it, clicks "Save As" to create a new saved script without overwriting the original

## Context

### Current Behavior

- Single "Save" button that always creates new scripts via `createScript()`
- Tab ID format indicates origin:
  - From saved script: `script:${savedScriptId}`
  - From collection: `script:${connId}:${db}:${col}:${timestamp}`
- Tab isDirty indicator ("•") shows unsaved changes

### Requirements

- "Save" (update existing) appears only when tab is associated with a saved script
- "Save As" (create new) always appears
- Tab isDirty indicator ("•") shows when content modified
- "Save" updates silently without prompt
- "Save As" prompts for name only
- After "Save As", tab becomes associated with new script for future "Save" operations

## Design

### 1. Data Model Changes

Add `savedScriptId` field to `EditorTab`:

```typescript
export interface EditorTab {
  id: string;
  title: string;
  content: string;
  isDirty: boolean;
  type: 'script';
  connectionId?: string;
  database?: string;
  collection?: string;
  savedScriptId?: string;  // NEW: tracks associated saved script
}
```

**Field behavior:**
- `undefined` when tab opened from collection double-click
- Set to script ID when opened from SavedScriptsPanel
- Updated to new script ID after successful "Save As"
- Unchanged after successful "Save"

### 2. UI Changes

**ContextBar button layout:**

Replace single "Save" button with side-by-side buttons:
- **"Save"** — conditionally rendered when `savedScriptId` exists
- **"Save As"** — always rendered

**Visual indicators:**
- Existing tab isDirty indicator ("•") shows unsaved changes in tab title
- No additional asterisks on buttons

### 3. Save Operations

#### "Save" (Update Existing)

**Trigger:** Click "Save" button (only visible when `savedScriptId` exists)

**Flow:**
1. Call `updateScript(savedScriptId, currentName, content, currentTags, connectionId)`
2. Mark tab clean: `isDirty: false`
3. Keep `savedScriptId` unchanged
4. Bump `savedScriptsVersion` to refresh SavedScriptsPanel

**No prompt:** Updates silently with existing metadata

#### "Save As" (Create New)

**Trigger:** Click "Save As" button (always visible)

**Flow:**
1. Show modal prompt for script name
2. Call `createScript(name, content, "", connectionId)` with empty tags
3. Update tab state:
   - Set `savedScriptId` to new script ID
   - Set `title` to new name
   - Set `isDirty: false`
4. Bump `savedScriptsVersion` to refresh SavedScriptsPanel

**Prompt:** Simple text input for name, no tags or connection selection

### 4. Tab Opening Behavior

#### Opening from SavedScriptsPanel

**Current code (SavedScriptsPanel.tsx:77-86):**
```typescript
function open(s: SavedScript) {
  const tab: EditorTab = {
    id: `script:${s.id}`,
    title: s.name,
    content: s.content,
    isDirty: false,
    type: 'script',
  };
  openTab(tab);
}
```

**Change:** Add `savedScriptId: s.id` to tab

**Result:** Tab opens clean (no "•"), "Save" button visible

#### Opening from Collection Double-Click

**Current code (ConnectionPanel.tsx:44-55):**
```typescript
function openCollectionScriptTab(db: string, col: string, cId: string) {
  openTab({
    id: `script:${cId}:${db}:${col}:${Date.now()}`,
    title: col,
    content: `db.getCollection("${col}").find({})`,
    isDirty: false,
    type: 'script',
    connectionId: cId,
    database: db,
    collection: col,
  });
}
```

**Change:** No `savedScriptId` field (implicitly undefined)

**Result:** Tab opens clean, only "Save As" button visible

### 5. Component Changes

#### SavedScriptsPanel.tsx

- Update `open()` to include `savedScriptId: s.id`

#### EditorArea.tsx

**Current:**
- Single `handleSave(name, tags)` handler
- Prompts for name and tags
- Always creates new script

**New:**
- Split into two handlers:
  - `handleSave()` — no prompt, silent update via `updateScript()`
  - `handleSaveAs()` — prompt for name, create via `createScript()`, update tab state
- Pass both handlers to ContextBar
- Retrieve existing script metadata (name, tags) for "Save" operation

#### ContextBar.tsx

**Current:**
- Single `onSave: (name: string, tags: string) => void` prop
- Single "Save" button that prompts and calls `onSave`

**New:**
- Two props:
  - `onSave: () => void` — no parameters
  - `onSaveAs: () => void`
- Conditionally render "Save" button when `savedScriptId` exists
- Always render "Save As" button
- "Save As" shows prompt dialog for name input
- Move prompt logic from EditorArea to ContextBar

### 6. Edge Cases

#### Script Deleted While Tab Open

**Scenario:** User opens saved script, another process deletes it, user clicks "Save"

**Behavior:**
- `updateScript()` returns error (script not found)
- Show error message to user
- Suggest using "Save As" instead

**Implementation:** Handle error in `handleSave()`, display alert

#### Name Conflicts on "Save As"

**Scenario:** User enters name that already exists

**Behavior:** Backend allows duplicate names (current behavior)

**No validation needed**

#### Tab State After Refresh

**Scenario:** User opens saved script, refreshes browser, `savedScriptId` lost

**Behavior:**
- Zustand store is memory-only, state lost on refresh
- Tab loses association, only "Save As" available
- Consistent with current `isDirty` behavior after refresh

**Acceptable limitation:** No persistence layer for tab state

#### Connection/Database Changes

**Scenario:** User opens saved script, changes connection/database in ContextBar, clicks "Save"

**Behavior:**
- "Save" updates script with new connection context
- Saved script's `connectionId` field updated

**Acceptable:** User intent is to update script's connection binding

## Implementation Notes

### Backend Commands (No Changes)

Existing Tauri commands already support both operations:

```rust
// src-tauri/src/commands/saved_script.rs
create_script(name, content, tags, connection_id) -> SavedScriptRecord
update_script(id, name, content, tags, connection_id) -> SavedScriptRecord
```

### Retrieving Existing Script Metadata

For "Save" operation, need current script name and tags. Two options:

**Option A:** Store in tab state (add `savedScriptName` and `savedScriptTags` to EditorTab)
- Pros: No async lookup needed
- Cons: Duplicate state, can drift from backend

**Option B:** Look up from SavedScriptsPanel state or fetch on-demand
- Pros: Single source of truth
- Cons: Async complexity, panel state might not be loaded

**Recommendation:** Option A (store in tab). Name already stored as `title`, add `savedScriptTags` field to EditorTab. Update when opening from saved script and when "Save As" succeeds.

### Updated EditorTab Schema

```typescript
export interface EditorTab {
  id: string;
  title: string;
  content: string;
  isDirty: boolean;
  type: 'script';
  connectionId?: string;
  database?: string;
  collection?: string;
  savedScriptId?: string;
  savedScriptTags?: string;  // NEW: for "Save" operation metadata
}
```

## Migration

No data migration needed — field additions are optional and default to `undefined`. Existing tabs continue working with "Save As" only.

## Testing Scenarios

1. **Open from saved script, edit, Save** — updates original, stays clean
2. **Open from saved script, edit, Save As** — creates new, tab now associated with new script
3. **Open from collection, edit, Save As** — creates new, tab now associated
4. **Open from collection, edit, Save As, edit, Save** — updates the script created in Save As
5. **Open from saved script, delete script externally, Save** — shows error
6. **Open from saved script, refresh browser, edit** — only "Save As" available

## Open Questions

None — all design decisions finalized.
