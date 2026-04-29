# AI Code Block Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render fenced code blocks in AI chat responses as syntax-highlighted blocks with toolbar actions (Append always; Update or Insert at depending on editor selection) that mutate the active script editor without modifying the stored chat content.

**Architecture:** A pure parser splits assistant message text into `text` and `code` segments at render time. A Zustand "editor bridge" store holds an imperative controller registered by the active `ScriptEditor` plus a reactive `hasSelection` flag. A new `CodeBlock` component reads the store, renders Monaco-colorized code with toolbar buttons, and invokes controller methods on click. `AIMessageBubble` runs the parser per render — `ChatMessage.content` in the `ai` store is never mutated, so the original markdown is sent verbatim on subsequent turns.

**Tech Stack:** React + TypeScript, Zustand, `@monaco-editor/react` (Monaco 0.47), Vitest.

**Spec:** `docs/superpowers/specs/2026-04-30-ai-code-block-actions-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/utils/aiContent.ts` | new | Pure parser: text → segment array |
| `src/utils/aiContent.test.ts` | new | Parser unit tests |
| `src/store/editorBridge.ts` | new | Zustand bridge: controller + hasSelection |
| `src/store/editorBridge.test.ts` | new | Store unit tests |
| `src/components/editor/ScriptEditor.tsx` | modify | Register controller on mount, push selection state, deregister on unmount |
| `src/components/ai/CodeBlock.tsx` | new | Colorized code block with action toolbar |
| `src/components/ai/AIMessageBubble.tsx` | modify | Render assistant content as text + CodeBlock segments |

---

## Task 1: Content Parser

