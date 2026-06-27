import { create } from 'zustand';
import type { AgentMessage } from '../services/ai/providers/AIProvider';

export type AgentEntry =
  | { kind: 'user'; text: string }
  | { kind: 'model-text'; text: string }
  | { kind: 'tool-call'; id: string; statement: string }
  | { kind: 'tool-result'; id: string; ok: boolean; summary: string }
  | { kind: 'confirm'; id: string; statement: string; category: string | null; collection: string | null; resolved?: 'approved' | 'denied' }
  | { kind: 'final'; text: string }
  | { kind: 'error'; text: string };

interface AgentTabState { entries: AgentEntry[]; running: boolean; }

interface AgentStore {
  /** UI transcript per tab. */
  byTab: Record<string, AgentTabState>;
  /** Raw LLM conversation per tab, carried across runs so follow-ups keep context. */
  convoByTab: Record<string, AgentMessage[]>;
  append: (tabId: string, entry: AgentEntry) => void;
  setRunning: (tabId: string, running: boolean) => void;
  setConvo: (tabId: string, messages: AgentMessage[]) => void;
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
  convoByTab: {},
  append: (tabId, entry) => set((s) => {
    const tab = s.byTab[tabId] ?? empty();
    return { byTab: { ...s.byTab, [tabId]: { ...tab, entries: [...tab.entries, entry] } } };
  }),
  setRunning: (tabId, running) => set((s) => {
    const tab = s.byTab[tabId] ?? empty();
    return { byTab: { ...s.byTab, [tabId]: { ...tab, running } } };
  }),
  setConvo: (tabId, messages) => set((s) => ({ convoByTab: { ...s.convoByTab, [tabId]: messages } })),
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
  clear: (tabId) => set((s) => ({
    byTab: { ...s.byTab, [tabId]: empty() },
    convoByTab: { ...s.convoByTab, [tabId]: [] },
  })),
}));
