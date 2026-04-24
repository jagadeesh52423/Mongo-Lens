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
}

export interface QueryClassification {
  category: QueryCategory | null;
  collection: string | null;
}

export const DEFAULT_OPERATIONS: readonly OperationDef[];

export function classify(
  script: string,
  operations?: readonly OperationDef[],
): QueryClassification;

export function splitStatements(script: string): string[];
