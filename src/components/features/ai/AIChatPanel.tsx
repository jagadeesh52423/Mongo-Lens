import { useCallback, useMemo, useRef, useState } from 'react';
import { useAIStore, type ChatMessage } from '../../../store/ai';
import { useEditorStore } from '../../../store/editor';
import { useSettingsStore } from '../../../store/settings';
import { useResizable } from '../../ui';
import { AIChatHeader } from './AIChatHeader';
import { AIChatMessageList } from './AIChatMessageList';
import { AIChatInput, type AIChatInputHandle } from './AIChatInput';
import styles from './AIChatPanel.module.css';

const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 280;
const MAX_WIDTH = 600;
const AI_PANEL_WIDTH_STORAGE_KEY = 'ai.panel.width';

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
 * Composed of three siblings — `AIChatHeader` / `AIChatMessageList` /
 * `AIChatInput` — wired together here. Messages are read from `useAIStore`
 * keyed by the active editor tab (per-tab isolation); sends are delegated to
 * the `onSendMessage` prop so this component knows nothing about the AI
 * service layer.
 *
 * The panel is edge-docked: width is owned locally via `useResizable` with
 * `invert: true` because the drag handle sits on the panel's LEFT edge —
 * dragging left must INCREASE width.
 */
export function AIChatPanel({ onSendMessage, onOpenSettings, onClearContext }: Props) {
  const panelOpen = useAIStore((s) => s.panelOpen);
  const setPanelOpen = useAIStore((s) => s.setPanelOpen);
  const chatHistories = useAIStore((s) => s.chatHistories);
  const loadingStates = useAIStore((s) => s.loadingStates);
  const clearHistory = useAIStore((s) => s.clearHistory);

  const activeTabId = useEditorStore((s) => s.activeTabId);
  const aiConfig = useSettingsStore((s) => s.aiConfig);

  const { size: width, handlers: resizeHandlers } = useResizable({
    direction: 'horizontal',
    initial: DEFAULT_WIDTH,
    min: MIN_WIDTH,
    max: MAX_WIDTH,
    invert: true,
    storageKey: AI_PANEL_WIDTH_STORAGE_KEY,
  });

  const [input, setInput] = useState('');
  const inputRef = useRef<AIChatInputHandle>(null);

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

  const handleSend = useCallback(() => {
    if (!activeTabId) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    if (!isConfigured) return;
    if (loading) return;
    onSendMessage(activeTabId, trimmed);
    setInput('');
  }, [activeTabId, input, isConfigured, loading, onSendMessage]);

  const handleRetry = useCallback((content: string) => {
    setInput(content);
    inputRef.current?.focus();
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

  return (
    <div className={styles.container} style={{ width: width }}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize AI panel"
        className={styles.resizeHandle}
        {...resizeHandlers}
      />
      <AIChatHeader onClose={() => setPanelOpen(false)} />
      <AIChatMessageList
        messages={messages}
        loading={loading}
        isConfigured={isConfigured}
        onOpenSettings={onOpenSettings}
        onRetry={handleRetry}
      />
      <AIChatInput
        ref={inputRef}
        value={input}
        onChange={setInput}
        onSend={handleSend}
        isConfigured={isConfigured}
        loading={loading}
        hasActiveTab={!!activeTabId}
        hasHistory={messages.length > 0}
        onClearContext={handleClearContext}
      />
    </div>
  );
}
