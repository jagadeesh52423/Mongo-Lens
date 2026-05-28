import { useConnectionsV2 } from '../../components/features/connections/useConnectionsV2';
import { useEditorStore } from '../../store/editor';
import { useResultsStore } from '../../store/results';

/**
 * Number of result documents included in the context preview.
 * Kept small to stay within the prompt token budget.
 */
const RESULTS_PREVIEW_LIMIT = 5;

/**
 * Implement this interface to add a new context source to the AI system prompt
 * (e.g. git history, performance metrics, cluster topology).
 *
 * The collector runs on every message send, so keep `collect()` cheap.
 * Return an empty string to omit this section from the prompt entirely.
 */
export interface ContextCollectorInterface {
  collect(): Promise<string>;
}

/**
 * Collects the user's currently highlighted text in the active tab's editor,
 * if any. Emits a `Selected portion (lines X–Y):` block followed by a fenced
 * code block holding the literal selected text. When the selection is
 * absent, empty, or whitespace-only, returns '' so the prompt stays
 * byte-identical to the no-selection case.
 *
 * TODO (option 3 — selected query's result): once the harness emits source
 * ranges per result group (see TEST_REPORT.md "Harness investigation"),
 * introduce a `QueryResultLocator` strategy that maps a selection range to
 * the matching result group and surfaces that preview here or in a sibling
 * collector. The strategy interface is the extension point — new locators
 * (e.g. AST-based, line-overlap) register themselves; existing collectors
 * stay closed for modification.
 */
export class SelectionContextCollector implements ContextCollectorInterface {
  async collect(): Promise<string> {
    const { activeTabId, selections } = useEditorStore.getState();
    if (!activeTabId) return '';
    const sel = selections[activeTabId];
    if (!sel || !sel.text.trim()) return '';
    return `Selected portion (lines ${sel.startLine}–${sel.endLine}):\n\`\`\`\n${sel.text}\n\`\`\``;
  }
}

/** Collects the active tab's editor content. */
export class EditorContextCollector implements ContextCollectorInterface {
  async collect(): Promise<string> {
    const { tabs, activeTabId } = useEditorStore.getState();
    const activeTab = tabs.find((t) => t.id === activeTabId);
    const content = activeTab?.content?.trim();
    if (!content) return '';
    return `Editor Content:\n\`\`\`\n${content}\n\`\`\``;
  }
}

/**
 * Collects a preview of the active tab's query results.
 * Reads the first group (the common case) and includes up to
 * RESULTS_PREVIEW_LIMIT documents.
 */
export class ResultsContextCollector implements ContextCollectorInterface {
  async collect(): Promise<string> {
    const { activeTabId } = useEditorStore.getState();
    if (!activeTabId) return '';

    const tabResults = useResultsStore.getState().byTab[activeTabId];
    const docs = tabResults?.groups?.[0]?.docs;
    if (!docs || docs.length === 0) return '';

    const preview = docs.slice(0, RESULTS_PREVIEW_LIMIT);
    return `Query Results (first ${preview.length} of ${docs.length} documents):\n\`\`\`json\n${safeStringify(preview)}\n\`\`\``;
  }
}

/** Collects active connection name + database + (optional) collection. */
export class ConnectionContextCollector implements ContextCollectorInterface {
  async collect(): Promise<string> {
    const { tabs, activeTabId } = useEditorStore.getState();
    const { connections, activeConnectionId, activeDatabase } = useConnectionsV2.getState();

    const activeTab = tabs.find((t) => t.id === activeTabId);

    // Tab-specific values override the globally active ones when available.
    const connectionId = activeTab?.connectionId ?? activeConnectionId;
    const database = activeTab?.database ?? activeDatabase;
    const collection = activeTab?.collection;

    if (!connectionId && !database) return '';

    const connection = connections.find((c) => c.id === connectionId);
    const lines: string[] = ['Current Context:'];
    if (connection?.name) lines.push(`- Connection: ${connection.name}`);
    if (database) lines.push(`- Database: ${database}`);
    if (collection) lines.push(`- Collection: ${collection}`);
    return lines.join('\n');
  }
}

/**
 * Infers a shallow schema from the first result document
 * (field name + inferred type). Best-effort — the model gets the
 * structure, not a guarantee of correctness across all docs.
 */
export class SchemaContextCollector implements ContextCollectorInterface {
  async collect(): Promise<string> {
    const { activeTabId } = useEditorStore.getState();
    if (!activeTabId) return '';

    const tabResults = useResultsStore.getState().byTab[activeTabId];
    const first = tabResults?.groups?.[0]?.docs?.[0];
    if (!first || typeof first !== 'object') return '';

    const lines = Object.entries(first as Record<string, unknown>).map(
      ([key, value]) => `- ${key}: ${inferType(value)}`,
    );
    if (lines.length === 0) return '';
    return `Schema (inferred from first result):\n${lines.join('\n')}`;
  }
}

/**
 * Orchestrates a set of ContextCollectorInterface instances. Runs them in
 * parallel and joins non-empty sections into a single context block suitable
 * for embedding in a system prompt.
 */
export class ContextCollector {
  private readonly collectors: ContextCollectorInterface[];

  constructor(collectors?: ContextCollectorInterface[]) {
    this.collectors = collectors ?? [
      new ConnectionContextCollector(),
      new EditorContextCollector(),
      new SelectionContextCollector(),
      new ResultsContextCollector(),
      new SchemaContextCollector(),
    ];
  }

  /** Runs every registered collector in parallel and joins the non-empty parts. */
  async collectAll(): Promise<string> {
    const parts = await Promise.all(
      this.collectors.map((c) =>
        c.collect().catch((err) => {
          // One misbehaving collector must not block the others.
          console.warn('AI context collector failed', err);
          return '';
        }),
      ),
    );
    return parts.map((p) => p.trim()).filter((p) => p.length > 0).join('\n\n');
  }
}

/** Best-effort JSON stringify that survives BSON-ish values (ObjectId, Date). */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, jsonReplacer, 2);
  } catch {
    return String(value);
  }
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  // BigInt is not JSON-serializable by default; downcast to string for the prompt.
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function inferType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'Date';
  const t = typeof value;
  if (t === 'object') {
    // Common BSON-ish hint: plain objects with $oid look like ObjectIds.
    const obj = value as Record<string, unknown>;
    if ('$oid' in obj) return 'ObjectId';
    if ('$date' in obj) return 'Date';
    return 'object';
  }
  return t;
}
