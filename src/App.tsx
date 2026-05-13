import { useState, useEffect, useRef, useCallback, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Panel, PanelGroup, type ImperativePanelHandle } from 'react-resizable-panels';
import { IconRail } from './components/layout/IconRail';
import { SidePanel } from './components/layout/SidePanel';
import { SplashScreen } from './components/layout/SplashScreen';
import { StatusBar } from './components/layout/StatusBar';
import { ConnectionPanel } from './components/connections/ConnectionPanel';
import { EditorArea } from './components/editor/EditorArea';
import { SavedScriptsPanel } from './components/saved-scripts/SavedScriptsPanel';
import {
  BuiltInActivityRegistry,
  PluginActivityRegistry,
  CompositeActivityRegistry,
  resolveActiveId,
  type ActivityItem,
} from './layout/activityBar';
import type { Registry } from './plugins/Registry';
import type { ViewProvider } from './plugins/api/contracts';
import { SettingsView } from './settings/SettingsView';
import { SplitHandle } from './components/shared/SplitHandle';
import { AIFloatingButton } from './components/ai/AIFloatingButton';
import { AIChatPanel } from './components/ai/AIChatPanel';
import { useConnectionsStore } from './store/connections';
import { useAIStore } from './store/ai';
import { useEditorStore } from './store/editor';
import { useSettingsStore } from './store/settings';
import { useScriptEvents } from './hooks/useScriptEvents';
import { checkNodeRunner, installNodeRunner, getAiToken } from './ipc';
import { keyboardService } from './services/KeyboardService';
import { DEFAULT_SHORTCUTS } from './shortcuts/defaults';
import { useLogger } from './services/logger';
import { aiService } from './services/ai/AIService';
import { chatHistoryManager } from './services/ai/ChatHistoryManager';

const openSettingsDef = DEFAULT_SHORTCUTS.find((d) => d.id === 'open-settings');
if (openSettingsDef) keyboardService.defineShortcut(openSettingsDef);

function makeBuiltInRegistry(): BuiltInActivityRegistry {
  const reg = new BuiltInActivityRegistry();
  reg.add({
    id: 'connections',
    title: 'Connections',
    icon: '⚡',
    render: (container) => {
      // Each render gets an isolated wrapper so the old React root and the
      // incoming new root never share the same container node.
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'width:100%;height:100%';
      container.appendChild(wrapper);
      const root = createRoot(wrapper);
      root.render(createElement(ConnectionPanel));
      return {
        dispose() {
          // Remove wrapper from the live DOM synchronously so the next render
          // mounts into a clean container. Then unmount React deferred so we
          // don't call root.unmount() during a React commit phase.
          wrapper.remove();
          queueMicrotask(() => root.unmount());
        },
      };
    },
  });
  reg.add({
    id: 'saved',
    title: 'Saved Scripts',
    icon: '⭐',
    render: (container) => {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'width:100%;height:100%';
      container.appendChild(wrapper);
      const root = createRoot(wrapper);
      root.render(createElement(SavedScriptsPanel));
      return {
        dispose() {
          wrapper.remove();
          queueMicrotask(() => root.unmount());
        },
      };
    },
  });
  return reg;
}

