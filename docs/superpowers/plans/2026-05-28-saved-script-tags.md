# Saved Script Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Saved Script tags first-class — render as chips, allow inline edit on existing scripts, filter the list by clicking a tag, and provide a "Manage tags" view to rename or delete a tag globally across scripts.

**Architecture:** Normalize tags from a single comma-separated `string` to `string[]` at every layer (Rust DTO, IPC, TS types, UI). The SQLite column stays `TEXT`; Rust parses/serializes as comma-separated at the storage boundary (split→trim→dedupe→drop-empties on read; `tags.join(",")` on write). UI introduces a generic `TagList` chip renderer, an inline `EditTagsPopover` with autocomplete from existing tags, click-to-filter active-filter state in `SavedScriptsPanel`, and a new `ManageTagsDialog` for global rename/delete. Tag operations on the backend are pure SQL string ops over the existing `tags` column (no separate tag table) — keeps schema unchanged.

**Tech Stack:** Rust (Tauri commands + rusqlite), TypeScript/React, Vitest, Cargo tests.

---

## File Structure

**Rust (backend)**
- Modify: `src-tauri/src/db/scripts.rs` — change `SavedScriptRecord.tags: String` → `Vec<String>`; add parse/serialize helpers; add `rename_tag_everywhere`, `delete_tag_everywhere` SQL ops.
- Modify: `src-tauri/src/commands/saved_script.rs` — change `tags: String` params → `Vec<String>`; add `rename_tag`, `delete_tag` commands.
- Modify: `src-tauri/src/main.rs` — register the two new commands.

**TypeScript (types + IPC)**
- Modify: `src/types.ts` — `SavedScript.tags: string` → `string[]`; `EditorTab.savedScriptTags?: string` → `string[]`.
- Modify: `src/ipc.ts` — `tags: string` params → `string[]`; add `renameTag`, `deleteTag`.

**UI**
- Create: `src/components/features/saved-scripts/TagList.tsx` + `.module.css` — small chip renderer; props: `tags`, optional `onClick(tag)`, optional `onRemove(tag)`.
- Create: `src/components/features/saved-scripts/EditTagsPopover.tsx` + `.module.css` — inline popover for editing tags on a row; autocomplete from a passed `allTags: string[]`.
- Create: `src/components/features/saved-scripts/ManageTagsDialog.tsx` + `.module.css` — modal listing all tags with counts; rename/delete affordances.
- Modify: `src/components/features/saved-scripts/SavedScriptsPanel.tsx` + `.module.css` — render `TagList` per row; add "Edit tags" action; add active-filter chip strip; add "Manage tags" button in header.
- Modify: `src/components/features/saved-scripts/SaveScriptDialog.tsx` — input UX unchanged (accept comma-separated text), convert to `string[]` on submit; props become `initialTags?: string[]` / `onSave(name, tags: string[])`.
- Modify: `src/components/features/editor/ContextBar.tsx` + `src/components/features/editor/useEditorActions.ts` — pass `string[]` through the Save / Save As path.

**Tests**
- Modify/extend: `src-tauri/src/db/scripts.rs` tests — array round-trip, rename, delete, dedupe.
- Modify/extend: `src/__tests__/saved-scripts.test.tsx` — chips render, click-to-filter, edit-tags popover, manage-tags dialog rename/delete, empty-tag filtering, dedup behaviour.
- Modify: `src/__tests__/types.test.ts`, `src/__tests__/editor-area.test.tsx`, `src/__tests__/context-bar.test.tsx`, `src/__tests__/integration/save-flow.test.tsx` — adapt to `string[]` shape.

---

## Cross-cutting Rules (apply to every task)

- **Tag normalization** (single source of truth, repeated to avoid drift across tasks): a tag is a non-empty trimmed string; the canonical list has no duplicates (case-insensitive dedupe), no empties, preserves input order on first occurrence, and is matched case-insensitively for filter/rename/delete.
- **Storage at rest**: the SQL column `saved_scripts.tags TEXT` stays. Rust serializes `Vec<String>` ↔ comma-separated string at the rusqlite boundary. **No schema migration**: existing rows like `"mongo,find"` parse cleanly to `["mongo","find"]`; rows with `""` parse to `[]`.
- **Run `/code-standards` before writing code in every task.** This is mandatory.
- **Read existing files in the touched module before editing**, to match conventions.
- **Run after every Rust edit**: `cargo test --manifest-path src-tauri/Cargo.toml` and `cargo build --manifest-path src-tauri/Cargo.toml`.
- **Run after every TS edit**: `npm test -- --run <changed test file>` (then full `npm test -- --run` once at task end).
- **Harness deploy rule** does not apply here — none of these tasks edit `runner/*.js`.
- **Commit after each task.** Conventional Commits: `feat(saved-scripts): …`, `refactor(saved-scripts): …`, etc.

