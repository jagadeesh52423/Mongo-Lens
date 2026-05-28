# Final Code Review — feature-saved-script-tags

Branch: `worktree-saved-scripts-tags`
Plan: `docs/superpowers/plans/2026-05-28-saved-script-tags.md`
Commits reviewed: `4057a1e..bae88ba` (8 commits since `main`).

---

## Stage 1 — Spec compliance: **PASS**

Every deliverable in the plan is implemented and matches the spec exactly. No over-build detected.

| Plan requirement | Status | Location |
|---|---|---|
| `SavedScriptRecord.tags: Vec<String>` | ✅ | `src-tauri/src/db/scripts.rs:10` |
| `parse_tags` canonical (trim/drop-empty/CI-dedupe/preserve order) | ✅ | `scripts.rs:18-32` |
| `serialize_tags` runs through `parse_tags` | ✅ | `scripts.rs:34-36` |
| `insert`/`update` serialize on write; `map_row` parses on read | ✅ | `scripts.rs:38-97` |
| `rename_tag_everywhere` (CI match, collapse on dup) | ✅ | `scripts.rs:114-149` |
| `delete_tag_everywhere` (CI match) | ✅ | `scripts.rs:153-180` |
| All 5 plan-specified Rust tests | ✅ all pass | `scripts.rs:217-297` |
| `create_script`/`update_script` take `Vec<String>` | ✅ | `commands/saved_script.rs:29, 60` |
| `rename_tag` / `delete_tag` Tauri commands | ✅ | `commands/saved_script.rs:114-144` |
| Commands registered in `main.rs` | ✅ | `main.rs:116-117` |
| `SavedScript.tags: string[]`, `EditorTab.savedScriptTags: string[]` | ✅ | `types.ts:34, 61` |
| `renameTag` / `deleteTag` IPC wrappers | ✅ | `ipc.ts:93-99` |
| `TagList` with `onClick` / `onRemove` / `selectedTag`; renders nothing when empty | ✅ | `TagList.tsx` |
| `SaveScriptDialog` `string[]` surface + canonical parse | ✅ | `SaveScriptDialog.tsx:15-46` |
| `ContextBar` + `useEditorActions` propagate `string[]` | ✅ | `ContextBar.tsx:18, 162`; `useEditorActions.ts:83-103` |
| Chips per row, click-to-filter, selected highlight | ✅ | `SavedScriptsPanel.tsx:155-163` |
| Filter strip with clear ✕ | ✅ | `SavedScriptsPanel.tsx:112-120` |
| Edit-tags per-row action + popover | ✅ | `SavedScriptsPanel.tsx:128-134, 165-172` |
| Manage tags header button | ✅ | `SavedScriptsPanel.tsx:97-101` |
| `EditTagsPopover` (autocomplete, Enter add, Backspace remove last, Escape cancel) | ✅ | `EditTagsPopover.tsx:17-24, 38-48` |
| `ManageTagsDialog` (alphabetized, counts, inline rename, inline delete confirm) | ✅ | `ManageTagsDialog.tsx:20-31, 71-122` |

**Test results:**
- `cargo test scripts`: 7/7 pass.
- `npm test -- --run`: 114 test files, 714/714 tests pass.
- `npx tsc --noEmit`: 4 errors in `src/hooks/usePluginHostBootstrap.ts` — **pre-existing, not touched by this branch** (`git log main..HEAD -- src/hooks/usePluginHostBootstrap.ts` is empty). Out of scope.

---

## Stage 2 — Code quality

Real findings only. Nothing here blocks merge by itself; flagged for follow-up.

### Findings

**1. `rename_tag_everywhere` / `delete_tag_everywhere` are not transactional**
`src-tauri/src/db/scripts.rs:114-180`

Each function does `SELECT id, tags` then per-row `UPDATE` in a loop. If the process crashes or any single `UPDATE` errors mid-loop, callers see a partial rewrite — some rows have the new tag, others don't. The plan does not explicitly mandate a transaction, but these are global write ops where atomicity is the whole point.

**Fix (small):** wrap both loops in a transaction. The current `conn: &Connection` signature blocks `transaction()` (which needs `&mut`), so use `unchecked_transaction()`:
```rust
let tx = conn.unchecked_transaction()?;
// ... per-row updates using &tx ...
tx.commit()?;
```

**2. `TagList` keyboard activation missing**
`src/components/features/saved-scripts/TagList.tsx:33-34`

Chips in interactive mode set `role="button"` and `tabIndex={0}` but have no `onKeyDown`. Keyboard users can focus a chip but cannot activate it with Enter/Space. This is an a11y regression (a focusable element that announces as a button but ignores keyboard input).

**Fix:**
```tsx
onKeyDown={interactive ? (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick!(tag); }
} : undefined}
```

**3. `EditTagsPopover` silently drops in-progress input text on Save**
`src/components/features/saved-scripts/EditTagsPopover.tsx:50-57`

If a user types "newtag" and clicks **Save** without first pressing Enter, the text in `input` is discarded — the popover saves only `tags`, not `[...tags, input.trim()]`. Easy to hit; surprising.

**Fix:** in `save()`, flush the pending input first:
```tsx
async function save() {
  const pending = input.trim();
  const finalTags = pending && !tags.some(t => t.toLowerCase() === pending.toLowerCase())
    ? [...tags, pending] : tags;
  setBusy(true);
  try { await onSave(finalTags); } finally { setBusy(false); }
}
```

**4. `ManageTagsDialog` does not clear `err` between operations**
`src/components/features/saved-scripts/ManageTagsDialog.tsx:38-61`

Once a rename or delete errors, `err` persists. The user could successfully rename a different tag immediately after and still see the prior error message at the bottom of the dialog. `commitRename`/`commitDelete` should call `setErr(null)` at the top of the try.

### Minor / nits (non-blocking)

- `EditTagsPopover` is positioned `absolute` (CSS) but rendered as a sibling under `<ListRow>`; the parent `<li>` (`.rowWrap`) needs `position: relative` for the popover to anchor correctly. Worth a visual smoke check during Task 9.
- `EditTagsPopover` has no outside-click-to-dismiss; only Cancel button and Escape. Acceptable per spec but typical UX would close on outside click.
- `ManageTagsDialog` confirm row is rendered as a child `<div>` inside the `<li>`; depending on CSS it could shift layout. Visual check in Task 9.
- `SaveScriptDialog` / `useEditorActions.handleSaveAs`: on `onSaveAs` failure, the `saving` flag in `ContextBar` (line 162) stays true because `setSaving(false)` only runs in the success path. **Pre-existing**, not introduced by this branch — but worth noting if a follow-up touches Save flow.

### `/code-standards` cross-check

No rule violations spotted in the diff. Logging uses the established `state.logger.child + logctx!` pattern; error handling uses `.map_err(|e| e.to_string())`; React components follow the existing `*.module.css` co-location convention; types are propagated end-to-end (no `any`); naming matches `featureName/ComponentName.tsx` precedent. The `TagList` "implement this interface to add a new variant" extensibility comment is not required here — `TagList` is a leaf renderer, not a registry/strategy point.

---

## Verdict: **APPROVED with minor follow-ups**

Stage 1 is fully clean. Stage 2 surfaced 4 real-but-small issues (transaction safety, chip keyboard a11y, popover save-drops-input, stale dialog error) — none block merge, all are isolated and easy follow-ups. Recommend filing them as small post-merge tasks (or addressing #1 and #2 inline before merge if there's appetite, since they're 3-line fixes each).
