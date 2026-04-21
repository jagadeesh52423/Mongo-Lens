import Editor, { OnMount } from '@monaco-editor/react';
import { useEffect, useRef } from 'react';
import type { ExecutionMode } from '../../execution-modes';

interface HighlightRange {
  startLine: number;
  endLine: number;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  modes: readonly ExecutionMode[];
  onExecute?: (modeId: string) => void;
  onCursorChange?: (line: number) => void;
  onSelectionChange?: (text: string | null) => void;
  highlightRange?: HighlightRange | null;
  collections?: string[];
}

const HIGHLIGHT_CLASS = 'current-statement-highlight';
const HIGHLIGHT_STYLE_ID = 'current-statement-highlight-style';

function ensureHighlightStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `.${HIGHLIGHT_CLASS} { background: #0d3a4f; }`;
  document.head.appendChild(style);
}

type EditorInstance = Parameters<OnMount>[0];
type MonacoInstance = Parameters<OnMount>[1];

export function ScriptEditor({
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
    ensureHighlightStyle();

    monaco.editor.defineTheme('mongodb-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#001e2b',
        'editor.lineHighlightBackground': '#0d2d3c',
        'editorGutter.background': '#001e2b',
        'minimap.background': '#001e2b',
      },
    });
    monaco.editor.setTheme('mongodb-dark');

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
      const sel = model?.getValueInRange(e.selection) ?? '';
      callbacksRef.current.onSelectionChange?.(sel.length > 0 ? sel : null);
      callbacksRef.current.onCursorChange?.(e.selection.getStartPosition().lineNumber);
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
      theme="mongodb-dark"
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