export default function App() {
  const log = useLogger('components.App');
  useScriptEvents();
  const sidePanelRef = useRef<ImperativePanelHandle>(null);
  /**
   * In-flight AbortControllers keyed by tab ID. Each send creates one; it is
   * removed when the request settles. Aborted when the panel closes or the
   * owning tab is removed. A `Map` is used (not a single ref) so concurrent
   * sends across tabs don't trample each other's cancellation token.
   */
  const inFlightRef = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    // Prevent WKWebView from forwarding Escape to the native macOS responder
    // chain, which exits fullscreen. Capture phase fires before any element
    // handler (including Monaco), so this covers all focus positions.
    function suppressEscDefault(e: KeyboardEvent) {
      if (e.key === 'Escape') e.preventDefault();
    }
    window.addEventListener('keydown', suppressEscDefault, true);
    return () => window.removeEventListener('keydown', suppressEscDefault, true);
  }, []);

  useEffect(() => {
    checkNodeRunner()
      .then((status) => {
        log.info('runner check', { status });
        if (!status.ready) {
          log.info('runner not ready; installing');
          installNodeRunner()
            .then(() => log.info('runner install complete'))
            .catch((e) => log.error('runner install failed', { err: String(e) }));
        }
      })
      .catch((e) => log.error('runner check failed', { err: String(e) }));
  }, [log]);

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
    return () => {
      cancelled = true;
    };
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

  // Bootstrap the plugin host: discover installed plugins and activate any
  // that declare `onStartup`. Guard on __TAURI_INTERNALS__ so this is a
  // no-op in jsdom / unit tests (where Tauri IPC is absent) while still
  // surfacing real Tauri-side failures (FS errors, broken plugins) via
  // console.error so they appear in devtools and crash reports.
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return; // not in Tauri renderer
    let cancelled = false;
    (async () => {
      try {
        const { createTauriPluginFs } = await import('./plugins/io.tauri');
        const fs = await createTauriPluginFs();
        const { createPluginHost } = await import('./plugins/host');
        const { listConnections, updateConnection } = await import('./ipc');
        const host = createPluginHost({
          hostApiVersion: '1.0.0',
          logger: console as never,  // replace with the app's structured logger
          fs,
          pluginsRoot: fs.pluginsRoot,
          hostBackend: {
            async dbFind() { throw new Error('Host backend not wired'); },
            async netFetch(url, init) {
              // The plugin host has already enforced the network:fetch scope
              // for this URL before reaching here. We then go through the
              // renderer's fetch (Tauri's webview has CSP set to null so any
              // HTTPS host is reachable). Body is parsed as JSON when the
              // response declares it; otherwise returned as text.
              const res = await fetch(url, init as RequestInit | undefined);
              const ctype = res.headers.get('content-type') ?? '';
              let body: unknown;
              if (ctype.includes('application/json')) {
                try { body = await res.json(); } catch { body = undefined; }
              } else {
                body = await res.text();
              }
              return { status: res.status, body };
            },
            async connectionsList() {
              const all = await listConnections();
              return all.map(c => ({
                id: c.id, name: c.name, host: c.host, port: c.port, username: c.username,
              }));
            },
            async connectionsUpdateCredentials(id, password) {
              const all = await listConnections();
              const current = all.find(c => c.id === id);
              if (!current) throw new Error('Connection not found');
              // Strip server-only fields; patch only the password
              const { id: _id, createdAt: _createdAt, ...input } = current;
              await updateConnection(id, { ...input, password });
            },
          },
        });
        (window as unknown as Record<string, unknown>).__pluginHost = host;
        await host.manager.discover();
        if (!cancelled) await host.manager.activateStartup();
      } catch (e) {
        console.error('Plugin host bootstrap failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const persistedActiveId  = useSettingsStore(s => s.activeActivityItemId);
  const setPersistedActive = useSettingsStore(s => s.setActiveActivityItemId);
  const [items, setItems]  = useState<ActivityItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;
    const builtIns = makeBuiltInRegistry();
    let composite: CompositeActivityRegistry = new CompositeActivityRegistry([builtIns]);
    setItems(composite.list());
    let topSub: { dispose(): void } | null = null;

    // Wait for the plugin host bootstrap to complete; it sets window.__pluginHost.
    const trySubscribe = () => {
      if (cancelled) return;
      const host = (window as unknown as {
        __pluginHost?: {
          registries: { views: Registry<ViewProvider> };
          manager?: { get(id: string): { iconUrl?: string } | undefined };
        };
      }).__pluginHost;
      if (!host) { pendingTimer = setTimeout(trySubscribe, 50); return; }
      const manager = host.manager;
      const iconLookup = manager
        ? { iconUrlFor: (pluginId: string) => manager.get(pluginId)?.iconUrl }
        : undefined;
      const pluginReg = new PluginActivityRegistry(host.registries.views, iconLookup);
      composite = new CompositeActivityRegistry([builtIns, pluginReg]);
      setItems(composite.list());
      // composite.onDidChange fans into every child (including pluginReg),
      // so a single subscription is sufficient — no need to also subscribe pluginReg.
      topSub = composite.onDidChange(() => { if (!cancelled) setItems(composite.list()); });
    };
    trySubscribe();

    return () => {
      cancelled = true;
      if (pendingTimer) clearTimeout(pendingTimer);
      topSub?.dispose();
    };
  }, []);

  const activeId = resolveActiveId(items, persistedActiveId);

  function onChangeActive(id: string) {
    setPersistedActive(id);
  }

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const { connections, activeConnectionId, activeDatabase } = useConnectionsStore();
  const active = connections.find((c) => c.id === activeConnectionId);

  useEffect(() => {
    // Capture phase: we need to see keys BEFORE Monaco's internal keymap
    // consumes them. Monaco binds F3 ("find next") and Cmd+F ("find") on its
    // own editor instance and stops propagation, so a bubble-phase listener
    // never receives those keys when Monaco has focus. With capture, we see
    // every key first; dispatch() only stopPropagation()s on an actual match,
    // so unmatched keys flow through to Monaco as normal. Scope is resolved
    // strictly from the focused element's ancestor chain — panel shortcuts
    // only fire when focus is actually inside the panel (ResultsPanel
    // auto-focuses itself after a run so F3/F4 work without an extra click).
    const handler = (e: KeyboardEvent) => keyboardService.dispatch(e);
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  useEffect(() => {
    return keyboardService.register('open-settings', () => setSettingsOpen((s) => !s));
  }, []);

  /**
   * Orchestrate a chat send: mirror the user and assistant turns into the UI
   * store while AIService maintains its own authoritative history for future
   * context. Streaming updates are piped through `onChunk` so the UI reflects
   * tokens as they arrive instead of polling.
   */
  const handleSendMessage = useCallback(async (tabId: string, message: string) => {
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
  const handleClearContext = useCallback((tabId: string) => {
    useAIStore.getState().clearHistory(tabId);
    chatHistoryManager.clearHistory(tabId);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <IconRail
          items={items}
          activeId={activeId}
          onChange={onChangeActive}
          onSettingsOpen={() => setSettingsOpen((s) => !s)}
          settingsOpen={settingsOpen}
        />
        {settingsOpen ? (
          <SettingsView onClose={() => setSettingsOpen(false)} />
        ) : (
          <div style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0 }}>
            <PanelGroup direction="horizontal" style={{ flex: 1 }}>
              <Panel
                ref={sidePanelRef}
                minSize={10}
                defaultSize={20}
                collapsible
                collapsedSize={0}
              >
                <SidePanel item={items.find(i => i.id === activeId) ?? null} />
              </Panel>
              <SplitHandle direction="horizontal" />
              <Panel minSize={50} defaultSize={80}>
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
                  <EditorArea />
                </div>
              </Panel>
            </PanelGroup>
            {/*
              AIChatPanel returns null when panelOpen is false, so it consumes
              no layout space when closed. It owns its own width (380-600px)
              and a left-edge drag handle, so it lives as a flex sibling next
              to PanelGroup rather than as a Panel inside it — the two resize
              mechanisms would otherwise conflict.
            */}
            <AIChatPanel
              onSendMessage={handleSendMessage}
              onOpenSettings={() => setSettingsOpen(true)}
              onClearContext={handleClearContext}
            />
          </div>
        )}
      </div>
      {!settingsOpen && <AIFloatingButton />}
      <StatusBar
        connectionName={active?.name}
        database={activeDatabase ?? undefined}
        nodeStatus="Node.js ready"
      />
    </div>
  );
}
