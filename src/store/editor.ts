import { create } from 'zustand';
import type { EditorTab } from '../types';
import { useConnectionsStore } from './connections';

interface EditorState {
  tabs: EditorTab[];
  activeTabId: string | null;
  savedScriptsVersion: number;
  openTab: (tab: EditorTab) => void;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  updateContent: (id: string, content: string) => void;
  markClean: (id: string) => void;
  renameTab: (id: string, title: string) => void;
  updateTab: (id: string, patch: Partial<EditorTab>) => void;
  bumpScriptsVersion: () => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  tabs: [],
  activeTabId: null,
  savedScriptsVersion: 0,
  openTab: (tab) =>
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
      return { tabs: [...s.tabs, next], activeTabId: next.id };
    }),
  closeTab: (id) =>
    set((s) => {
      const remaining = s.tabs.filter((t) => t.id !== id);
      const nextActive =
        s.activeTabId === id
          ? remaining[remaining.length - 1]?.id ?? null
          : s.activeTabId;
      return { tabs: remaining, activeTabId: nextActive };
    }),
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
}));
