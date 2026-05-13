export interface WorkspaceStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export class InMemoryWorkspaceStore implements WorkspaceStore {
  private map = new Map<string, string>();
  async get(k: string) { return this.map.get(k); }
  async set(k: string, v: string) { this.map.set(k, v); }
  async delete(k: string) { this.map.delete(k); }
  async keys() { return [...this.map.keys()]; }
}

export function namespaceFor(pluginId: string, key: string): string {
  return `plugin:${pluginId}:${key}`;
}
