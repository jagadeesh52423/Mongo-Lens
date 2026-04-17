import { create } from 'zustand';
import type { ResultGroup } from '../types';

interface TabResults {
  groups: ResultGroup[];
  isRunning: boolean;
  executionMs?: number;
  lastError?: string;
}

interface ResultsState {
  byTab: Record<string, TabResults>;
  startRun: (tabId: string) => void;
  appendGroup: (tabId: string, group: ResultGroup) => void;
  setError: (tabId: string, error: string) => void;
  finishRun: (tabId: string, executionMs: number) => void;
  clearTab: (tabId: string) => void;
}

export const useResultsStore = create<ResultsState>((set) => ({
  byTab: {},
  startRun: (tabId) =>
    set((s) => ({
      byTab: {
        ...s.byTab,
        [tabId]: { groups: [], isRunning: true, executionMs: undefined, lastError: undefined },
      },
    })),
  appendGroup: (tabId, group) =>
    set((s) => {
      const cur = s.byTab[tabId] ?? { groups: [], isRunning: true };
      return { byTab: { ...s.byTab, [tabId]: { ...cur, groups: [...cur.groups, group] } } };
    }),
  setError: (tabId, error) =>
    set((s) => {
      const cur = s.byTab[tabId] ?? { groups: [], isRunning: true };
      return { byTab: { ...s.byTab, [tabId]: { ...cur, lastError: error } } };
    }),
  finishRun: (tabId, executionMs) =>
    set((s) => {
      const cur = s.byTab[tabId] ?? { groups: [], isRunning: true };
      return { byTab: { ...s.byTab, [tabId]: { ...cur, isRunning: false, executionMs } } };
    }),
  clearTab: (tabId) =>
    set((s) => {
      const { [tabId]: _, ...rest } = s.byTab;
      return { byTab: rest };
    }),
}));
