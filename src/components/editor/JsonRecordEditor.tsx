import Editor, { OnMount } from '@monaco-editor/react';
import { forwardRef, useImperativeHandle, useRef } from 'react';
import { MONACO_THEME_ID } from '../../themes/applyTheme';

export interface JsonRecordEditorHandle {
  format: () => void;
}

interface Props {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  error?: boolean;
}

type EditorInstance = Parameters<OnMount>[0];

export const JsonRecordEditor = forwardRef<JsonRecordEditorHandle, Props>(
  function JsonRecordEditor({ value, onChange, readOnly, error }, ref) {
    const editorRef = useRef<EditorInstance | null>(null);

    useImperativeHandle(ref, () => ({
      format: () => {
        editorRef.current?.getAction('editor.action.formatDocument')?.run();
      },
    }));

    const handleMount: OnMount = (editor) => {
      editorRef.current = editor;
    };

    const borderColor = error
      ? 'var(--accent-red, #fc8181)'
      : readOnly
        ? 'var(--border)'
        : 'var(--accent-blue, #63b3ed)';

    return (
      <div
        style={{
          flex: 1,
          minHeight: 200,
          border: `1px solid ${borderColor}`,
          borderRadius: 4,
          overflow: 'hidden',
        }}
      >
        <Editor
          height="100%"
          language="json"
          theme={MONACO_THEME_ID}
          value={value}
          onChange={(v) => onChange?.(v ?? '')}
          onMount={handleMount}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            tabSize: 2,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            readOnly: !!readOnly,
            formatOnPaste: true,
          }}
        />
      </div>
    );
  },
);
