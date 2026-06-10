// TypeScript surface for runner/query-classifier.js — the shared CommonJS
// module consumed by both the runner harness and the TS QueryTypeRegistry.
// Keep declarations aligned with the exports in query-classifier.js.

export type QueryCategory =
  | 'query'
  | 'mutation'
  | 'transform'
  | 'maintenance'
  | 'stream';

export interface OperationDef {
  pattern: RegExp;
  category: QueryCategory;
  /** Operation method name; drives both dot- and bracket-notation matching. */
  name?: string;
}

export interface QueryClassification {
  category: QueryCategory | null;
  collection: string | null;
}

export const DEFAULT_OPERATIONS: readonly OperationDef[];

/** Categories whose operations write or structurally alter data. */
export const DESTRUCTIVE_CATEGORIES: ReadonlySet<QueryCategory>;

export function classify(
  script: string,
  operations?: readonly OperationDef[],
): QueryClassification;

/**
 * Fail-safe destructiveness check. Unclassifiable input (null/undefined
 * category) is treated as destructive — aliased/dynamic ops the static
 * classifier cannot recognize must not be assumed safe.
 */
export function isPotentiallyDestructive(
  value: QueryCategory | QueryClassification | null | undefined,
): boolean;

export function splitStatements(script: string): string[];
