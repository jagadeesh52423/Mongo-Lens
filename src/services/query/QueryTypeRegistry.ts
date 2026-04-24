/**
 * QueryTypeRegistry — classifies MongoDB script statements and extracts the
 * target collection.
 *
 * The registry is the single source of truth for "what kind of operation is
 * this and what collection does it target". Consumers (runner harness,
 * ResultsPanel) use the resulting `{ category, collection }` to decide whether
 * record-level actions (e.g., F4 Edit Record) apply.
 *
 * Implementation: classification logic lives in `runner/query-classifier.js`
 * — a CommonJS module shared by the runner harness and this TS wrapper, so
 * there is exactly one copy of DEFAULT_OPERATIONS, `classify`, and
 * `splitStatements`. The class API below exists to let UI consumers register
 * additional operations at runtime without touching the shared defaults.
 *
 * Extensibility contract: implement a new `OperationDef` (regex + category) and
 * call `register()` to add it. No other changes are required for `classify()`
 * to pick it up.
 */

import * as classifier from '../../../runner/query-classifier';

// QueryCategory is the shared authoritative type — both the classifier and
// consumer code (ResultGroup, RecordContext) must agree on the set of
// categories, so the union lives in `../../types` and is re-exported here for
// convenient import by callers that already depend on this module.
import type { QueryCategory } from '../../types';
export type { QueryCategory };

export interface OperationDef {
  /**
   * Regex that matches the operation invocation in cleaned script text.
   * The match index is used as the operation's position — collection context
   * is extracted from the text immediately preceding the match.
   */
  pattern: RegExp;
  category: QueryCategory;
}

export interface QueryClassification {
  category: QueryCategory | null;
  collection: string | null;
}

/** Built-in MongoDB operations. See `runner/query-classifier.js` for the source list. */
export const DEFAULT_OPERATIONS: readonly OperationDef[] =
  classifier.DEFAULT_OPERATIONS as readonly OperationDef[];

/** Split a script into top-level statements (by `;`, respecting strings/comments/nesting). */
export function splitStatements(script: string): string[] {
  return classifier.splitStatements(script);
}

export class QueryTypeRegistry {
  private readonly operations: OperationDef[] = [];

  constructor(operations: readonly OperationDef[] = DEFAULT_OPERATIONS) {
    for (const op of operations) this.register(op);
  }

  /**
   * Register a new operation. Implement `OperationDef` with a regex that
   * matches the operation call site; category determines F4 editability.
   */
  register(op: OperationDef): void {
    this.operations.push(op);
  }

  /**
   * Classify a script (or single statement). Returns the earliest matched
   * operation's category and the statically resolvable collection name (or
   * null when the target is dynamic or missing).
   *
   * A match is only considered when the operation call is on a `db.*`
   * expression — pure JS calls like `arr.find(...)` do not classify.
   */
  classify(script: string): QueryClassification {
    return classifier.classify(script, this.operations);
  }
}

/** Module-level singleton shared by runner and UI consumers. */
export const queryTypeRegistry = new QueryTypeRegistry();
