import { useEffect, useRef } from 'react';
import { useEditorStore } from '../store/editor';
import type { EditorTab } from '../types';
import { keyboardService, useKeyboardService } from '../services/KeyboardService';
import { DEFAULT_SHORTCUTS } from '../shortcuts/defaults';
import { newScriptTab } from '../utils/newScriptTab';

interface TabActionState {
  tabs: EditorTab[];
  activeTabId: string | null;
  setActive: (id: string) => void;
  closeTab: (id: string) => void;
  openTab: (tab: EditorTab) => void;
}

interface TabActionDef {
  id: string;
  execute: (state: TabActionState) => void;
}

const TAB_INDEX_COUNT = 9;

const ALL_ACTIONS: TabActionDef[] = [
  {
    id: 'tab.next',
    execute: ({ tabs, activeTabId, setActive }) => {
      if (tabs.length === 0 || activeTabId === null) return;
      const idx = tabs.findIndex((t) => t.id === activeTabId);
      if (idx < 0) return;
      setActive(tabs[(idx + 1) % tabs.length].id);
    },
  },
  {
    id: 'tab.prev',
    execute: ({ tabs, activeTabId, setActive }) => {
      if (tabs.length === 0 || activeTabId === null) return;
      const idx = tabs.findIndex((t) => t.id === activeTabId);
      if (idx < 0) return;
      setActive(tabs[(idx - 1 + tabs.length) % tabs.length].id);
    },
  },
  {
    id: 'tab.close',
    execute: ({ activeTabId, closeTab }) => {
      if (activeTabId === null) return;
      closeTab(activeTabId);
    },
  },
  {
    id: 'tab.new',
    execute: ({ openTab }) => {
      openTab(newScriptTab());
    },
  },
  ...Array.from({ length: TAB_INDEX_COUNT }, (_, i): TabActionDef => {
    const n = i + 1;
    return {
      id: `tab.goTo.${n}`,
      execute: ({ tabs, setActive }) => {
        const target = tabs[n - 1];
        if (target) setActive(target.id);
      },
    };
  }),
];

const TAB_ACTION_IDS = new Set(ALL_ACTIONS.map((a) => a.id));
DEFAULT_SHORTCUTS
  .filter((def) => TAB_ACTION_IDS.has(def.id))
  .forEach((def) => keyboardService.defineShortcut(def));

export function useTabActions(): void {
  const svc = useKeyboardService();
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const setActive = useEditorStore((s) => s.setActive);
  const closeTab = useEditorStore((s) => s.closeTab);
  const openTab = useEditorStore((s) => s.openTab);

  const stateRef = useRef<TabActionState>({ tabs, activeTabId, setActive, closeTab, openTab });
  stateRef.current = { tabs, activeTabId, setActive, closeTab, openTab };

  useEffect(() => {
    const unregisters = ALL_ACTIONS.map((def) =>
      svc.register(def.id, () => def.execute(stateRef.current)),
    );
    return () => unregisters.forEach((fn) => fn());
  }, [svc]);
}
