export interface Connection {
  id: string;
  name: string;
  host?: string;
  port?: number;
  authDb?: string;
  username?: string;
  connString?: string;
  sshHost?: string;
  sshPort?: number;
  sshUser?: string;
  sshKeyPath?: string;
  createdAt: string;
}

export interface ConnectionInput {
  name: string;
  host?: string;
  port?: number;
  authDb?: string;
  username?: string;
  password?: string;
  connString?: string;
  sshHost?: string;
  sshPort?: number;
  sshUser?: string;
  sshKeyPath?: string;
}

export interface SavedScript {
  id: string;
  name: string;
  content: string;
  tags: string[];
  connectionId?: string;
  lastRunAt?: string;
  createdAt: string;
}

/**
 * Active text selection within a script tab. `text` is the raw selected
 * string (not trimmed); `startLine` and `endLine` are 1-based Monaco line
 * numbers covering the selection.
 */
export interface EditorSelection {
  text: string;
  startLine: number;
  endLine: number;
}

export interface EditorTab {
  id: string;
  title: string;
  content: string;
  isDirty: boolean;
  type: 'script' | 'schema';
  connectionId?: string;
  database?: string;
  collection?: string;
  savedScriptId?: string;
  savedScriptTags?: string[];
}

/** One BSON type a field exhibits, from mongodb-schema. */
export interface SchemaType {
  name: string;                 // 'String' | 'Number' | 'ObjectId' | 'Document' | 'Array' | ...
  path: string;
  count: number;
  probability: number;          // 0..1 share of this type within the field
  values?: unknown[];           // sample values (primitive types)
  fields?: SchemaField[];       // present when name === 'Document'
  types?: SchemaType[];         // present when name === 'Array' (element types)
  averageLength?: number;       // present when name === 'Array'
}

export interface SchemaField {
  name: string;
  path: string;
  count: number;
  probability: number;          // 0..1 presence across sampled docs
  type: string | string[];
  types: SchemaType[];
}

export interface SchemaResult {
  schema: { count: number; fields: SchemaField[] };
  sampled: number;              // docs actually sampled
  sampleSize: number;           // requested $sample size
}

export type QueryCategory =
  | 'query'
  | 'mutation'
  | 'transform'
  | 'maintenance'
  | 'stream';

export interface ResultGroup {
  groupIndex: number;
  docs: unknown[];
  error?: string;
  /** Target collection resolved from the statement that produced this group, if statically extractable. */
  collection?: string;
  /** Operation category resolved from the statement that produced this group. */
  category?: QueryCategory;
}

export interface ExecutionResult {
  groups: ResultGroup[];
  executionMs: number;
}

export interface DbNode {
  name: string;
  collections: CollectionNode[];
}

export interface CollectionNode {
  name: string;
  indexes?: IndexInfo[];
}

export interface IndexInfo {
  name: string;
  keys: Record<string, number>;
}

export interface BrowsePage {
  docs: unknown[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PaginationState {
  total: number;   // -1 means count unavailable
  page: number;    // 0-indexed
  pageSize: number;
}

export interface ScriptEvent {
  tabId: string;
  kind: 'group' | 'error' | 'done' | 'pagination' | 'log';
  groupIndex?: number;
  docs?: unknown[];
  error?: string;
  executionMs?: number;
  pagination?: PaginationState;
  runId?: string;
  /** Target collection resolved by the runner for this group's statement. */
  collection?: string;
  /** Operation category resolved by the runner for this group's statement. */
  category?: QueryCategory;
  /** Single line of script-emitted log output (print() in user scripts). */
  log?: string;
}
