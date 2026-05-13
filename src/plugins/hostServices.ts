import { PermissionBroker } from './PermissionBroker';
import { SecretStorage, namespaceFor as nsSecret } from './api/secretStorage';
import { WorkspaceStore, namespaceFor as nsWorkspace } from './api/workspaceStore';
import { ConnectionRef } from './api/contracts';

export interface HostBackend {
  dbFind(args: { coll: string; filter: unknown; opts?: unknown }): Promise<unknown[]>;
  netFetch(url: string, init?: unknown): Promise<{ status: number; body?: unknown }>;
  connectionsList(): Promise<ConnectionRef[]>;
  connectionsUpdateCredentials(id: string, password: string): Promise<void>;
}

export interface AuditEvent {
  pluginId: string;
  action: string;
  target?: string;
  meta?: Record<string, unknown>;
  at: string;
}

export type AuditSink = (event: AuditEvent) => void;

export interface HostServices {
  db:          { find(coll: string, filter: unknown, opts?: unknown): Promise<unknown[]> };
  net:         { fetch(url: string, init?: unknown): Promise<{ status: number; body?: unknown }> };
  connections: { list(): Promise<ConnectionRef[]>; updateCredentials(id: string, creds: { password: string }): Promise<void> };
  secrets:     { get(k: string): Promise<string | undefined>; store(k: string, v: string): Promise<void>; delete(k: string): Promise<void> };
  workspace:   { get(k: string): Promise<string | undefined>; set(k: string, v: string): Promise<void>; delete(k: string): Promise<void>; keys(): Promise<string[]> };
}

export function createHostServices(params: {
  broker: PermissionBroker;
  pluginId: string;
  backend: HostBackend;
  secrets: SecretStorage;
  workspace: WorkspaceStore;
  audit?: AuditSink;
}): HostServices {
  const { broker, pluginId, backend, secrets, workspace, audit } = params;
  const now = () => new Date().toISOString();
  return {
    db: {
      async find(coll, filter, opts) {
        broker.check(pluginId, { kind: 'database:read' });
        return backend.dbFind({ coll, filter, opts });
      },
    },
    net: {
      async fetch(url, init) {
        broker.check(pluginId, { kind: 'network:fetch', arg: url });
        return backend.netFetch(url, init);
      },
    },
    connections: {
      async list() {
        broker.check(pluginId, { kind: 'connections:write' });
        return backend.connectionsList();
      },
      async updateCredentials(id, { password }) {
        broker.check(pluginId, { kind: 'connections:write' });
        if (typeof password !== 'string' || password.length === 0) {
          throw new TypeError('updateCredentials requires a non-empty password');
        }
        await backend.connectionsUpdateCredentials(id, password);
        audit?.({ pluginId, action: 'connections.updateCredentials', target: id, at: now() });
      },
    },
    secrets: {
      async get(k)        { broker.check(pluginId, { kind: 'secrets:read'  }); return secrets.get(nsSecret(pluginId, k)); },
      async store(k, v)   { broker.check(pluginId, { kind: 'secrets:write' }); return secrets.store(nsSecret(pluginId, k), v); },
      async delete(k)     { broker.check(pluginId, { kind: 'secrets:write' }); return secrets.delete(nsSecret(pluginId, k)); },
    },
    workspace: {
      async get(k)        { broker.check(pluginId, { kind: 'workspace:read'  }); return workspace.get(nsWorkspace(pluginId, k)); },
      async set(k, v)     { broker.check(pluginId, { kind: 'workspace:write' }); return workspace.set(nsWorkspace(pluginId, k), v); },
      async delete(k)     { broker.check(pluginId, { kind: 'workspace:write' }); return workspace.delete(nsWorkspace(pluginId, k)); },
      async keys() {
        broker.check(pluginId, { kind: 'workspace:read' });
        const prefix = nsWorkspace(pluginId, '');
        return (await workspace.keys()).filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length));
      },
    },
  };
}
