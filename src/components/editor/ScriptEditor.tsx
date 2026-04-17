import Editor, { OnMount } from '@monaco-editor/react';
import { useRef } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onRun?: () => void;
}

export function ScriptEditor({ value, onChange, onRun }: Props) {
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);

  const handleMount: OnMount = (editor, monaco) => {
    monacoRef.current = monaco;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onRun?.();
    });
  };

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
