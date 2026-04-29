# Monaco editor for F3 (view) and F4 (edit) record modals

## Problem

F3 (View Full Record) currently renders the document as a `<pre>` block, and F4 (Edit Full Record) uses a plain `<textarea>`. Neither supports find, JSON folding, syntax highlighting, or other editor affordances. Users want a real editor experience in both modes — read-only for F3, editable for F4 — with full editor commands (find, select-all, copy, etc.).

## Solution

Replace the `<pre>` and `<textarea>` with a shared Monaco-based component. Monaco gives find, select-all, copy, folding, and syntax highlighting for free. `readOnly: true` disables typing/paste but keeps all read-side commands working.

The project already uses `@monaco-editor/react` in `src/components/editor/ScriptEditor.tsx` with a registered theme (`MONACO_THEME_ID`).

## New component: `src/components/editor/JsonRecordEditor.tsx`

Thin wrapper around `@monaco-editor/react` configured for JSON record display/editing.

### Props

```ts
interface Props {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  error?: boolean;        // when true, border turns red
  onFormat?: () => void;  // optional callback exposed for parents that want to trigger formatting
}
```

### Configuration

- `language="json"`
- `theme={MONACO_THEME_ID}`
- Options:
  - `minimap: { enabled: false }`
  - `fontSize: 12`
  - `fontFamily: 'var(--font-mono)'`
  - `tabSize: 2`
  - `scrollBeyondLastLine: false`
  - `automaticLayout: true`
  - `readOnly` from prop
  - `formatOnPaste: true` (edit mode only — auto-formats pasted JSON)

### JSON validation markers (Monaco built-in)

Monaco's JSON language service emits diagnostic markers (squiggles) for invalid JSON automatically when `language="json"`. No extra config needed.

### Format action

Expose a `format()` method via a ref handle, so callers (edit mode) can wire a "Format JSON" button. Implementation: call `editor.getAction('editor.action.formatDocument')?.run()`.

### Wrapper styling

- Outer `<div>` has `flex: 1`, `minHeight: 200`, `border: 1px solid` (red if `error`, else `var(--accent-blue)` for edit, `var(--border)` for view), `borderRadius: 4`, `overflow: hidden`.
- The Monaco `<Editor>` fills the wrapper (`height="100%"`).

## F3: `viewRecordAction.ts`

Replace the `<pre>` with `<JsonRecordEditor value={json} readOnly />`. Keep the existing footer (id chip, Close, Edit (F4)).

## F4: `editRecordAction.ts`

Replace the `<textarea>` with `<JsonRecordEditor value={editedJson} onChange={setEditedJson} error={!!error} />` and use a ref to call `format()` from a new "Format JSON" button placed next to Cancel/Submit in the footer.

The existing `editedJsonRef` and `handleSubmit` logic is unchanged — `onChange` still updates state, and `JSON.parse` validation on submit remains the source of truth.

Footer layout (left → right): hint text, **Format JSON**, Cancel, Submit.

## Out of scope

- No schema-aware completion (we don't have a document schema available).
- No diff view between original and edited JSON.
- No keyboard shortcut for Format (users can rely on Monaco's built-in `Shift+Alt+F`).

## Files changed

1. **New** `src/components/editor/JsonRecordEditor.tsx`
2. **Edit** `src/services/records/actions/viewRecordAction.ts`
3. **Edit** `src/services/records/actions/editRecordAction.ts`

## Verification

- F3 on any document → Monaco read-only editor with JSON highlighting; Cmd+F opens find; Cmd+A/Cmd+C work; typing does nothing.
- F4 on an editable result → Monaco editable editor; type invalid JSON → squiggle appears; click Format JSON → content is reflowed; Submit on invalid JSON shows the existing error banner.
