import { PermissionBroker } from './PermissionBroker';

export interface HostBackend {
  dbFind(args: { coll: string; filter: unknown; opts?: unknown }): Promise<unknown[]>;
  netFetch(url: string, init?: unknown): Promise<{ status: number; body?: unknown }>;
}

export interface HostServices {
  db:  { find(coll: string, filter: unknown, opts?: unknown): Promise<unknown[]> };
  net: { fetch(url: string, init?: unknown): Promise<{ status: number; body?: unknown }> };
}

export function createHostServices(params: {
  broker: PermissionBroker;
  pluginId: string;
  backend: HostBackend;
}): HostServices {
  const { broker, pluginId, backend } = params;
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
  };
}
