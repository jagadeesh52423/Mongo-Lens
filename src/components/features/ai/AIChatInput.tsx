import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, type KeyboardEvent } from 'react';
import styles from './AIChatInput.module.css';

export const MIN_TEXTAREA_ROWS = 1;
export const MAX_TEXTAREA_ROWS = 5;
const TEXTAREA_LINE_HEIGHT_PX = 18;
const TEXTAREA_VERTICAL_PADDING_PX = 16; // 6px top + 6px bottom + 4px buffer

interface Props {
  value: string;
  onChange: (next: string) => void;
  onSend: () => void;
  /** Enables the Send button and the textarea. False when AI is unconfigured. */
  isConfigured: boolean;
  /** True while a chat request is in flight — keeps Send disabled. */
  loading: boolean;
  /** True when there's an active tab to attach the chat to. */
  hasActiveTab: boolean;
  /** True when the active tab has any chat history to clear. */
  hasHistory: boolean;
  onClearContext: () => void;
}

/**
 * Imperative handle: parents can call `focus()` to move keyboard focus into
 * the textarea (used by the retry affordance after a failed message).
 */
export interface AIChatInputHandle {
  focus: () => void;
}

/**
 * Composer for the AI chat: autosizing textarea + Send button + clear-context
 * link. Owns Enter / Shift+Enter semantics and the autosize calculation
 * (driven by line height + max rows). Keystroke → onChange; submit → onSend.
 */
export const AIChatInput = forwardRef<AIChatInputHandle, Props>(function AIChatInput(
  { value, onChange, onSend, isConfigured, loading, hasActiveTab, hasHistory, onClearContext },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }), []);

  // Auto-grow textarea up to MAX_TEXTAREA_ROWS, then enable internal scrolling.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const maxHeight = MAX_TEXTAREA_ROWS * TEXTAREA_LINE_HEIGHT_PX + TEXTAREA_VERTICAL_PADDING_PX;
    const desired = Math.min(ta.scrollHeight, maxHeight);
    ta.style.height = `${desired}px`;
  }, [value]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter sends; Shift+Enter inserts a newline (textarea default).
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onSend();
      }
    },
    [onSend],
  );

  const canSend = isConfigured && hasActiveTab && value.trim().length > 0 && !loading;

  return (
    <div className={styles.area}>
      <div className={styles.row}>
        <textarea
          ref={textareaRef}
          rows={MIN_TEXTAREA_ROWS}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isConfigured ? 'Ask anything…' : 'Configure AI in settings…'}
          disabled={!isConfigured}
          className={styles.textarea}
        />
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          className={styles.sendButton}
        >
          Send
        </button>
      </div>
      <button
        type="button"
        onClick={onClearContext}
        disabled={!hasActiveTab || !hasHistory}
        className={styles.clearLink}
      >
        Clear context
      </button>
    </div>
  );
});
