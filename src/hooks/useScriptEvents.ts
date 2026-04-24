import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useResultsStore } from '../store/results';
import type { ScriptEvent } from '../types';
import { useLogger } from '../services/logger';

export function useScriptEvents() {
  const log = useLogger('hooks.useScriptEvents');
  const { appendGroup, setError, finishRun, setPagination } = useResultsStore();

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;
    listen<ScriptEvent>('script-event', (e) => {
      const p = e.payload;
      const currentRunId = useResultsStore.getState().byTab[p.tabId]?.runId;
      if (p.runId && p.runId !== currentRunId) return;

      const child = log.child({ runId: p.runId, tabId: p.tabId });
      child.debug('script-event', { kind: p.kind, error: p.error });
      if (p.kind === 'group' && p.groupIndex !== undefined && p.docs !== undefined) {
        appendGroup(p.tabId, {
          groupIndex: p.groupIndex,
          docs: Array.isArray(p.docs) ? p.docs : [p.docs],
          collection: p.collection,
          category: p.category,
        });
      } else if (p.kind === 'pagination' && p.pagination) {
        setPagination(p.tabId, p.pagination);
      } else if (p.kind === 'error' && p.error) {
        setError(p.tabId, p.error);
      } else if (p.kind === 'done') {
        finishRun(p.tabId, p.executionMs ?? 0);
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unsub = fn;
      }
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [appendGroup, setError, finishRun, setPagination, log]);
}
