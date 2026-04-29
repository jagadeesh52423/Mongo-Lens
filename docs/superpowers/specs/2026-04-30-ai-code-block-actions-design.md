# AI Code Block Actions — Design

## Summary

Render fenced code blocks in AI chat responses as syntax-highlighted blocks with a toolbar of actions that mutate the active script editor: **Append** always, plus **Update** (when there's a text selection) or **Insert at** (when there's no selection). Parsing and rendering are presentation-only — the underlying chat message content is never modified, so subsequent turns send the original markdown back to the model.

## Non-goals

- No markdown rendering beyond fenced code blocks (no headings, lists, bold, links, inline code).
- No copy-to-clipboard button (can be added later if asked).
- No language detection beyond what the fence specifies.
- No diff preview before applying.

## Components

### 1. Content parser — `src/utils/aiContent.ts` (new)

Pure function:

```ts
type AISegment =
  | { kind: 'text'; text: string }
  | { kind: 'code'; lang: string; code: string };

export function parseAIContent(input: string): AISegment[];
```

- Recognises ` ```<lang>\n...\n``` ` fences. `<lang>` is optional; if missing, `lang = ''`.
- Preserves order of segments. Text segments retain original whitespace.
- A trailing unclosed fence (streaming case) is emitted as a `text` segment so partial responses degrade gracefully.
- Empty code segments (zero-length body) are emitted as `text` (the literal backticks) so the user still sees what the model produced.

### 2. Editor bridge store — `src/store/editorBridge.ts` (new)

Zustand store that decouples the AI panel from the Monaco instance.

```ts
interface EditorController {
  replaceSelection(text: string): void;
  insertAtCursor(text: string): void;
  appendToEnd(text: string): void;
  focus(): void;
}

interface EditorBridgeState {
  controller: EditorController | null;
  hasSelection: boolean;
  setController: (c: EditorController | null) => void;
  setHasSelection: (v: boolean) => void;
}
```

- `controller` is `null` when no `ScriptEditor` is mounted/active. Consumers treat that as the disabled state.
- `hasSelection` is the only reactive flag the UI subscribes to for the button label.

**Extension contract**: future panels (e.g. record editor) implementing the same `EditorController` interface and registering on focus would automatically receive AI-driven mutations. No call-site changes needed.

### 3. `ScriptEditor` hookup — modify `src/components/editor/ScriptEditor.tsx`

In `onMount`:

- Build a controller object that closes over `editor` and `monaco`:
  - `replaceSelection(text)`: `editor.executeEdits('ai', [{ range: editor.getSelection(), text, forceMoveMarkers: true }])`; new selection is the inserted range.
  - `insertAtCursor(text)`: same, but `range` is a zero-width range at `editor.getPosition()`. Cursor placed at end of inserted text.
  - `appendToEnd(text)`: compute end position from model; prepend `\n` to `text` if the last character isn't already a newline; insert via `executeEdits`. Cursor preserved.
  - `focus()`: `editor.focus()`.
- Register via `useEditorBridgeStore.getState().setController(controller)`.
- Subscribe `editor.onDidChangeCursorSelection` to push `setHasSelection(!selection.isEmpty())`. Initial call after mount to seed the value.
- Cleanup on unmount: `setController(null)`, `setHasSelection(false)`.

The existing `onChange` flow already marks the tab dirty when the model value changes, so all three actions inherit dirty-tracking for free.

### 4. `CodeBlock` component — `src/components/ai/CodeBlock.tsx` (new)

Props: `{ lang: string; code: string }`.

Layout:

```
┌─────────────────────────────────────────────┐
│ javascript            [Append] [Update]     │  ← header bar
├─────────────────────────────────────────────┤
│  db.getCollection("foo").find({...})        │  ← <pre> with colorized HTML
│  ...                                         │
└─────────────────────────────────────────────┘
```

- Header: language label (left), action buttons (right). When `lang === ''`, label shows `code`.
- Body: `monaco.editor.colorize(code, lang || 'plaintext', { tabSize: 2 })` — async, returns HTML. Set via `dangerouslySetInnerHTML` on a `<pre>`. On rejection, render plain text.
- Subscribes to `useEditorBridgeStore` for `controller` and `hasSelection`.
- Buttons:
  - **Append** (always present): calls `controller.appendToEnd(code)` → `controller.focus()`.
  - **Update** (when `hasSelection`): calls `controller.replaceSelection(code)` → `focus()`.
  - **Insert at** (when not `hasSelection`): calls `controller.insertAtCursor(code)` → `focus()`.
- When `controller === null`, both buttons are disabled with a tooltip: `"Open a script to apply"`.

### 5. `AIMessageBubble` — modify `src/components/ai/AIMessageBubble.tsx`

For `message.role === 'assistant'`:

- Run `parseAIContent(message.content)`.
- Render segments in order:
  - `text` → existing pre-wrap div (one per text segment).
  - `code` → `<CodeBlock lang={lang} code={code} />`.

For `message.role === 'user'`: unchanged (current pre-wrap rendering).

The `ai` store's `ChatMessage.content` is **never mutated**. The parser runs each render. On the next turn, `AIChatPanel` continues sending the original `content` to the model.

## Data flow

```
ScriptEditor (mount)
  └─> editorBridge.setController(controller)
  └─> on selection change: editorBridge.setHasSelection(...)

AIMessageBubble (assistant)
  └─> parseAIContent(content) → segments
       └─> CodeBlock (per code segment)
            └─> reads editorBridge.controller, hasSelection
            └─> click → controller.{append|insert|replace}(code) + focus()
```

## Edge cases

| Case | Behaviour |
|---|---|
| No active script tab | Buttons disabled, tooltip explains. |
| Multiple code blocks in one response | Each renders independently with its own toolbar. |
| Streaming response, unclosed fence | Tail rendered as text until closing fence streams in; then re-parsed on next render and the block appears. |
| Empty code block (` ``` ``` `) | Rendered as literal text — no toolbar. |
| Code block with no language tag | Label shows `code`; colorize uses `plaintext`. |
| User selects text in editor while reading chat | `hasSelection` flips reactively; all visible code blocks update their button label from "Insert at" to "Update". |
| Tab switched | New `ScriptEditor` registers its controller; old one's unmount clears it first. There's a brief moment where `controller` may be null — buttons disable then re-enable. |

## Testing

- Unit tests for `parseAIContent`:
  - plain text only
  - single block with lang
  - single block without lang
  - multiple blocks interleaved with text
  - unclosed trailing fence
  - empty block body
- Component test for `CodeBlock`: button label flips on `hasSelection`; click invokes correct controller method; disabled when controller is null.
- Manual smoke: open a script, ask AI a question, click Append → script grows; select text, click Update → selection replaced; clear selection, button flips to Insert at, click → inserted at cursor.

## Files touched

- New: `src/utils/aiContent.ts`
- New: `src/store/editorBridge.ts`
- New: `src/components/ai/CodeBlock.tsx`
- Modified: `src/components/editor/ScriptEditor.tsx` (register controller + selection wiring)
- Modified: `src/components/ai/AIMessageBubble.tsx` (segment rendering for assistant messages)
- Tests: `src/utils/aiContent.test.ts`, `src/components/ai/CodeBlock.test.tsx`
