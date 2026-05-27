import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { useAIStore, type ChatMessage } from '../../../store/ai';
import { useEditorStore } from '../../../store/editor';
import { useSettingsStore } from '../../../store/settings';
import { AIMessageBubble } from './AIMessageBubble';

const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 280;
const MAX_WIDTH = 600;
const MIN_TEXTAREA_ROWS = 1;
const MAX_TEXTAREA_ROWS = 5;
const TEXTAREA_LINE_HEIGHT_PX = 18;

interface Props {
  onSendMessage: (tabId: string, content: string) => void;
  onOpenSettings?: () => void;
  /**
   * Called when the user clicks "Clear context". Parent is responsible for
   * clearing both the UI chat history (via `useAIStore.clearHistory`) and any
   * service-side conversation state (e.g. the ChatHistoryManager).
   * If omitted, this component falls back to clearing the UI store directly.
   */
  onClearContext?: (tabId: string) => void;
}

/**
 * Side-docked AI chat panel.
 *
 * Panel is resized via the left-edge drag handle; messages are read from
 * `useAIStore` keyed by the active editor tab ID (per-tab isolation).
 * Sending a message is delegated to the `onSendMessage` prop — this component
 * does not know about the AI service layer.
 */
export function AIChatPanel({ onSendMessage, onOpenSettings, onClearContext }: Props) {
  const panelOpen = useAIStore((s) => s.panelOpen);
  const setPanelOpen = useAIStore((s) => s.setPanelOpen);
  const chatHistories = useAIStore((s) => s.chatHistories);
  const loadingStates = useAIStore((s) => s.loadingStates);
  const clearHistory = useAIStore((s) => s.clearHistory);

  const activeTabId = useEditorStore((s) => s.activeTabId);
  const aiConfig = useSettingsStore((s) => s.aiConfig);

  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [input, setInput] = useState('');
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const messages = useMemo<ChatMessage[]>(
    () => (activeTabId ? chatHistories.get(activeTabId) ?? [] : []),
    [activeTabId, chatHistories],
  );
  const loading = activeTabId ? loadingStates.get(activeTabId) === true : false;
  // `apiToken` is NOT checked here — it lives in the OS keychain (see
  // `ipc.ts` `getAiToken`) and is not mirrored to the store on load. AIService
  // fetches the token at send time and surfaces a proper error bubble if it's
  // missing. This check is just a hint for the empty-state message.
  const isConfigured = !!aiConfig.baseUrl && !!aiConfig.model;

  // Auto-scroll messages on new content
  useLayoutEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, loading]);

  // Auto-grow textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const maxHeight = MAX_TEXTAREA_ROWS * TEXTAREA_LINE_HEIGHT_PX + 16;
    const desired = Math.min(ta.scrollHeight, maxHeight);
    ta.style.height = `${desired}px`;
  }, [input]);

  // Left-edge drag to resize
  const resizeOriginRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      resizeOriginRef.current = { startX: e.clientX, startWidth: width };
      const onMove = (ev: MouseEvent) => {
        const origin = resizeOriginRef.current;
        if (!origin) return;
        // Panel is docked right — dragging left (negative dx) grows width
        const dx = ev.clientX - origin.startX;
        const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, origin.startWidth - dx));
        setWidth(next);
      };
      const onUp = () => {
        resizeOriginRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [width],
  );

  const handleSend = useCallback(() => {
    if (!activeTabId) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    if (!isConfigured) return;
    if (loading) return;
    onSendMessage(activeTabId, trimmed);
    setInput('');
  }, [activeTabId, input, isConfigured, loading, onSendMessage]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter sends; Shift+Enter inserts newline
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleRetry = useCallback((content: string) => {
    setInput(content);
    textareaRef.current?.focus();
  }, []);

  const handleClearContext = useCallback(() => {
    if (!activeTabId) return;
    if (onClearContext) {
      // Parent owns the full clear (UI store + service history).
      onClearContext(activeTabId);
    } else {
      // No parent handler — fall back to clearing just the UI store.
      clearHistory(activeTabId);
    }
  }, [activeTabId, clearHistory, onClearContext]);

  if (!panelOpen) return null;

  const canSend = isConfigured && !!activeTabId && input.trim().length > 0 && !loading;

  return (
    <div style={{ ...containerStyle, width }}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize AI panel"
        style={resizeHandleStyle}
        onMouseDown={handleResizeMouseDown}
      />

      <div style={headerStyle}>
        <span style={titleStyle}>✨ AI Assistant</span>
        <button
          type="button"
          aria-label="Close AI panel"
          title="Close"
          onClick={() => setPanelOpen(false)}
          style={closeButtonStyle}
        >
          ×
        </button>
      </div>

      <div ref={messagesRef} style={messagesAreaStyle}>
        {!isConfigured ? (
          <div style={unconfiguredStyle}>
            <div style={{ marginBottom: 8 }}>No AI configured.</div>
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                style={linkButtonStyle}
              >
                Open Settings
              </button>
            )}
          </div>
        ) : messages.length === 0 ? (
          <div style={emptyStateStyle}>
            Ask anything about your query, results, or schema.
          </div>
        ) : (
          messages.map((m, idx) => (
            <AIMessageBubble
              key={`${m.timestamp}-${idx}`}
              message={m}
              onRetry={m.error ? handleRetry : undefined}
            />
          ))
        )}
        {loading && (
          <div style={loadingBubbleStyle} aria-label="AI is thinking">
            <span className="ai-loading-dots">
              <span>·</span>
              <span>·</span>
              <span>·</span>
            </span>
          </div>
        )}
      </div>

      <div style={inputAreaStyle}>
        <div style={inputRowStyle}>
          <textarea
            ref={textareaRef}
            rows={MIN_TEXTAREA_ROWS}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isConfigured ? 'Ask anything…' : 'Configure AI in settings…'}
            disabled={!isConfigured}
            style={textareaStyle}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            style={sendButtonStyle(canSend)}
          >
            Send
          </button>
        </div>
        <button
          type="button"
          onClick={handleClearContext}
          disabled={!activeTabId || messages.length === 0}
          style={clearLinkStyle}
        >
          Clear context
        </button>
      </div>

      <style>{loadingDotsKeyframes}</style>
    </div>
  );
}

