import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { runScript } from '../../ipc';
import type { ScriptEvent } from '../../types';

/**
 * Dedicated tab id for AI explain runs. The global useScriptEvents listener
 * keys results by `byTab[tabId].runId`; this tab has no results entry, so its
 * runId never matches and those events are ignored there — keeping explain runs
 * out of the editor results panel.
 */
const EXPLAIN_TAB_ID = '__ai_explain__';
const EXPLAIN_TIMEOUT_MS = 30_000;

export interface ExplainSummary {
  stage: string;
  indexName: string | null;
  nReturned: number | null;
  docsExamined: number | null;
  executionMs: number | null;
}

/** True when a snippet looks like a find/aggregate we can wrap in .explain(). */
export function isExplainable(code: string): boolean {
  return /\bdb\b[\s\S]*\.\s*(find|aggregate)\s*\(/.test(code);
}

/**
 * Run `(<snippet>).explain('executionStats')` through the existing script path
 * (the harness cursor proxy emits the plan as a group) and resolve with the raw
 * plan doc. One-shot: attaches a scoped script-event listener, fires the run,
 * resolves on `done`, rejects on `error`/timeout, and always unsubscribes.
 */
export async function runExplain(
  connectionId: string,
  database: string,
  snippet: string,
): Promise<unknown> {
  const runId =
    globalThis.crypto?.randomUUID?.() ?? `explain-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const expr = snippet.trim().replace(/;+\s*$/, '');
  const script = `(${expr}).explain('executionStats')`;

  let settleResolve!: (v: unknown) => void;
  let settleReject!: (e: Error) => void;
  let plan: unknown;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const result = new Promise<unknown>((resolve, reject) => {
    settleResolve = resolve;
    settleReject = reject;
  });
  const finish = (fn: () => void) => {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    fn();
  };

  timer = setTimeout(() => finish(() => settleReject(new Error('Explain timed out'))), EXPLAIN_TIMEOUT_MS);

  let unsub: UnlistenFn | null = null;
  unsub = await listen<ScriptEvent>('script-event', (e) => {
    const p = e.payload;
    if (p.tabId !== EXPLAIN_TAB_ID || p.runId !== runId) return;
    if (p.kind === 'group' && p.docs !== undefined) {
      plan = Array.isArray(p.docs) ? p.docs[0] : p.docs;
    } else if (p.kind === 'error') {
      finish(() => settleReject(new Error(p.error || 'Explain failed')));
    } else if (p.kind === 'done') {
      finish(() =>
        plan !== undefined
          ? settleResolve(plan)
          : settleReject(new Error('Explain returned no plan')),
      );
    }
  });

  try {
    await runScript(EXPLAIN_TAB_ID, connectionId, database, script, 0, 1, runId);
    return await result;
  } catch (err) {
    finish(() => settleReject(err instanceof Error ? err : new Error(String(err))));
    return await result;
  } finally {
    unsub?.();
  }
}

/** Recursively find the first indexName in a winning-plan tree. */
function findIndexName(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  if (typeof obj.indexName === 'string') return obj.indexName;
  for (const key of ['inputStage', 'inputStages']) {
    const child = obj[key];
    if (Array.isArray(child)) {
      for (const s of child) {
        const found = findIndexName(s);
        if (found) return found;
      }
    } else if (child) {
      const found = findIndexName(child);
      if (found) return found;
    }
  }
  return null;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

/** Reduce a (find or aggregate) explain doc to a compact, displayable summary. */
export function summarizeExplain(plan: unknown): ExplainSummary {
  const root = (plan ?? {}) as Record<string, unknown>;
  // Aggregate explains nest the planner under stages[0].$cursor.
  const stages = root.stages as Array<Record<string, unknown>> | undefined;
  const cursor = stages?.[0]?.$cursor as Record<string, unknown> | undefined;
  const qp = (root.queryPlanner ?? cursor?.queryPlanner) as Record<string, unknown> | undefined;
  const es = (root.executionStats ?? cursor?.executionStats) as Record<string, unknown> | undefined;

  const winning = qp?.winningPlan as Record<string, unknown> | undefined;
  const stage =
    (winning?.stage as string | undefined) ??
    ((winning?.inputStage as Record<string, unknown> | undefined)?.stage as string | undefined) ??
    'unknown';

  return {
    stage,
    indexName: findIndexName(winning),
    nReturned: asNumber(es?.nReturned),
    docsExamined: asNumber(es?.totalDocsExamined),
    executionMs: asNumber(es?.executionTimeMillis),
  };
}

/** One-line human summary, e.g. `Plan: index "email_1" · returned 5 · examined 5 · 1ms`. */
export function formatExplainSummary(s: ExplainSummary): string {
  const plan = s.indexName
    ? `index "${s.indexName}"`
    : s.stage.includes('COLLSCAN')
      ? 'COLLSCAN (no index)'
      : s.stage;
  const parts = [`Plan: ${plan}`];
  if (s.nReturned !== null) parts.push(`returned ${s.nReturned}`);
  if (s.docsExamined !== null) parts.push(`examined ${s.docsExamined}`);
  if (s.executionMs !== null) parts.push(`${s.executionMs}ms`);
  return parts.join(' · ');
}
