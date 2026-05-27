import Editor, { OnMount } from '@monaco-editor/react';
import { useEffect, useRef } from 'react';
import type { ExecutionMode } from '../../../execution-modes';
import type { EditorSelection } from '../../../types';
import { MONACO_THEME_ID } from '../../../themes/applyTheme';
import { useEditorBridgeStore, type EditorController } from '../../../store/editorBridge';
// Side-effect import: registers the :global() rule for the current-statement
// highlight class name that Monaco's decoration API references by string.
import './ScriptEditor.module.css';

interface HighlightRange {
  startLine: number;
  endLine: number;
}

interface Props {
  tabId: string;
  value: string;
  onChange: (value: string) => void;
  modes: readonly ExecutionMode[];
  onExecute?: (modeId: string) => void;
  onCursorChange?: (line: number) => void;
  onSelectionChange?: (selection: EditorSelection | null) => void;
  highlightRange?: HighlightRange | null;
  collections?: string[];
}

const HIGHLIGHT_CLASS = 'current-statement-highlight';

export function modelPathForTab(tabId: string): string {
  return `inmemory://tab/${encodeURIComponent(tabId)}.js`;
}

type EditorInstance = Parameters<OnMount>[0];
type MonacoInstance = Parameters<OnMount>[1];

export function ScriptEditor({
  tabId,
  value,
  onChange,
  modes,
  onExecute,
  onCursorChange,
  onSelectionChange,
  highlightRange,
  collections = [],
}: Props) {
  const monacoRef = useRef<MonacoInstance | null>(null);
  const editorRef = useRef<EditorInstance | null>(null);
  const providerRef = useRef<{ dispose: () => void } | null>(null);
  const decorationIdsRef = useRef<string[]>([]);

  const callbacksRef = useRef({ onExecute, onCursorChange, onSelectionChange });
  callbacksRef.current = { onExecute, onCursorChange, onSelectionChange };

  const handleMount: OnMount = (editor, monaco) => {
    monacoRef.current = monaco;
    editorRef.current = editor;

    modes.forEach((mode) => {
      if (mode.keybind) {
        editor.addCommand(mode.keybind(monaco), () => {
          callbacksRef.current.onExecute?.(mode.id);
        });
      }
    });

    editor.onDidChangeCursorPosition((e) => {
      callbacksRef.current.onCursorChange?.(e.position.lineNumber);
    });
    editor.onDidChangeCursorSelection((e) => {
      const model = editor.getModel();
      const text = model?.getValueInRange(e.selection) ?? '';
      if (text.length > 0) {
        // Monaco selections can run "backwards" (endLineNumber < startLineNumber)
        // when the user drags upward; normalize so consumers always see ascending lines.
        const a = e.selection.startLineNumber;
        const b = e.selection.endLineNumber;
        const startLine = Math.min(a, b);
        const endLine = Math.max(a, b);
        callbacksRef.current.onSelectionChange?.({ text, startLine, endLine });
      } else {
        callbacksRef.current.onSelectionChange?.(null);
      }
      callbacksRef.current.onCursorChange?.(e.selection.getStartPosition().lineNumber);
    });

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
  };

  useEffect(() => {
    if (!monacoRef.current) return;
    const monaco = monacoRef.current;
    providerRef.current?.dispose();
    const disposable = monaco.languages.registerCompletionItemProvider('javascript', {
      triggerCharacters: ['.'],
      provideCompletionItems: (model, position) => {
        const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
        if (!/\bdb\.$/.test(line)) return { suggestions: [] };
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        return {
          suggestions: collections.map((c) => ({
            label: c,
            kind: monaco.languages.CompletionItemKind.Property,
            insertText: c,
            range,
          })),
        };
      },
    });
    providerRef.current = disposable;
    return () => disposable.dispose();
  }, [collections]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const newDecorations = highlightRange
      ? [
          {
            range: new monaco.Range(highlightRange.startLine, 1, highlightRange.endLine, 1),
            options: { isWholeLine: true, className: HIGHLIGHT_CLASS },
          },
        ]
      : [];
    decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, newDecorations);
  }, [highlightRange]);

  return (
    <Editor
      height="100%"
      language="javascript"
      theme={MONACO_THEME_ID}
      path={modelPathForTab(tabId)}
      keepCurrentModel
      value={value}
      onChange={(v) => onChange(v ?? '')}
      onMount={handleMount}
      options={{
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        minimap: { enabled: false },
        tabSize: 2,
        scrollBeyondLastLine: false,
      }}
    />
  );
}