---

## Task 1: Rust — tags as Vec<String> at the DB boundary

**Files:**
- Modify: `src-tauri/src/db/scripts.rs`
- Test: same file (`#[cfg(test)] mod tests`)

- [ ] **Step 1: Read existing file** to confirm `SavedScriptRecord` shape and the sample test helper.

- [ ] **Step 2: Replace `SavedScriptRecord` definition and helpers**

```rust
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedScriptRecord {
    pub id: String,
    pub name: String,
    pub content: String,
    pub tags: Vec<String>,
    pub connection_id: Option<String>,
    pub last_run_at: Option<String>,
    pub created_at: String,
}

/// Parse the stored TEXT column into the canonical tag list:
/// trim, drop empties, case-insensitive dedupe, preserve first-seen order.
pub fn parse_tags(raw: &str) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    for part in raw.split(',') {
        let t = part.trim();
        if t.is_empty() { continue; }
        let lower = t.to_lowercase();
        if seen.iter().any(|s| s.to_lowercase() == lower) { continue; }
        seen.push(t.to_string());
    }
    seen
}

pub fn serialize_tags(tags: &[String]) -> String {
    parse_tags(&tags.join(",")).join(",")
}

fn map_row(row: &Row) -> rusqlite::Result<SavedScriptRecord> {
    let raw_tags: String = row.get(3)?;
    Ok(SavedScriptRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        content: row.get(2)?,
        tags: parse_tags(&raw_tags),
        connection_id: row.get(4)?,
        last_run_at: row.get(5)?,
        created_at: row.get(6)?,
    })
}
```

- [ ] **Step 3: Update `insert` and `update` to serialize tags**

```rust
pub fn insert(conn: &Connection, rec: &SavedScriptRecord) -> rusqlite::Result<()> {
    let tags_str = serialize_tags(&rec.tags);
    conn.execute(
        "INSERT INTO saved_scripts (id,name,content,tags,connection_id,last_run_at,created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![
            rec.id, rec.name, rec.content, tags_str,
            rec.connection_id, rec.last_run_at, rec.created_at,
        ],
    )?;
    Ok(())
}

pub fn update(conn: &Connection, rec: &SavedScriptRecord) -> rusqlite::Result<()> {
    let tags_str = serialize_tags(&rec.tags);
    conn.execute(
        "UPDATE saved_scripts SET name=?2,content=?3,tags=?4,connection_id=?5 WHERE id=?1",
        params![rec.id, rec.name, rec.content, tags_str, rec.connection_id],
    )?;
    Ok(())
}
```

- [ ] **Step 4: Add `rename_tag_everywhere` and `delete_tag_everywhere`**

Both operate per-row: load all rows, parse tags, transform, serialize back. Rename is case-insensitive match; if the new tag already exists in a row, the rename collapses (dedupe). Delete removes case-insensitive matches.

```rust
/// Rename `old` → `new` across all scripts. Case-insensitive match on `old`.
/// Returns number of affected rows.
pub fn rename_tag_everywhere(conn: &Connection, old: &str, new: &str) -> rusqlite::Result<usize> {
    let old_lower = old.trim().to_lowercase();
    let new_trim = new.trim();
    if old_lower.is_empty() || new_trim.is_empty() {
        return Ok(0);
    }
    let mut stmt = conn.prepare("SELECT id, tags FROM saved_scripts")?;
    let rows: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut affected = 0usize;
    for (id, raw) in rows {
        let parsed = parse_tags(&raw);
        let mut changed = false;
        let mapped: Vec<String> = parsed
            .into_iter()
            .map(|t| {
                if t.to_lowercase() == old_lower {
                    changed = true;
                    new_trim.to_string()
                } else { t }
            })
            .collect();
        if changed {
            let canonical = serialize_tags(&mapped);
            conn.execute(
                "UPDATE saved_scripts SET tags = ?2 WHERE id = ?1",
                params![id, canonical],
            )?;
            affected += 1;
        }
    }
    Ok(affected)
}

/// Delete `tag` from every script that has it. Case-insensitive match.
/// Returns number of affected rows.
pub fn delete_tag_everywhere(conn: &Connection, tag: &str) -> rusqlite::Result<usize> {
    let target = tag.trim().to_lowercase();
    if target.is_empty() {
        return Ok(0);
    }
    let mut stmt = conn.prepare("SELECT id, tags FROM saved_scripts")?;
    let rows: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut affected = 0usize;
    for (id, raw) in rows {
        let parsed = parse_tags(&raw);
        let kept: Vec<String> = parsed
            .iter()
            .filter(|t| t.to_lowercase() != target)
            .cloned()
            .collect();
        if kept.len() != parsed.len() {
            let canonical = serialize_tags(&kept);
            conn.execute(
                "UPDATE saved_scripts SET tags = ?2 WHERE id = ?1",
                params![id, canonical],
            )?;
            affected += 1;
        }
    }
    Ok(affected)
}
```

