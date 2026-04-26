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
  tags: string;
  connectionId?: string;
  lastRunAt?: string;
  createdAt: string;
}

export interface EditorTab {
  id: string;
  title: string;
  content: string;
  isDirty: boolean;
  type: 'script';
  connectionId?: string;
  database?: string;
  collection?: string;
  savedScriptId?: string;
  savedScriptTags?: string;
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

export interface PaginationState {
  total: number;   // -1 means count unavailable
  page: number;    // 0-indexed
  pageSize: number;
}

export interface ScriptEvent {
  tabId: string;
  kind: 'group' | 'error' | 'done' | 'pagination';
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
}
