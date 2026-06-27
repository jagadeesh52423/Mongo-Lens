import { create } from 'zustand';

export type AgentEntry =
  | { kind: 'model-text'; text: string }
  | { kind: 'tool-call'; id: string; statement: string }
  | { kind: 'tool-result'; id: string; ok: boolean; summary: string }
  | { kind: 'confirm'; id: string; statement: string; category: string | null; collection: string | null; resolved?: 'approved' | 'denied' }
  | { kind: 'final'; text: string }
  | { kind: 'error'; text: string };

interface AgentTabState { entries: AgentEntry[]; running: boolean; }

interface AgentStore {
  byTab: Record<string, AgentTabState>;
  append: (tabId: string, entry: AgentEntry) => void;
  setRunning: (tabId: string, running: boolean) => void;
  resolveConfirm: (tabId: string, id: string, decision: 'approved' | 'denied') => void;
  clear: (tabId: string) => void;
}

const empty = (): AgentTabState => ({ entries: [], running: false });

const pendingResolvers = new Map<string, (d: 'approved' | 'denied') => void>();
export function registerConfirm(key: string, resolve: (d: 'approved' | 'denied') => void) {
  pendingResolvers.set(key, resolve);
}

export const useAgentStore = create<AgentStore>((set) => ({
  byTab: {},
  append: (tabId, entry) => set((s) => {
    const tab = s.byTab[tabId] ?? empty();
    return { byTab: { ...s.byTab, [tabId]: { ...tab, entries: [...tab.entries, entry] } } };
  }),
  setRunning: (tabId, running) => set((s) => {
    const tab = s.byTab[tabId] ?? empty();
    return { byTab: { ...s.byTab, [tabId]: { ...tab, running } } };
  }),
  resolveConfirm: (tabId, id, decision) => set((s) => {
    const key = `${tabId}:${id}`;
    const fire = pendingResolvers.get(key);
    if (fire) {
      pendingResolvers.delete(key);
      fire(decision);
    }
    const tab = s.byTab[tabId] ?? empty();
    return {
      byTab: {
        ...s.byTab,
        [tabId]: {
          ...tab,
          entries: tab.entries.map(
            (e) => (e.kind === 'confirm' && e.id === id ? { ...e, resolved: decision } : e),
          ),
        },
      },
    };
  }),
  clear: (tabId) => set((s) => ({ byTab: { ...s.byTab, [tabId]: empty() } })),
}));