- [ ] **Step 5: Update existing test `sample` helper and add new tests**

```rust
fn sample(id: &str, name: &str) -> SavedScriptRecord {
    SavedScriptRecord {
        id: id.into(),
        name: name.into(),
        content: "db.users.find({})".into(),
        tags: vec!["mongo".into(), "find".into()],
        connection_id: None,
        last_run_at: None,
        created_at: "2026-04-17T00:00:00Z".into(),
    }
}

#[test]
fn parse_tags_trims_dedupes_drops_empty() {
    assert_eq!(parse_tags(""), Vec::<String>::new());
    assert_eq!(parse_tags(" , ,, "), Vec::<String>::new());
    assert_eq!(parse_tags("a, b ,A,, b "), vec!["a".to_string(), "b".to_string()]);
}

#[test]
fn round_trip_preserves_canonical_tags() {
    let c = open_in_memory().unwrap();
    let mut rec = sample("1", "a");
    rec.tags = vec!["Prod".into(), "auth".into(), "PROD".into(), "  ".into()];
    insert(&c, &rec).unwrap();
    let got = get(&c, "1").unwrap().unwrap();
    assert_eq!(got.tags, vec!["Prod".to_string(), "auth".to_string()]);
}

#[test]
fn rename_tag_everywhere_renames_and_dedupes() {
    let c = open_in_memory().unwrap();
    let mut r1 = sample("1", "a"); r1.tags = vec!["prod".into(), "auth".into()];
    let mut r2 = sample("2", "b"); r2.tags = vec!["PROD".into()];
    let mut r3 = sample("3", "c"); r3.tags = vec!["other".into()];
    insert(&c, &r1).unwrap(); insert(&c, &r2).unwrap(); insert(&c, &r3).unwrap();
    let n = rename_tag_everywhere(&c, "prod", "production").unwrap();
    assert_eq!(n, 2);
    assert_eq!(get(&c, "1").unwrap().unwrap().tags, vec!["production".to_string(), "auth".to_string()]);
    assert_eq!(get(&c, "2").unwrap().unwrap().tags, vec!["production".to_string()]);
    assert_eq!(get(&c, "3").unwrap().unwrap().tags, vec!["other".to_string()]);
}

#[test]
fn rename_collapses_when_target_already_present() {
    let c = open_in_memory().unwrap();
    let mut r = sample("1", "a"); r.tags = vec!["prod".into(), "production".into()];
    insert(&c, &r).unwrap();
    let n = rename_tag_everywhere(&c, "prod", "production").unwrap();
    assert_eq!(n, 1);
    assert_eq!(get(&c, "1").unwrap().unwrap().tags, vec!["production".to_string()]);
}

#[test]
fn delete_tag_everywhere_removes_case_insensitively() {
    let c = open_in_memory().unwrap();
    let mut r1 = sample("1", "a"); r1.tags = vec!["Prod".into(), "auth".into()];
    let mut r2 = sample("2", "b"); r2.tags = vec!["other".into()];
    insert(&c, &r1).unwrap(); insert(&c, &r2).unwrap();
    let n = delete_tag_everywhere(&c, "prod").unwrap();
    assert_eq!(n, 1);
    assert_eq!(get(&c, "1").unwrap().unwrap().tags, vec!["auth".to_string()]);
    assert_eq!(get(&c, "2").unwrap().unwrap().tags, vec!["other".to_string()]);
}
```

- [ ] **Step 6: Run** `cargo test --manifest-path src-tauri/Cargo.toml -p mongomacapp scripts` — all green.

