import { runStatement } from './runStatement';

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
 * plan doc. Delegates to runStatement with a dedicated tab so explain runs stay
 * out of the editor results panel.
 */
export async function runExplain(
  connectionId: string,
  database: string,
  snippet: string,
): Promise<unknown> {
  const expr = snippet.trim().replace(/;+\s*$/, '');
  // Prepend `await` explicitly. The harness only auto-awaits lines starting with
  // `db.`; wrapping in parens (or bracket-notation snippets) would skip that, so
  // the .explain() promise wouldn't be awaited and the run would finish before
  // the plan group is emitted ("Explain returned no plan").
  const script = `await ${expr}.explain('executionStats')`;
  const res = await runStatement(connectionId, database, script, {
    tabId: '__ai_explain__',
    maxDocsPerGroup: 1,
  });
  const plan = res.groups[0]?.docs?.[0];
  if (plan === undefined) throw new Error('Explain returned no plan');
  return plan;
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
