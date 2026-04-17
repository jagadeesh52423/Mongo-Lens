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
  type: 'script' | 'browse';
  connectionId?: string;
  database?: string;
  collection?: string;
}

export interface ResultGroup {
  groupIndex: number;
  docs: unknown[];
  error?: string;
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

export interface ScriptEvent {
  tabId: string;
  kind: 'group' | 'error' | 'done';
  groupIndex?: number;
  docs?: unknown[];
  error?: string;
  executionMs?: number;
}