- [ ] **Step 7: Commit** `git add -A && git commit -m "refactor(scripts): tags as Vec<String> with canonical parse/serialize + global rename/delete ops"`

---

## Task 2: Rust — command layer + register new commands

**Files:**
- Modify: `src-tauri/src/commands/saved_script.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Change `create_script` and `update_script` signatures** to accept `tags: Vec<String>` and pass through unchanged (the `db::scripts` layer canonicalizes on serialize).

```rust
#[tauri::command]
pub fn create_script(
    state: State<'_, AppState>,
    name: String,
    content: String,
    tags: Vec<String>,
    connection_id: Option<String>,
) -> Result<SavedScriptRecord, String> {
    // existing logger init unchanged
    let conn = state.open_db().map_err(|e| e.to_string())?;
    let rec = SavedScriptRecord {
        id: uuid::Uuid::new_v4().to_string(),
        name, content, tags,
        connection_id,
        last_run_at: None,
        created_at: now_iso(),
    };
    db::scripts::insert(&conn, &rec).map_err(|e| e.to_string())?;
    Ok(rec)
}
```

Mirror the same change in `update_script` (replace `tags: String` with `tags: Vec<String>`; pass into `SavedScriptRecord`).

- [ ] **Step 2: Add two new commands `rename_tag` and `delete_tag`**

```rust
#[tauri::command]
pub fn rename_tag(
    state: State<'_, AppState>,
    old: String,
    new: String,
) -> Result<usize, String> {
    let log = state.logger.child(logctx! { "logger" => "commands.saved_script" });
    log.info("rename_tag", logctx! { "old" => old.clone(), "new" => new.clone() });
    let conn = state.open_db().map_err(|e| e.to_string())?;
    db::scripts::rename_tag_everywhere(&conn, &old, &new).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_tag(state: State<'_, AppState>, tag: String) -> Result<usize, String> {
    let log = state.logger.child(logctx! { "logger" => "commands.saved_script" });
    log.info("delete_tag", logctx! { "tag" => tag.clone() });
    let conn = state.open_db().map_err(|e| e.to_string())?;
    db::scripts::delete_tag_everywhere(&conn, &tag).map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Register the new commands in `src-tauri/src/main.rs`** — add `commands::saved_script::rename_tag,` and `commands::saved_script::delete_tag,` to the `invoke_handler!` list next to `list_scripts`.

- [ ] **Step 4: Run** `cargo build --manifest-path src-tauri/Cargo.toml` — clean build.

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(scripts): rename_tag and delete_tag Tauri commands"`

---

## Task 3: TypeScript types + IPC

**Files:**
- Modify: `src/types.ts`
- Modify: `src/ipc.ts`

- [ ] **Step 1: `src/types.ts`** — change `SavedScript.tags: string` → `string[]` and `EditorTab.savedScriptTags?: string` → `string[]`.

- [ ] **Step 2: `src/ipc.ts`** — change `tags: string` params on `createScript` and `updateScript` to `tags: string[]`. Add:

```ts
export async function renameTag(oldTag: string, newTag: string): Promise<number> {
  return invoke('rename_tag', { old: oldTag, new: newTag });
}

export async function deleteTag(tag: string): Promise<number> {
  return invoke('delete_tag', { tag });
}
```

- [ ] **Step 3: Type-check** `npx tsc --noEmit` — expect errors only in places we'll touch in later tasks (panel, dialog, editor actions, context bar, tests).

- [ ] **Step 4: Commit** `git add -A && git commit -m "refactor(types): SavedScript.tags is string[]; add renameTag/deleteTag IPC"`

---

## Task 4: TagList chip component

**Files:**
- Create: `src/components/features/saved-scripts/TagList.tsx`
- Create: `src/components/features/saved-scripts/TagList.module.css`
- Test: extend `src/__tests__/saved-scripts.test.tsx` (or new file `src/__tests__/tag-list.test.tsx`)

- [ ] **Step 1: Write a failing test** for the chip renderer in `src/__tests__/tag-list.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { TagList } from '../components/features/saved-scripts/TagList';

test('renders one chip per tag', () => {
  render(<TagList tags={['prod', 'auth']} />);
  expect(screen.getByText('prod')).toBeInTheDocument();
  expect(screen.getByText('auth')).toBeInTheDocument();
});

test('renders nothing when empty', () => {
  const { container } = render(<TagList tags={[]} />);
  expect(container).toBeEmptyDOMElement();
});

test('invokes onClick(tag) when chip clicked', () => {
  const onClick = vi.fn();
  render(<TagList tags={['prod']} onClick={onClick} />);
  fireEvent.click(screen.getByText('prod'));
  expect(onClick).toHaveBeenCalledWith('prod');
});

test('shows remove ✕ button when onRemove is provided', () => {
  const onRemove = vi.fn();
  render(<TagList tags={['prod']} onRemove={onRemove} />);
  fireEvent.click(screen.getByLabelText('Remove tag prod'));
  expect(onRemove).toHaveBeenCalledWith('prod');
});
```

- [ ] **Step 2: Run** `npm test -- --run src/__tests__/tag-list.test.tsx` — expect failure (component missing).

- [ ] **Step 3: Implement `TagList.tsx`**

```tsx
import { MouseEvent } from 'react';
import styles from './TagList.module.css';

interface Props {
  tags: string[];
  onClick?: (tag: string) => void;
  onRemove?: (tag: string) => void;
  selectedTag?: string;
}

export function TagList({ tags, onClick, onRemove, selectedTag }: Props) {
  if (!tags.length) return null;
  return (
    <span className={styles.list}>
      {tags.map((tag) => {
        const isSelected = selectedTag != null && tag.toLowerCase() === selectedTag.toLowerCase();
        const interactive = !!onClick;
        return (
          <span
            key={tag}
            className={`${styles.chip} ${isSelected ? styles.selected : ''} ${interactive ? styles.interactive : ''}`}
            onClick={
              interactive
                ? (e: MouseEvent) => { e.stopPropagation(); onClick!(tag); }
                : undefined
            }
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
          >
            {tag}
            {onRemove && (
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                className={styles.remove}
                onClick={(e) => { e.stopPropagation(); onRemove(tag); }}
              >
                ✕
              </button>
            )}
          </span>
        );
      })}
    </span>
  );
}
```

- [ ] **Step 4: Add `TagList.module.css`**

```css
.list { display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.chip {
  display: inline-flex; align-items: center; gap: 2px;
  font-size: var(--fs-xs);
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bg-2);
  color: var(--fg-dim);
  border: 1px solid var(--border);
  line-height: 1.4;
}
.interactive { cursor: pointer; }
.interactive:hover { background: var(--accent-blue-dim); color: var(--accent-blue); border-color: var(--accent-blue-dim); }
.selected { background: var(--accent-blue-dim); color: var(--accent-blue); border-color: var(--accent-blue); }
.remove {
  background: none; border: none; cursor: pointer;
  color: inherit; font-size: 10px; padding: 0 2px;
  line-height: 1;
}
.remove:hover { color: var(--accent-red); }
```

- [ ] **Step 5: Run** `npm test -- --run src/__tests__/tag-list.test.tsx` — all green.

- [ ] **Step 6: Commit** `git add -A && git commit -m "feat(saved-scripts): TagList chip component"`

---

## Task 5: SaveScriptDialog — switch to string[] surface

**Files:**
- Modify: `src/components/features/saved-scripts/SaveScriptDialog.tsx`
- Test: extend save-flow / saved-scripts tests as needed

- [ ] **Step 1: Update props and internal parsing**

```tsx
interface Props {
  initialName?: string;
  initialTags?: string[];
  onSave: (name: string, tags: string[]) => Promise<void>;
  onCancel: () => void;
}

export function SaveScriptDialog({ initialName = '', initialTags = [], onSave, onCancel }: Props) {
  const [name, setName] = useState(initialName);
  const [tagsText, setTagsText] = useState(initialTags.join(', '));
  // existing busy/err state

  function parseTags(input: string): string[] {
    const seen = new Map<string, string>(); // lowercase -> first-seen original
    for (const part of input.split(',')) {
      const t = part.trim();
      if (!t) continue;
      const k = t.toLowerCase();
      if (!seen.has(k)) seen.set(k, t);
    }
    return [...seen.values()];
  }

  async function submit() {
    if (!name.trim()) { setErr('Name is required'); return; }
    setBusy(true); setErr(null);
    try { await onSave(name.trim(), parseTags(tagsText)); }
    catch (e) { setErr((e as Error).message ?? String(e)); }
    finally { setBusy(false); }
  }
  // … remainder unchanged except value/onChange use tagsText
}
```

- [ ] **Step 2: Run** `npm test -- --run src/__tests__/integration/save-flow.test.tsx` — fix any expectations to use arrays.

- [ ] **Step 3: Commit** `git add -A && git commit -m "refactor(saved-scripts): SaveScriptDialog uses string[] tags"`

---

## Task 6: ContextBar + useEditorActions — propagate string[]

**Files:**
- Modify: `src/components/features/editor/ContextBar.tsx`
- Modify: `src/components/features/editor/useEditorActions.ts`

- [ ] **Step 1: `useEditorActions.ts`** — change all references to `savedScriptTags` to be `string[]`:

```ts
async function handleSave() {
  if (!active || active.type !== 'script' || !active.savedScriptId) return;
  try {
    const updated = await updateScript(
      active.savedScriptId, active.title, active.content,
      active.savedScriptTags ?? [], active.connectionId,
    );
    updateTab(active.id, { isDirty: false, savedScriptTags: updated.tags });
    bumpScriptsVersion();
  } catch (err) { /* unchanged */ }
}

async function handleSaveAs(name: string, tags: string[]) {
  if (!active || active.type !== 'script') return;
  const created = await createScript(name, active.content, tags, active.connectionId);
  updateTab(active.id, {
    title: name,
    savedScriptId: created.id,
    savedScriptTags: created.tags,
    isDirty: false,
  });
  bumpScriptsVersion();
}
```

- [ ] **Step 2: `ContextBar.tsx`** — change `onSaveAs: (name: string, tags: string) => Promise<void>` to `(name: string, tags: string[]) => Promise<void>`; ensure the dialog receives `initialTags={active.savedScriptTags ?? []}` and passes arrays.

- [ ] **Step 3: Update tests** `src/__tests__/context-bar.test.tsx`, `src/__tests__/editor-area.test.tsx` — adapt mock expectations to arrays.

- [ ] **Step 4: Run** `npm test -- --run src/__tests__/context-bar.test.tsx src/__tests__/editor-area.test.tsx` — green.

- [ ] **Step 5: Commit** `git add -A && git commit -m "refactor(editor): propagate savedScriptTags as string[]"`

---

## Task 7: SavedScriptsPanel — chip render + click-to-filter + edit-tags popover

**Files:**
- Modify: `src/components/features/saved-scripts/SavedScriptsPanel.tsx`
- Modify: `src/components/features/saved-scripts/SavedScriptsPanel.module.css`
- Create: `src/components/features/saved-scripts/EditTagsPopover.tsx`
- Create: `src/components/features/saved-scripts/EditTagsPopover.module.css`
- Test: extend `src/__tests__/saved-scripts.test.tsx`

- [ ] **Step 1: Failing tests in `saved-scripts.test.tsx`**

```tsx
test('renders each tag as its own chip', async () => {
  // mock listScripts to return [{id:'1', name:'q', tags:['prod','auth'], ...}]
  // assert two chips by text
});

test('clicking a tag chip filters list by that tag', async () => {
  // 2 scripts; one with ['prod'], one with ['auth']
  // click 'prod' chip on row A; only row A visible; chip strip shows "Filter: prod ✕"
});

test('clear-filter button removes the filter', async () => {
  // after filtering, click ✕; both rows visible again
});

test('"Edit tags" action opens popover; saving updates tags via updateScript', async () => {
  // open popover; type "newtag"; press Enter or click Save; updateScript called with array including newtag
});
```

- [ ] **Step 2: Implement `EditTagsPopover.tsx`**

```tsx
import { useState, useMemo, KeyboardEvent } from 'react';
import { TagList } from './TagList';
import styles from './EditTagsPopover.module.css';

interface Props {
  initial: string[];
  allTags: string[]; // suggestions
  onSave: (tags: string[]) => Promise<void>;
  onCancel: () => void;
}

export function EditTagsPopover({ initial, allTags, onSave, onCancel }: Props) {
  const [tags, setTags] = useState<string[]>(initial);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    const have = new Set(tags.map((t) => t.toLowerCase()));
    return allTags
      .filter((t) => !have.has(t.toLowerCase()))
      .filter((t) => !q || t.toLowerCase().includes(q))
      .slice(0, 6);
  }, [input, allTags, tags]);

  function add(tag: string) {
    const t = tag.trim();
    if (!t) return;
    if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    setTags([...tags, t]);
    setInput('');
  }

  function remove(tag: string) {
    setTags(tags.filter((t) => t.toLowerCase() !== tag.toLowerCase()));
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); add(input); }
    else if (e.key === 'Backspace' && !input && tags.length) {
      setTags(tags.slice(0, -1));
    } else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  }

  async function save() {
    setBusy(true);
    try { await onSave(tags); } finally { setBusy(false); }
  }

  return (
    <div className={styles.popover} role="dialog" aria-label="Edit tags">
      <TagList tags={tags} onRemove={remove} />
      <input
        autoFocus
        className={styles.input}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKey}
        placeholder="Add tag…"
      />
      {suggestions.length > 0 && (
        <ul className={styles.suggest}>
          {suggestions.map((s) => (
            <li key={s}>
              <button type="button" onClick={() => add(s)}>{s}</button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.actions}>
        <button onClick={onCancel} disabled={busy}>Cancel</button>
        <button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add `EditTagsPopover.module.css`**

```css
.popover {
  position: absolute; z-index: 20;
  background: var(--bg-1); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: var(--space-2);
  min-width: 240px;
  box-shadow: var(--shadow-md);
  display: flex; flex-direction: column; gap: var(--space-2);
}
.input { width: 100%; }
.suggest { list-style: none; margin: 0; padding: 0; max-height: 140px; overflow: auto; }
.suggest li button {
  width: 100%; text-align: left; padding: 2px 6px;
  background: none; border: none; cursor: pointer; color: var(--fg);
}
.suggest li button:hover { background: var(--bg-2); }
.actions { display: flex; justify-content: flex-end; gap: var(--space-2); }
```

- [ ] **Step 4: Update `SavedScriptsPanel.tsx`**

Key additions:
- `activeFilter: string | null` state. `filtered = scripts.filter(s => s.name.toLowerCase().includes(q) || s.tags.some(t => t.toLowerCase().includes(q)))` AND when `activeFilter` set, `s.tags.some(t => t.toLowerCase() === activeFilter.toLowerCase())`.
- Derive `allTags = useMemo(() => Array.from(new Map(scripts.flatMap(s => s.tags).map(t => [t.toLowerCase(), t])).values()), [scripts])`.
- Per row, render `<TagList tags={script.tags} onClick={(t) => setActiveFilter(t)} selectedTag={activeFilter ?? undefined} />` after the name.
- Active-filter strip when `activeFilter` is set: text "Filter:" + a `TagList` with `[activeFilter]` and `onRemove={() => setActiveFilter(null)}`.
- New action button `📝` (Edit tags) on each row that toggles `editingTagsId === script.id`.
- When popover open for a row, render `<EditTagsPopover initial={script.tags} allTags={allTags} onSave={async (tags) => { await updateScript(script.id, script.name, script.content, tags, script.connectionId); setEditingTagsId(null); reload(); }} onCancel={() => setEditingTagsId(null)} />`.
- Header gets a `Manage tags` button — wires up in Task 8.

- [ ] **Step 5: Update CSS** — replace `.tags { color: var(--fg-dim); }` styling block (was for the inline raw string) with a wrapper `.tagsWrap { margin-left: var(--space-2); }` for the chip strip. Add `.filterStrip { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2); border-bottom: 1px solid var(--border); background: var(--bg-2); }`.

- [ ] **Step 6: Run** `npm test -- --run src/__tests__/saved-scripts.test.tsx` — green.

- [ ] **Step 7: Commit** `git add -A && git commit -m "feat(saved-scripts): chip tags, click-to-filter, inline edit-tags popover"`

---

## Task 8: ManageTagsDialog — global rename/delete

**Files:**
- Create: `src/components/features/saved-scripts/ManageTagsDialog.tsx`
- Create: `src/components/features/saved-scripts/ManageTagsDialog.module.css`
- Modify: `src/components/features/saved-scripts/SavedScriptsPanel.tsx` (wire the header button)
- Test: extend `src/__tests__/saved-scripts.test.tsx`

- [ ] **Step 1: Failing tests** — open dialog → see two tags listed with counts → rename `prod`→`production` → `renameTag` IPC called; delete `auth` (with inline confirm) → `deleteTag` IPC called; reload triggers.

- [ ] **Step 2: Implement `ManageTagsDialog.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { Button, Dialog } from '../../ui';
import { renameTag, deleteTag } from '../../../ipc';
import type { SavedScript } from '../../../types';
import styles from './ManageTagsDialog.module.css';

interface Props {
  scripts: SavedScript[];
  onClose: () => void;
  onMutated: () => void;
}

export function ManageTagsDialog({ scripts, onClose, onMutated }: Props) {
  const tagCounts = useMemo(() => {
    const map = new Map<string, { display: string; count: number }>();
    for (const s of scripts) {
      for (const t of s.tags) {
        const k = t.toLowerCase();
        const prev = map.get(k);
        if (prev) prev.count += 1;
        else map.set(k, { display: t, count: 1 });
      }
    }
    return [...map.values()].sort((a, b) => a.display.localeCompare(b.display));
  }, [scripts]);

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function commitRename(old: string) {
    const next = draft.trim();
    if (!next || next.toLowerCase() === old.toLowerCase()) { setEditing(null); return; }
    try {
      await renameTag(old, next);
      setEditing(null);
      onMutated();
    } catch (e) { setErr((e as Error).message); }
  }

  async function commitDelete(tag: string) {
    try {
      await deleteTag(tag);
      setConfirmingDelete(null);
      onMutated();
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <Dialog open onClose={onClose} ariaLabel="Manage tags" width={420}>
      <Dialog.Header title="Manage tags" onClose={onClose} />
      <Dialog.Body>
        {tagCounts.length === 0 ? (
          <p className={styles.empty}>No tags yet.</p>
        ) : (
          <ul className={styles.list}>
            {tagCounts.map(({ display, count }) => (
              <li key={display.toLowerCase()} className={styles.row}>
                {editing === display ? (
                  <>
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(display);
                        if (e.key === 'Escape') setEditing(null);
                      }}
                    />
                    <Button onClick={() => commitRename(display)}>Save</Button>
                    <Button onClick={() => setEditing(null)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <span className={styles.name}>{display}</span>
                    <span className={styles.count}>{count}</span>
                    <button
                      aria-label={`Rename tag ${display}`}
                      onClick={() => { setEditing(display); setDraft(display); }}
                    >Rename</button>
                    <button
                      aria-label={`Delete tag ${display}`}
                      onClick={() => setConfirmingDelete(display)}
                    >Delete</button>
                  </>
                )}
                {confirmingDelete === display && (
                  <div className={styles.confirm}>
                    Delete "{display}" from {count} script{count === 1 ? '' : 's'}?
                    <Button onClick={() => setConfirmingDelete(null)}>Cancel</Button>
                    <Button variant="primary" onClick={() => commitDelete(display)}>Delete</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {err && <p className={styles.err}>{err}</p>}
      </Dialog.Body>
      <Dialog.Footer>
        <Button onClick={onClose}>Close</Button>
      </Dialog.Footer>
    </Dialog>
  );
}
```

- [ ] **Step 3: Add `ManageTagsDialog.module.css`** — list styling, count badge, inline confirm row.

- [ ] **Step 4: Wire `SavedScriptsPanel`** — header button "Manage tags" opens dialog; `onMutated` calls `reload()`.

- [ ] **Step 5: Run** `npm test -- --run src/__tests__/saved-scripts.test.tsx` — green.

- [ ] **Step 6: Commit** `git add -A && git commit -m "feat(saved-scripts): Manage tags dialog with global rename/delete"`

---

## Task 9: Full sweep + visual verify

- [ ] **Step 1:** `cargo test --manifest-path src-tauri/Cargo.toml` — all green.
- [ ] **Step 2:** `npx tsc --noEmit` — clean.
- [ ] **Step 3:** `npm test -- --run` — all green.
- [ ] **Step 4:** Run the app (`npm run tauri dev` or project's standard launch); manually verify:
  - Existing scripts open and show chips instead of raw text.
  - Adding/removing tags via inline popover persists across reload.
  - Click-to-filter narrows list; clear filter restores it.
  - Manage tags rename shows updated chips on every affected row.
  - Manage tags delete removes the tag from all rows.
  - Search box matches across both name and tag text.
- [ ] **Step 5: Final commit** if any leftover lint fixes; otherwise no-op.

---

## Self-Review (already applied)

- **Coverage:** Chips (T4, T7), inline edit (T7), click-to-filter (T7), Manage tags (T8), storage normalization (T1), IPC surface (T2/T3), editor save path (T5/T6).
- **No placeholders.**
- **Type consistency:** `Vec<String>` (Rust) ↔ `string[]` (TS) at every boundary; helpers named consistently (`parseTags`/`serialize_tags` in Rust, inline `parseTags` in TS dialog).
- **Tag canonicalization rule** stated once up front and re-applied in T1, T5, T7, T8.
