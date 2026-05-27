import { useCallback, useEffect, useRef } from 'react';
import { aiService } from '../../../services/ai/AIService';
import { chatHistoryManager } from '../../../services/ai/ChatHistoryManager';
import { getAiToken } from '../../../ipc';
import { useAIStore } from '../../../store/ai';
import { useEditorStore } from '../../../store/editor';
import { useSettingsStore } from '../../../store/settings';
import { useLogger } from '../../../services/logger';

interface AIChatOrchestrator {
  sendMessage: (tabId: string, content: string) => Promise<void>;
  clearContext: (tabId: string) => void;
}

/**
 * Encapsulates the renderer-side AI chat lifecycle:
 *  - Seeds AIService with the current settings and resubscribes on change.
 *  - Hydrates the API token from the OS keychain on startup (the persisted
 *    settings reset `apiToken` to '' on every load).
 *  - Drops chat history for tabs that are closed and aborts any in-flight
 *    request for them.
 *  - Aborts every in-flight request when the AI panel closes.
 *  - Exposes `sendMessage` / `clearContext` callbacks used by AIChatPanel.
 *
 * Returns a stable handle: callers should pass the orchestrator's methods
 * straight into AIChatPanel as props.
 */
export function useAIChatOrchestrator(): AIChatOrchestrator {
  const log = useLogger('components.useAIChatOrchestrator');
  /**
   * In-flight AbortControllers keyed by tab ID. Each send creates one; it is
   * removed when the request settles. Aborted when the panel closes or the
   * owning tab is removed. A `Map` is used (not a single ref) so concurrent
   * sends across tabs don't trample each other's cancellation token.
   */
  const inFlightRef = useRef<Map<string, AbortController>>(new Map());

  // Seed AIService with the current AI settings and keep it in sync whenever
  // the user updates them. The provider is rebuilt per-call from the config so
  // changes take effect immediately on the next message.
  useEffect(() => {
    aiService.setConfig(useSettingsStore.getState().aiConfig);
    return useSettingsStore.subscribe(
      (s) => s.aiConfig,
      (aiConfig) => aiService.setConfig(aiConfig),
    );
  }, []);

  // Hydrate the API token from the OS keychain on startup. The persisted
  // settings reset `apiToken` to '' on every load (it never reaches disk), so
  // we pull it fresh from the secure store and push it into the in-memory
  // settings state. The existing subscription above forwards the update to
  // AIService automatically.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getAiToken();
        if (cancelled) return;
        if (token) {
          useSettingsStore.getState().setAIConfig({ apiToken: token });
        }
      } catch (err) {
        log.warn('failed to load AI token from keychain', { err: String(err) });
      }
    })();
    return () => { cancelled = true; };
  }, [log]);

  // When editor tabs close, drop their AI chat history from both the service
  // layer's authoritative store and the UI store so memory is not retained
  // for tabs that no longer exist, and abort any in-flight request for them.
  useEffect(() => {
    let prevTabIds = new Set(useEditorStore.getState().tabs.map((t) => t.id));
    return useEditorStore.subscribe((state) => {
      const currentTabIds = new Set(state.tabs.map((t) => t.id));
      for (const id of prevTabIds) {
        if (!currentTabIds.has(id)) {
          const controller = inFlightRef.current.get(id);
          if (controller) {
            controller.abort();
            inFlightRef.current.delete(id);
          }
          chatHistoryManager.removeTab(id);
          useAIStore.getState().removeTab(id);
        }
      }
      prevTabIds = currentTabIds;
    });
  }, []);

  // When the AI panel closes, abort every in-flight request so network calls
  // and streams don't continue running against a hidden UI. Also clean up on
  // unmount. The listener tracks the prior value manually because the AI store
  // is not set up with `subscribeWithSelector`.
  useEffect(() => {
    let prevOpen = useAIStore.getState().panelOpen;
    const unsubscribe = useAIStore.subscribe((s) => {
      if (prevOpen && !s.panelOpen) {
        inFlightRef.current.forEach((controller) => controller.abort());
        inFlightRef.current.clear();
      }
      prevOpen = s.panelOpen;
    });
    return () => {
      unsubscribe();
      inFlightRef.current.forEach((controller) => controller.abort());
      inFlightRef.current.clear();
    };
  }, []);

  /**
   * Orchestrate a chat send: mirror the user and assistant turns into the UI
   * store while AIService maintains its own authoritative history for future
   * context. Streaming updates are piped through `onChunk` so the UI reflects
   * tokens as they arrive instead of polling.
   */
  const sendMessage = useCallback(async (tabId: string, message: string) => {
    const aiState = useAIStore.getState();
    const aiConfig = useSettingsStore.getState().aiConfig;

    // Gate on minimum config — send button should already be disabled by the
    // panel, but guard here so we never push a user turn into the store for a
    // request that cannot be dispatched. Token is intentionally not checked
    // because it may live outside Zustand (keychain) in the future.
    if (!aiConfig.baseUrl || !aiConfig.model) return;

    // Abort any prior in-flight request for this tab (e.g. user mashed Send).
    inFlightRef.current.get(tabId)?.abort();
    const controller = new AbortController();
    inFlightRef.current.set(tabId, controller);

    // Show the user turn immediately so the message list updates without
    // waiting for the network round-trip.
    aiState.addMessage(tabId, { role: 'user', content: message, timestamp: Date.now() });
    aiState.setLoading(tabId, true);

    // Track whether we've already appended the in-progress assistant bubble.
    // First chunk → append; subsequent chunks → update last message in place.
    let assistantStarted = false;
    const assistantStamp = Date.now();

    try {
      const result = await aiService.sendMessage(tabId, message, {
        streaming: aiConfig.streaming,
        signal: controller.signal,
        onChunk: (_chunk, accumulated) => {
          if (!assistantStarted) {
            aiState.addMessage(tabId, {
              role: 'assistant',
              content: accumulated,
              timestamp: assistantStamp,
            });
            assistantStarted = true;
            return;
          }
          useAIStore.getState().updateLastMessage(tabId, { content: accumulated });
        },
      });

      // Non-streaming path: the onChunk callback never fired, so stamp the
      // full response into the store now.
      if (!assistantStarted) {
        aiState.addMessage(tabId, {
          role: 'assistant',
          content: result.content,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      // Distinguish user-initiated cancellation from real failures so the
      // retry affordance and error copy stay honest.
      const isAbort =
        (err instanceof DOMException && err.name === 'AbortError') ||
        (err instanceof Error && err.name === 'AbortError');
      const errorMessage = isAbort
        ? 'Cancelled'
        : err instanceof Error
          ? err.message
          : String(err);
      if (assistantStarted) {
        // Stream started then aborted/failed mid-way — keep accumulated content
        // and mark the existing bubble as errored so the user can Edit & Retry.
        useAIStore.getState().updateLastMessage(tabId, { error: errorMessage });
      } else {
        aiState.addMessage(tabId, {
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          error: errorMessage,
        });
      }
    } finally {
      // Only clear the controller slot if it still points at this request —
      // a subsequent send for the same tab may have already replaced it.
      if (inFlightRef.current.get(tabId) === controller) {
        inFlightRef.current.delete(tabId);
      }
      aiState.setLoading(tabId, false);
    }
  }, []);

  /**
   * Clear the tab's chat for both the UI store and the service-layer history
   * manager so the next message starts a fresh conversation (context from
   * editor/results/schema is still injected via the system prompt).
   */
  const clearContext = useCallback((tabId: string) => {
    useAIStore.getState().clearHistory(tabId);
    chatHistoryManager.clearHistory(tabId);
  }, []);

  return { sendMessage, clearContext };
}
