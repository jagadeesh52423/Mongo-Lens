import type { CSSProperties } from 'react';
import type { ChatMessage } from '../../store/ai';
import { parseAIContent, type AISegment } from '../../utils/aiContent';
import { CodeBlock } from './CodeBlock';

interface Props {
  message: ChatMessage;
  onRetry?: (content: string) => void;
}

const ERROR_COLOR = 'var(--accent-red)';

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function AIMessageBubble({ message, onRetry }: Props) {
  const isUser = message.role === 'user';
  const hasError = !!message.error;

  return (
    <div style={rowStyle(isUser)}>
      <div style={bubbleStyle(isUser, hasError)}>
        {isUser ? (
          <div style={contentStyle}>{message.content}</div>
        ) : (
          <AssistantContent content={message.content} />
        )}
        {hasError && (
          <div style={errorBlockStyle}>
            <div style={errorTextStyle}>{message.error}</div>
            {onRetry && (
              <button
                type="button"
                onClick={() => onRetry(message.content)}
                style={retryButtonStyle}
              >
                Edit &amp; Retry
              </button>
            )}
          </div>
        )}
      </div>
      <div style={timestampStyle(isUser)}>{formatTimestamp(message.timestamp)}</div>
    </div>
  );
}

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

function rowStyle(isUser: boolean): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    alignItems: isUser ? 'flex-end' : 'flex-start',
    gap: 2,
    width: '100%',
  };
}

function bubbleStyle(isUser: boolean, hasError: boolean): CSSProperties {
  return {
    maxWidth: '85%',
    padding: '8px 12px',
    borderRadius: 8,
    background: isUser ? 'var(--accent)' : 'var(--bg-elevated, var(--bg-panel))',
    color: isUser ? 'var(--bg)' : 'var(--fg)',
    border: hasError ? `1px solid ${ERROR_COLOR}` : '1px solid transparent',
    fontSize: 13,
    lineHeight: 1.45,
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
  };
}

const contentStyle: CSSProperties = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const errorBlockStyle: CSSProperties = {
  marginTop: 6,
  paddingTop: 6,
  borderTop: `1px dashed ${ERROR_COLOR}`,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const errorTextStyle: CSSProperties = {
  color: ERROR_COLOR,
  fontSize: 11,
};

const retryButtonStyle: CSSProperties = {
  alignSelf: 'flex-start',
  padding: '2px 8px',
  borderRadius: 4,
  border: `1px solid ${ERROR_COLOR}`,
  background: 'transparent',
  color: ERROR_COLOR,
  fontSize: 11,
  cursor: 'pointer',
};

function timestampStyle(isUser: boolean): CSSProperties {
  return {
    fontSize: 10,
    color: 'var(--fg-dim)',
    padding: isUser ? '0 4px 0 0' : '0 0 0 4px',
  };
}
