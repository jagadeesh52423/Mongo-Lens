import { useState } from 'react';
import { useEditorBridgeStore } from '../../../store/editorBridge';
import { getActiveTarget } from '../../../services/ai/activeTarget';
import { isExplainable, runExplain, summarizeExplain, formatExplainSummary } from '../../../services/ai/explain';
import styles from './CodeBlock.module.css';

interface Props {
  lang: string;
  code: string;
  /** When provided, an "Explain" plan summary can be sent back to the chat. */
  onSendToAI?: (content: string) => void;
}

type ExplainState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; summary: string }
  | { status: 'error'; message: string };

// ponytail: render code as plain monospace text (explicit --fg color) rather than
// Monaco's colorize(). The class-based colorize output depends on Monaco's global
// .mtkN theme stylesheet being present/correct in this webview, which it isn't
// reliably for transcript code blocks — the text rendered invisible. Plain text
// is always legible; syntax highlighting can return via an inline-color renderer.
export function CodeBlock({ lang, code, onSendToAI }: Props) {
  const controller = useEditorBridgeStore((s) => s.controller);
  const hasSelection = useEditorBridgeStore((s) => s.hasSelection);
  const [explain, setExplain] = useState<ExplainState>({ status: 'idle' });

  const disabled = controller === null;
  const primaryLabel = hasSelection ? 'Update' : 'Insert at';
  const primaryTitle = disabled
    ? 'Open a script to apply'
    : hasSelection
      ? 'Replace the selected text in the active script'
      : 'Insert at the cursor in the active script';
  const appendTitle = disabled ? 'Open a script to apply' : 'Append to the end of the active script';

  const canExplain = isExplainable(code);
  const target = getActiveTarget();
  const explainDisabled = !target.connectionId || !target.database;

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

  const handleExplain = async () => {
    const t = getActiveTarget();
    if (!t.connectionId || !t.database) return;
    setExplain({ status: 'running' });
    try {
      const plan = await runExplain(t.connectionId, t.database, code);
      setExplain({ status: 'done', summary: formatExplainSummary(summarizeExplain(plan)) });
    } catch (err) {
      setExplain({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleSendExplain = () => {
    if (explain.status !== 'done' || !onSendToAI) return;
    onSendToAI(`Optimize this query. Explain summary:\n${explain.summary}\n\nQuery:\n\`\`\`js\n${code}\n\`\`\``);
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.lang}>{lang || 'code'}</span>
        <div className={styles.buttonRow}>
          <button type="button" onClick={handlePrimary} disabled={disabled} title={primaryTitle} className={styles.button}>
            {primaryLabel}
          </button>
          <button type="button" onClick={handleAppend} disabled={disabled} title={appendTitle} className={styles.button}>
            Append
          </button>
          {canExplain && (
            <button
              type="button"
              onClick={handleExplain}
              disabled={explainDisabled || explain.status === 'running'}
              title={explainDisabled ? 'Connect to a database to explain' : 'Run explain() and summarize the plan'}
              className={styles.button}
            >
              {explain.status === 'running' ? 'Explaining…' : 'Explain'}
            </button>
          )}
        </div>
      </div>
      {explain.status === 'done' && (
        <div className={styles.explainSummary}>
          <span>{explain.summary}</span>
          {onSendToAI && (
            <button type="button" onClick={handleSendExplain} className={styles.explainSend}>
              Send to AI
            </button>
          )}
        </div>
      )}
      {explain.status === 'error' && (
        <div className={styles.explainError}>Explain failed: {explain.message}</div>
      )}
      <pre className={styles.pre}>{code}</pre>
    </div>
  );
}
