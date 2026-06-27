import type { ChatMessage } from '../../../store/ai';
import { parseAIContent, type AISegment } from '../../../utils/aiContent';
import { CodeBlock } from './CodeBlock';
import styles from './AIMessageBubble.module.css';

interface Props {
  message: ChatMessage;
  onRetry?: (content: string) => void;
  onSendToAI?: (content: string) => void;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function AIMessageBubble({ message, onRetry, onSendToAI }: Props) {
  const isUser = message.role === 'user';
  const hasError = !!message.error;

  return (
    <div className={cx(styles.row, isUser && styles.rowUser)}>
      <div className={cx(styles.bubble, isUser && styles.bubbleUser, hasError && styles.bubbleError)}>
        {isUser ? (
          <div className={styles.content}>{message.content}</div>
        ) : (
          <AssistantContent content={message.content} onSendToAI={onSendToAI} />
        )}
        {hasError && (
          <div className={styles.errorBlock}>
            <div className={styles.errorText}>{message.error}</div>
            {onRetry && (
              <button
                type="button"
                onClick={() => onRetry(message.content)}
                className={styles.retryBtn}
              >
                Edit &amp; Retry
              </button>
            )}
          </div>
        )}
      </div>
      <div className={cx(styles.timestamp, isUser && styles.timestampUser)}>
        {formatTimestamp(message.timestamp)}
      </div>
    </div>
  );
}

function AssistantContent({ content, onSendToAI }: { content: string; onSendToAI?: (content: string) => void }) {
  const segments = parseAIContent(content);
  if (segments.length === 0) return null;
  return <>{segments.map((seg, i) => renderSegment(seg, i, onSendToAI))}</>;
}

function renderSegment(seg: AISegment, key: number, onSendToAI?: (content: string) => void) {
  if (seg.kind === 'text') {
    return <div key={key} className={styles.content}>{seg.text}</div>;
  }
  return <CodeBlock key={key} lang={seg.lang} code={seg.code} onSendToAI={onSendToAI} />;
}
