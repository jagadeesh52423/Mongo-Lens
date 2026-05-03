import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import { loader } from '@monaco-editor/react';
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
    loader
      .init()
      .then((monaco) => monaco.editor.colorize(code, language, { tabSize: 2 }))
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
  border: '1px solid var(--border)',
  borderRadius: 6,
  overflow: 'hidden',
  background: 'var(--bg)',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '4px 8px',
  background: 'var(--bg-hover)',
  borderBottom: '1px solid var(--border)',
  fontSize: 11,
};

const langStyle: CSSProperties = {
  color: 'var(--fg-dim)',
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
    border: '1px solid var(--border)',
    background: 'transparent',
    color: disabled ? 'var(--fg-dim)' : 'var(--fg)',
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
  color: 'var(--fg)',
};
