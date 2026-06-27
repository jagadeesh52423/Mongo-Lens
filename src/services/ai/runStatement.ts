import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { runScript } from '../../ipc';
import type { ScriptEvent, QueryCategory } from '../../types';

const DEFAULT_TAB_ID = '__ai_agent__';
const TIMEOUT_MS = 30_000;
const DEFAULT_MAX_DOCS = 20;

export interface StatementGroup {
  docs: unknown[];
  collection?: string;
  category?: QueryCategory;
  truncated?: boolean;
}
export interface StatementResult { groups: StatementGroup[]; }

export interface RunStatementOptions { tabId?: string; maxDocsPerGroup?: number; }

/**
 * Run a single Mongo statement via the existing script path and collect its
 * result groups (one-shot scoped script-event listener on a synthetic tab).
 * Docs per group are capped so results fed back to a model stay bounded.
 */
export async function runStatement(
  connectionId: string,
  database: string,
  statement: string,
  opts: RunStatementOptions = {},
): Promise<StatementResult> {
  const cap = opts.maxDocsPerGroup ?? DEFAULT_MAX_DOCS;
  const runId =
    globalThis.crypto?.randomUUID?.() ?? `stmt-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  // Default the backend tab id to a per-run unique value so concurrent agent
  // runs (different editor tabs) never alias the run_script cancel key and
  // cancel each other. These paths never call cancelScript, so uniqueness is free.
  const tabId = opts.tabId ?? `${DEFAULT_TAB_ID}-${runId}`;

  const groups: StatementGroup[] = [];
  let settleResolve!: (v: StatementResult) => void;
  let settleReject!: (e: Error) => void;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = new Promise<StatementResult>((res, rej) => { settleResolve = res; settleReject = rej; });
  const finish = (fn: () => void) => { if (finished) return; finished = true; if (timer) clearTimeout(timer); fn(); };
  timer = setTimeout(() => finish(() => settleReject(new Error('Statement timed out'))), TIMEOUT_MS);

  let unsub: UnlistenFn | null = null;
  unsub = await listen<ScriptEvent>('script-event', (e) => {
    const p = e.payload;
    if (p.tabId !== tabId || p.runId !== runId) return;
    if (p.kind === 'group' && p.docs !== undefined) {
      const docs = Array.isArray(p.docs) ? p.docs : [p.docs];
      const truncated = docs.length > cap;
      groups.push({ docs: docs.slice(0, cap), collection: p.collection, category: p.category, truncated });
    } else if (p.kind === 'error') {
      finish(() => settleReject(new Error(p.error || 'Statement failed')));
    } else if (p.kind === 'done') {
      finish(() => settleResolve({ groups }));
    }
  });

  try {
    await runScript(tabId, connectionId, database, statement, 0, cap + 1, runId);
    return await result;
  } catch (err) {
    finish(() => settleReject(err instanceof Error ? err : new Error(String(err))));
    return await result;
  } finally {
    unsub?.();
  }
}