const loadingDotsKeyframes = `
@keyframes aiLoadingBlink {
  0%, 80%, 100% { opacity: 0.2; }
  40% { opacity: 1; }
}
.ai-loading-dots span {
  display: inline-block;
  font-size: 20px;
  line-height: 1;
  padding: 0 2px;
  animation: aiLoadingBlink 1.2s infinite both;
}
.ai-loading-dots span:nth-child(2) { animation-delay: 0.2s; }
.ai-loading-dots span:nth-child(3) { animation-delay: 0.4s; }
`;

const containerStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minWidth: MIN_WIDTH,
  maxWidth: MAX_WIDTH,
  background: 'var(--bg-panel)',
  borderLeft: '1px solid var(--border)',
  flexShrink: 0,
};

const resizeHandleStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: -2,
  width: 4,
  height: '100%',
  cursor: 'col-resize',
  background: 'transparent',
  zIndex: 1,
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: 36,
  padding: '0 10px',
  background: 'var(--bg-panel)',
  borderBottom: '1px solid var(--border)',
  flexShrink: 0,
};

const titleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--fg)',
};

const closeButtonStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--fg-dim)',
  fontSize: 18,
  lineHeight: 1,
  width: 24,
  height: 24,
  cursor: 'pointer',
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 3,
};

const messagesAreaStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const emptyStateStyle: CSSProperties = {
  color: 'var(--fg-dim)',
  fontSize: 12,
  textAlign: 'center',
  marginTop: 20,
  fontStyle: 'italic',
};

const unconfiguredStyle: CSSProperties = {
  color: 'var(--fg-dim)',
  fontSize: 13,
  textAlign: 'center',
  marginTop: 20,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
};

const linkButtonStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--accent)',
  fontSize: 12,
  cursor: 'pointer',
  padding: 4,
  textDecoration: 'underline',
};

const loadingBubbleStyle: CSSProperties = {
  alignSelf: 'flex-start',
  padding: '6px 10px',
  borderRadius: 8,
  background: 'var(--bg-elevated, var(--bg-panel))',
  color: 'var(--fg-dim)',
  border: '1px solid var(--border)',
};

const inputAreaStyle: CSSProperties = {
  borderTop: '1px solid var(--border)',
  padding: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  flexShrink: 0,
};

const inputRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  gap: 6,
};

const textareaStyle: CSSProperties = {
  flex: 1,
  resize: 'none',
  padding: '6px 8px',
  fontSize: 13,
  lineHeight: `${TEXTAREA_LINE_HEIGHT_PX}px`,
  background: 'var(--bg)',
  color: 'var(--fg)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  fontFamily: 'inherit',
  minHeight: TEXTAREA_LINE_HEIGHT_PX + 16,
  maxHeight: MAX_TEXTAREA_ROWS * TEXTAREA_LINE_HEIGHT_PX + 16,
  overflowY: 'auto',
};

function sendButtonStyle(enabled: boolean): CSSProperties {
  return {
    padding: '6px 12px',
    fontSize: 12,
    background: enabled ? 'var(--accent-green)' : 'var(--bg-panel)',
    color: enabled ? 'var(--bg)' : 'var(--fg-dim)',
    border: enabled ? 'none' : '1px solid var(--border)',
    borderRadius: 4,
    cursor: enabled ? 'pointer' : 'not-allowed',
    opacity: enabled ? 1 : 0.6,
    height: 30,
  };
}

const clearLinkStyle: CSSProperties = {
  alignSelf: 'flex-start',
  background: 'transparent',
  border: 'none',
  color: 'var(--fg-dim)',
  fontSize: 11,
  cursor: 'pointer',
  padding: '2px 0',
  textDecoration: 'underline',
};