**Files:**
- Create: `src/utils/aiContent.ts`
- Test: `src/utils/aiContent.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/utils/aiContent.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseAIContent } from './aiContent';

describe('parseAIContent', () => {
  it('returns single text segment for plain text', () => {
    expect(parseAIContent('hello world')).toEqual([
      { kind: 'text', text: 'hello world' },
    ]);
  });

  it('parses a single fenced block with language', () => {
    const input = 'pre\n```javascript\ndb.foo.find()\n```\npost';
    expect(parseAIContent(input)).toEqual([
      { kind: 'text', text: 'pre\n' },
      { kind: 'code', lang: 'javascript', code: 'db.foo.find()' },
      { kind: 'text', text: '\npost' },
    ]);
  });

  it('parses a fenced block without language', () => {
    const input = '```\nraw\n```';
    expect(parseAIContent(input)).toEqual([
      { kind: 'code', lang: '', code: 'raw' },
    ]);
  });

  it('parses multiple interleaved blocks in order', () => {
    const input = 'a\n```js\nx\n```\nb\n```py\ny\n```\nc';
    expect(parseAIContent(input)).toEqual([
      { kind: 'text', text: 'a\n' },
      { kind: 'code', lang: 'js', code: 'x' },
      { kind: 'text', text: '\nb\n' },
      { kind: 'code', lang: 'py', code: 'y' },
      { kind: 'text', text: '\nc' },
    ]);
  });

  it('emits trailing unclosed fence as text (streaming)', () => {
    const input = 'before\n```javascript\ndb.foo';
    expect(parseAIContent(input)).toEqual([
      { kind: 'text', text: 'before\n```javascript\ndb.foo' },
    ]);
  });

  it('emits empty code body as literal text', () => {
    const input = '```\n```';
    expect(parseAIContent(input)).toEqual([
      { kind: 'text', text: '```\n```' },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(parseAIContent('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/aiContent.test.ts`
Expected: FAIL — `Cannot find module './aiContent'`

- [ ] **Step 3: Implement the parser**

Create `src/utils/aiContent.ts`:

```ts
export type AISegment =
  | { kind: 'text'; text: string }
  | { kind: 'code'; lang: string; code: string };

const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)\n```/g;

export function parseAIContent(input: string): AISegment[] {
  if (input.length === 0) return [];
  const segments: AISegment[] = [];
  let lastIndex = 0;
  FENCE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCE_RE.exec(input)) !== null) {
    const code = m[2];
    if (code.length === 0) {
      // Empty body — fall through, will be captured as trailing text below.
      continue;
    }
    if (m.index > lastIndex) {
      segments.push({ kind: 'text', text: input.slice(lastIndex, m.index) });
    }
    segments.push({ kind: 'code', lang: m[1].trim(), code });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < input.length) {
    segments.push({ kind: 'text', text: input.slice(lastIndex) });
  }
  return segments;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/aiContent.test.ts`
Expected: PASS — 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/utils/aiContent.ts src/utils/aiContent.test.ts
git commit -m "feat(ai): add fenced code block parser for chat segments"
```

---

## Task 2: Editor Bridge Store

**Files:**
- Create: `src/store/editorBridge.ts`
- Test: `src/store/editorBridge.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/store/editorBridge.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEditorBridgeStore } from './editorBridge';

beforeEach(() => {
  useEditorBridgeStore.setState({ controller: null, hasSelection: false });
});

describe('editorBridge store', () => {
  it('starts with null controller and no selection', () => {
    const s = useEditorBridgeStore.getState();
    expect(s.controller).toBeNull();
    expect(s.hasSelection).toBe(false);
  });

  it('registers and clears the controller', () => {
    const ctrl = {
      replaceSelection: vi.fn(),
      insertAtCursor: vi.fn(),
      appendToEnd: vi.fn(),
      focus: vi.fn(),
    };
    useEditorBridgeStore.getState().setController(ctrl);
    expect(useEditorBridgeStore.getState().controller).toBe(ctrl);
    useEditorBridgeStore.getState().setController(null);
    expect(useEditorBridgeStore.getState().controller).toBeNull();
  });

  it('updates hasSelection', () => {
    useEditorBridgeStore.getState().setHasSelection(true);
    expect(useEditorBridgeStore.getState().hasSelection).toBe(true);
    useEditorBridgeStore.getState().setHasSelection(false);
    expect(useEditorBridgeStore.getState().hasSelection).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/store/editorBridge.test.ts`
Expected: FAIL — `Cannot find module './editorBridge'`

- [ ] **Step 3: Implement the store**

Create `src/store/editorBridge.ts`:

```ts
import { create } from 'zustand';

export interface EditorController {
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

export const useEditorBridgeStore = create<EditorBridgeState>((set) => ({
  controller: null,
  hasSelection: false,
  setController: (controller) => set({ controller }),
  setHasSelection: (hasSelection) => set({ hasSelection }),
}));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/store/editorBridge.test.ts`
Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/store/editorBridge.ts src/store/editorBridge.test.ts
git commit -m "feat(store): add editorBridge for AI-driven editor mutations"
```

---

## Task 3: ScriptEditor Hookup

**Files:**
- Modify: `src/components/editor/ScriptEditor.tsx`

This task wires Monaco events into the bridge store. There's no clean unit test for this without mocking Monaco, so we verify via the existing app tests passing plus a manual check after Task 5.

- [ ] **Step 1: Add the import**

In `src/components/editor/ScriptEditor.tsx`, add to the imports at the top of the file (after the existing imports):

```ts
import { useEditorBridgeStore, type EditorController } from '../../store/editorBridge';
```

- [ ] **Step 2: Register the controller and selection wiring inside `handleMount`**

In `src/components/editor/ScriptEditor.tsx`, locate `handleMount` (currently around line 55). At the **end** of the function body, after the existing `editor.onDidChangeCursorSelection(...)` block, add:

```ts
    const controller: EditorController = {
      replaceSelection: (text) => {
        const sel = editor.getSelection();
        if (!sel) return;
        editor.executeEdits('ai', [{ range: sel, text, forceMoveMarkers: true }]);
      },
      insertAtCursor: (text) => {
        const pos = editor.getPosition();
        if (!pos) return;
        const range = new monaco.Range(
          pos.lineNumber,
          pos.column,
          pos.lineNumber,
          pos.column,
        );
        editor.executeEdits('ai', [{ range, text, forceMoveMarkers: true }]);
      },
      appendToEnd: (text) => {
        const model = editor.getModel();
        if (!model) return;
        const lastLine = model.getLineCount();
        const lastCol = model.getLineMaxColumn(lastLine);
        const value = model.getValue();
        const needsNewline = value.length > 0 && !value.endsWith('\n');
        const insert = needsNewline ? `\n${text}` : text;
        const range = new monaco.Range(lastLine, lastCol, lastLine, lastCol);
        editor.executeEdits('ai', [{ range, text: insert, forceMoveMarkers: true }]);
      },
      focus: () => editor.focus(),
    };

    const bridge = useEditorBridgeStore.getState();
    bridge.setController(controller);
    const initialSel = editor.getSelection();
    bridge.setHasSelection(!!initialSel && !initialSel.isEmpty());

    editor.onDidChangeCursorSelection((e) => {
      useEditorBridgeStore.getState().setHasSelection(!e.selection.isEmpty());
    });

    editor.onDidDispose(() => {
      const s = useEditorBridgeStore.getState();
      if (s.controller === controller) {
        s.setController(null);
        s.setHasSelection(false);
      }
    });
```

Note: a second `onDidChangeCursorSelection` listener is fine — Monaco supports multiple listeners. The existing one fires the `onSelectionChange` callback prop; this new one only writes to the bridge store.

- [ ] **Step 3: Build the project to verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the existing test suite to verify no regressions**

Run: `npx vitest run`
Expected: all tests pass (including the new `aiContent` and `editorBridge` tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/ScriptEditor.tsx
git commit -m "feat(editor): register editor controller with AI bridge store"
```

---

## Task 4: CodeBlock Component

**Files:**
- Create: `src/components/ai/CodeBlock.tsx`

This component is visual + glue. We rely on Monaco's `colorize` for highlighting and the bridge store for actions. Manual smoke after Task 5.

- [ ] **Step 1: Create the component**

Create `src/components/ai/CodeBlock.tsx`:

```tsx
import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import { useEditorBridgeStore } from '../../store/editorBridge';

interface Props {
  lang: string;
  code: string;
}

export function CodeBlock({ lang, code }: Props) {
  const controller = useEditorBridgeStore((s) => s.controller);
  const hasSelection = useEditorBridgeStore((s) => s.hasSelection);
  const [html, setHtml] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const language = lang || 'plaintext';
    monaco.editor
      .colorize(code, language, { tabSize: 2 })
      .then((result) => {
        if (!cancelledRef.current) setHtml(result);
      })
      .catch(() => {
        if (!cancelledRef.current) setHtml(null);
      });
    return () => {
      cancelledRef.current = true;
    };
  }, [lang, code]);

  const disabled = controller === null;
  const primaryLabel = hasSelection ? 'Update' : 'Insert at';
  const primaryTitle = disabled
    ? 'Open a script to apply'
    : hasSelection
      ? 'Replace the selected text in the active script'
      : 'Insert at the cursor in the active script';
  const appendTitle = disabled
    ? 'Open a script to apply'
    : 'Append to the end of the active script';

  const handlePrimary = () => {
    if (!controller) return;
    if (hasSelection) controller.replaceSelection(code);
    else controller.insertAtCursor(code);
    controller.focus();
  };

  const handleAppend = () => {
    if (!controller) return;
    controller.appendToEnd(code);
    controller.focus();
  };

  return (
    <div style={wrapperStyle}>
      <div style={headerStyle}>
        <span style={langStyle}>{lang || 'code'}</span>
        <div style={buttonRowStyle}>
          <button
            type="button"
            onClick={handlePrimary}
            disabled={disabled}
            title={primaryTitle}
            style={buttonStyle(disabled)}
          >
            {primaryLabel}
          </button>
          <button
            type="button"
            onClick={handleAppend}
            disabled={disabled}
            title={appendTitle}
            style={buttonStyle(disabled)}
          >
            Append
          </button>
        </div>
      </div>
      {html !== null ? (
        <pre style={preStyle} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre style={preStyle}>{code}</pre>
      )}
    </div>
  );
}

const wrapperStyle: CSSProperties = {
  margin: '6px 0',
  border: '1px solid var(--border, #2a2a2a)',
  borderRadius: 6,
  overflow: 'hidden',
  background: 'var(--bg-code, #1e1e1e)',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '4px 8px',
  background: 'var(--bg-elevated, #252526)',
  borderBottom: '1px solid var(--border, #2a2a2a)',
  fontSize: 11,
};

const langStyle: CSSProperties = {
  color: 'var(--fg-dim, #888)',
  textTransform: 'lowercase',
};

const buttonRowStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
};

function buttonStyle(disabled: boolean): CSSProperties {
  return {
    padding: '2px 8px',
    borderRadius: 4,
    border: '1px solid var(--border, #444)',
    background: 'transparent',
    color: disabled ? 'var(--fg-dim, #666)' : 'var(--fg, #ddd)',
    fontSize: 11,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };
}

const preStyle: CSSProperties = {
  margin: 0,
  padding: '8px 10px',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  lineHeight: 1.45,
  whiteSpace: 'pre',
  overflowX: 'auto',
  color: 'var(--fg, #ddd)',
};
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ai/CodeBlock.tsx
git commit -m "feat(ai): add CodeBlock with Append/Update/Insert-at toolbar"
```

---

## Task 5: AIMessageBubble Integration

**Files:**
- Modify: `src/components/ai/AIMessageBubble.tsx`

- [ ] **Step 1: Update the imports**

In `src/components/ai/AIMessageBubble.tsx`, replace the existing import block (lines 1-2) with:

```tsx
import type { CSSProperties } from 'react';
import type { ChatMessage } from '../../store/ai';
import { parseAIContent, type AISegment } from '../../utils/aiContent';
import { CodeBlock } from './CodeBlock';
```

- [ ] **Step 2: Replace the content render**

In `src/components/ai/AIMessageBubble.tsx`, replace the line:

```tsx
        <div style={contentStyle}>{message.content}</div>
```

with:

```tsx
        {isUser ? (
          <div style={contentStyle}>{message.content}</div>
        ) : (
          <AssistantContent content={message.content} />
        )}
```

- [ ] **Step 3: Add the AssistantContent helper**

In `src/components/ai/AIMessageBubble.tsx`, add this function definition just below the `AIMessageBubble` function (before `function rowStyle(...)`):

```tsx
function AssistantContent({ content }: { content: string }) {
  const segments = parseAIContent(content);
  if (segments.length === 0) return null;
  return (
    <>
      {segments.map((seg, i) => renderSegment(seg, i))}
    </>
  );
}

function renderSegment(seg: AISegment, key: number) {
  if (seg.kind === 'text') {
    return (
      <div key={key} style={contentStyle}>
        {seg.text}
      </div>
    );
  }
  return <CodeBlock key={key} lang={seg.lang} code={seg.code} />;
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 6: Manual smoke test**

Start the app: `npm run tauri dev` (or whatever the project's dev command is — check `package.json` if unsure).

Verify:
1. Open a script tab.
2. Open the AI chat panel and send a question whose response will contain a fenced code block (e.g. "Write a query to find users with role admin").
3. The response renders with a styled code block and two buttons in its header: **Insert at** and **Append**.
4. With no selection in the editor, click **Insert at** → code is inserted at the current cursor position; editor receives focus.
5. Click **Append** → code is added at the end of the script (with a leading newline if needed); editor receives focus.
6. Select some text in the editor. The button label flips to **Update**. Click → selected text is replaced.
7. Close all script tabs. The buttons in any visible code blocks become disabled with the tooltip "Open a script to apply".
8. Send another AI question. The user message in chat sends the previous assistant turn's raw content (verify by inspecting the network/log — the model receives the original ` ``` ` markdown, not stripped). If a logger isn't easily accessible, ask the AI to repeat back the previous message verbatim and confirm it reproduces the fences.

If any step fails, do NOT proceed — fix and re-run.

- [ ] **Step 7: Commit**

```bash
git add src/components/ai/AIMessageBubble.tsx
git commit -m "feat(ai): render assistant code blocks with action toolbar"
```

---

## Self-Review Notes

- **Spec coverage**: parser (Task 1) ✓, bridge store (Task 2) ✓, ScriptEditor wiring incl. selection-state, append/insert/replace, controller cleanup (Task 3) ✓, CodeBlock with colorize, disabled state, label flip (Task 4) ✓, AIMessageBubble segment rendering with raw content preserved (Task 5) ✓. Edge cases from the spec are exercised by parser tests (empty body, unclosed fence, no-language) and Step 6 manual test (no active editor, multiple blocks, selection toggle).
- **Type consistency**: `EditorController` interface defined in Task 2, used by name in Tasks 3 and 4. `AISegment` defined in Task 1, used by name in Task 5. Method names (`replaceSelection`, `insertAtCursor`, `appendToEnd`, `focus`) match across all tasks.
- **No placeholders**: every code-modifying step has full code.
