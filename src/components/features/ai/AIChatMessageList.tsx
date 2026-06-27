import { useLayoutEffect, useRef } from 'react';
import type { ChatMessage } from '../../../store/ai';
import { AIMessageBubble } from './AIMessageBubble';
import panelStyles from './AIChatPanel.module.css';
import styles from './AIChatMessageList.module.css';

interface Props {
  messages: ChatMessage[];
  loading: boolean;
  /** True when AI baseUrl + model are populated. Drives the empty/unconfigured state. */
  isConfigured: boolean;
  onOpenSettings?: () => void;
  /** Click-to-Edit on errored bubbles re-populates the input with the failed message. */
  onRetry: (content: string) => void;
  /** Lets a code block's Explain result be sent back into the chat as a follow-up. */
  onSendToAI?: (content: string) => void;
}

/**
 * Scrollable message list for the AI chat panel. Owns its own auto-scroll
 * behavior — when `messages.length` or `loading` changes, the viewport pins
 * itself to the bottom so new content is always visible.
 *
 * Virtualization is intentionally NOT used: chat histories are small (<1000
 * messages per tab) and CSS overflow scroll handles the case naturally.
 */
export function AIChatMessageList({ messages, loading, isConfigured, onOpenSettings, onRetry, onSendToAI }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, loading]);

  return (
    <div ref={scrollRef} className={styles.list}>
      {!isConfigured ? (
        <div className={styles.unconfigured}>
          <div className={styles.unconfiguredHint}>No AI configured.</div>
          {onOpenSettings && (
            <button type="button" onClick={onOpenSettings} className={styles.linkButton}>
              Open Settings
            </button>
          )}
        </div>
      ) : messages.length === 0 ? (
        <div className={styles.empty}>
          Ask anything about your query, results, or schema.
        </div>
      ) : (
        messages.map((m, idx) => (
          <AIMessageBubble
            key={`${m.timestamp}-${idx}`}
            message={m}
            onRetry={m.error ? onRetry : undefined}
            onSendToAI={onSendToAI}
          />
        ))
      )}
      {loading && (
        <div className={styles.loadingBubble} aria-label="AI is thinking">
          <span className={panelStyles.loadingDots}>
            <span>·</span>
            <span>·</span>
            <span>·</span>
          </span>
        </div>
      )}
    </div>
  );
}
