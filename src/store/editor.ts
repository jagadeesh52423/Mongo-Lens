import { create } from 'zustand';
import type { EditorTab } from '../types';

interface EditorState {
  tabs: EditorTab[];
  activeTabId: string | null;
  openTab: (tab: EditorTab) => void;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  updateContent: (id: string, content: string) => void;
  markClean: (id: string) => void;
  renameTab: (id: string, title: string) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  tabs: [],
  activeTabId: null,
  openTab: (tab) =>
    set((s) => {
      const existing = s.tabs.find((t) => t.id === tab.id);
      if (existing) return { activeTabId: tab.id };
      return { tabs: [...s.tabs, tab], activeTabId: tab.id };
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
}));
