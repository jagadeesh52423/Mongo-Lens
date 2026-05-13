import { describe, it, expect, vi } from 'vitest';
import { createHostServices, type HostBackend } from '../../hostServices';
import { PermissionBroker, PermissionDeniedError } from '../../PermissionBroker';
import { InMemorySecretStorage } from '../secretStorage';
import { InMemoryWorkspaceStore } from '../workspaceStore';

function setup(grants: Array<{kind: string}>) {
  const broker = new PermissionBroker();
  broker.setGrants('p1', grants as never);
  const backend: HostBackend = {
    dbFind: vi.fn(async () => []),
    netFetch: vi.fn(async () => ({ status: 200 })),
    connectionsList: vi.fn(async () => []),
    connectionsUpdateCredentials: vi.fn(async () => {}),
  };
  const secrets = new InMemorySecretStorage();
  const workspace = new InMemoryWorkspaceStore();
  return {
    services: createHostServices({ broker, pluginId: 'p1', backend, secrets, workspace }),
    secrets, workspace,
  };
}

describe('secrets API', () => {
  it('namespaces keys under plugin:<id>:', async () => {
    const { services, secrets } = setup([{kind:'secrets:read'},{kind:'secrets:write'}]);
    await services.secrets.store('k', 'v');
    expect(await secrets.get('plugin:p1:k')).toBe('v');
    expect(await services.secrets.get('k')).toBe('v');
  });

  it('store requires secrets:write', async () => {
    const { services } = setup([{kind:'secrets:read'}]);
    await expect(services.secrets.store('k', 'v')).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe('workspace API', () => {
  it('namespaces keys and returns un-prefixed keys()', async () => {
    const { services, workspace } = setup([{kind:'workspace:read'},{kind:'workspace:write'}]);
    await services.workspace.set('a', '1');
    await services.workspace.set('b', '2');
    expect(await workspace.get('plugin:p1:a')).toBe('1');
    expect((await services.workspace.keys()).sort()).toEqual(['a', 'b']);
  });

  it('keys() does not see other plugins\' data', async () => {
    const { workspace } = setup([{kind:'workspace:read'},{kind:'workspace:write'}]);
    await workspace.set('plugin:other:x', '1');
    // Build a fresh services for p1 sharing the same workspace store
    const broker = new PermissionBroker();
    broker.setGrants('p1', [{kind:'workspace:read'},{kind:'workspace:write'}] as never);
    const backend: HostBackend = {
      dbFind: vi.fn(), netFetch: vi.fn(),
      connectionsList: vi.fn(async () => []),
      connectionsUpdateCredentials: vi.fn(async () => {}),
    };
    const s = createHostServices({
      broker, pluginId: 'p1', backend,
      secrets: new InMemorySecretStorage(), workspace,
    });
    expect(await s.workspace.keys()).toEqual([]);
  });

  it('set requires workspace:write', async () => {
    const { services } = setup([{kind:'workspace:read'}]);
    await expect(services.workspace.set('k', 'v')).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
