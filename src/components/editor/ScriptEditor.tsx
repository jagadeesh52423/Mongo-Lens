import Editor, { OnMount } from '@monaco-editor/react';
import { useEffect, useRef } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onRun?: () => void;
  collections?: string[];
}

export function ScriptEditor({ value, onChange, onRun, collections = [] }: Props) {
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const providerRef = useRef<{ dispose: () => void } | null>(null);

  const handleMount: OnMount = (editor, monaco) => {
    monacoRef.current = monaco;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onRun?.();
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

  return (
    <Editor
      height="100%"
      language="javascript"
      theme="vs-dark"
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
