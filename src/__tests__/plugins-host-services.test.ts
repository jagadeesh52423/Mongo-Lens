import { createHostServices } from '../plugins/hostServices';
import { PermissionBroker, PermissionDeniedError } from '../plugins/PermissionBroker';
import { parseScope } from '../plugins/permissions';
import { InMemorySecretStorage } from '../plugins/api/secretStorage';
import { InMemoryWorkspaceStore } from '../plugins/api/workspaceStore';

function makeBackend() {
  return {
    dbFind: vi.fn(),
    netFetch: vi.fn(),
    connectionsList: vi.fn(async () => []),
    connectionsUpdateCredentials: vi.fn(async () => {}),
  };
}

describe('hostServices.db.find', () => {
  it('is denied without database:read', async () => {
    const broker = new PermissionBroker();
    broker.setGrants('p1', []);
    const svc = createHostServices({
      broker,
      pluginId: 'p1',
      backend: makeBackend(),
      secrets: new InMemorySecretStorage(),
      workspace: new InMemoryWorkspaceStore(),
    });
    await expect(svc.db.find('coll', {})).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('is allowed and forwards to backend with database:read', async () => {
    const backend = makeBackend();
    backend.dbFind.mockResolvedValue([{ x: 1 }]);
    const broker = new PermissionBroker();
    broker.setGrants('p1', [parseScope('database:read')]);
    const svc = createHostServices({
      broker, pluginId: 'p1',
      backend,
      secrets: new InMemorySecretStorage(),
      workspace: new InMemoryWorkspaceStore(),
    });
    await expect(svc.db.find('coll', { a: 1 })).resolves.toEqual([{ x: 1 }]);
    expect(backend.dbFind).toHaveBeenCalledWith({ coll: 'coll', filter: { a: 1 }, opts: undefined });
  });

  it('net.fetch checks scope against URL', async () => {
    const broker = new PermissionBroker();
    broker.setGrants('p1', [parseScope('network:fetch:https://*.acme.com')]);
    const backend = makeBackend();
    backend.netFetch.mockResolvedValue({ status: 200 });
    const svc = createHostServices({
      broker, pluginId: 'p1',
      backend,
      secrets: new InMemorySecretStorage(),
      workspace: new InMemoryWorkspaceStore(),
    });
    await expect(svc.net.fetch('https://api.acme.com/v1')).resolves.toEqual({ status: 200 });
    await expect(svc.net.fetch('https://evil.com/')).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
