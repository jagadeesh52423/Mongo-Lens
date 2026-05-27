import { useEffect, useRef, useState } from 'react';
import { loader } from '@monaco-editor/react';
import { useEditorBridgeStore } from '../../../store/editorBridge';
import styles from './CodeBlock.module.css';

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
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.lang}>{lang || 'code'}</span>
        <div className={styles.buttonRow}>
          <button
            type="button"
            onClick={handlePrimary}
            disabled={disabled}
            title={primaryTitle}
            className={styles.button}
          >
            {primaryLabel}
          </button>
          <button
            type="button"
            onClick={handleAppend}
            disabled={disabled}
            title={appendTitle}
            className={styles.button}
          >
            Append
          </button>
        </div>
      </div>
      {html !== null ? (
        <pre className={styles.pre} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className={styles.pre}>{code}</pre>
      )}
    </div>
  );
}
