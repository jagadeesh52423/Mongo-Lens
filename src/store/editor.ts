import { create } from 'zustand';
import { ask } from '@tauri-apps/plugin-dialog';
import type { EditorTab } from '../types';
import { useConnectionsStore } from './connections';

export const DEFAULT_PANEL_SIZES: [number, number] = [60, 40];

interface EditorState {
  tabs: EditorTab[];
  activeTabId: string | null;
  savedScriptsVersion: number;
  panelSizes: Record<string, [number, number]>;
  openTab: (tab: EditorTab) => void;
  closeTab: (id: string) => void | Promise<void>;
  setActive: (id: string) => void;
  updateContent: (id: string, content: string) => void;
  markClean: (id: string) => void;
  renameTab: (id: string, title: string) => void;
  updateTab: (id: string, patch: Partial<EditorTab>) => void;
  bumpScriptsVersion: () => void;
  setPanelSizes: (tabId: string, sizes: [number, number]) => void;
  initPanelSizes: (tabId: string) => void;
  removePanelSizes: (tabId: string) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  savedScriptsVersion: 0,
  panelSizes: {},
  openTab: (tab) => {
    let openedId = tab.id;
    set((s) => {
      const existing = s.tabs.find((t) => t.id === tab.id);
      if (existing) return { activeTabId: tab.id };
      let next = tab;
      if (tab.type === 'script' && !tab.connectionId) {
        const { activeConnectionId, activeDatabase } = useConnectionsStore.getState();
        if (activeConnectionId) {
          next = {
            ...tab,
            connectionId: activeConnectionId,
            database: tab.database ?? activeDatabase ?? undefined,
          };
        }
      }
      openedId = next.id;
      return { tabs: [...s.tabs, next], activeTabId: next.id };
    });
    get().initPanelSizes(openedId);
  },
  closeTab: async (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (tab && tab.type === 'script' && tab.isDirty) {
      const ok = await ask('You have unsaved changes. Discard them?', {
        title: 'Unsaved changes',
        kind: 'warning',
      });
      if (!ok) return;
    }
    set((s) => {
      const remaining = s.tabs.filter((t) => t.id !== id);
      const nextActive =
        s.activeTabId === id
          ? remaining[remaining.length - 1]?.id ?? null
          : s.activeTabId;
      return { tabs: remaining, activeTabId: nextActive };
    });
    get().removePanelSizes(id);
  },
  setActive: (id) => set({ activeTabId: id }),
  updateContent: (id, content) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, content, isDirty: true } : t,
      ),
    })),
  markClean: (id) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, isDirty: false } : t)),
    })),
  renameTab: (id, title) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)) })),
  updateTab: (id, patch) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
  bumpScriptsVersion: () => set((s) => ({ savedScriptsVersion: s.savedScriptsVersion + 1 })),
  setPanelSizes: (tabId, sizes) =>
    set((s) => ({ panelSizes: { ...s.panelSizes, [tabId]: sizes } })),
  initPanelSizes: (tabId) =>
    set((s) =>
      s.panelSizes[tabId]
        ? s
        : { panelSizes: { ...s.panelSizes, [tabId]: DEFAULT_PANEL_SIZES } },
    ),
  removePanelSizes: (tabId) =>
    set((s) => {
      const { [tabId]: _removed, ...rest } = s.panelSizes;
      return { panelSizes: rest };
    }),
}));
