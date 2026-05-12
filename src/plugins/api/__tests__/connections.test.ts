import { describe, it, expect, vi } from 'vitest';
import { createHostServices, type HostBackend } from '../../hostServices';
import { PermissionBroker, PermissionDeniedError } from '../../PermissionBroker';
import { InMemorySecretStorage } from '../secretStorage';
import { InMemoryWorkspaceStore } from '../workspaceStore';

function makeBackend(overrides: Partial<HostBackend> = {}): HostBackend {
  return {
    dbFind: vi.fn(async () => []),
    netFetch: vi.fn(async () => ({ status: 200 })),
    connectionsList: vi.fn(async () => [
      { id: '1', name: 'staging', host: 'h', port: 27017, username: 'u' },
    ]),
    connectionsUpdateCredentials: vi.fn(async () => {}),
    ...overrides,
  };
}

function setup(grants: string[] = ['connections:write']) {
  const broker = new PermissionBroker();
  broker.setGrants('datafleet', grants.map(g => ({ kind: g as never })));
  const audit = vi.fn();
  const backend = makeBackend();
  const services = createHostServices({
    broker, pluginId: 'datafleet', backend,
    secrets: new InMemorySecretStorage(),
    workspace: new InMemoryWorkspaceStore(),
    audit,
  });
  return { services, backend, audit };
}

describe('connections API', () => {
  it('list returns refs', async () => {
    const { services } = setup();
    const refs = await services.connections.list();
    expect(refs).toEqual([{ id: '1', name: 'staging', host: 'h', port: 27017, username: 'u' }]);
  });

  it('list requires connections:write', async () => {
    const { services } = setup([]); // no grants
    await expect(services.connections.list()).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('updateCredentials calls backend and emits audit', async () => {
    const { services, backend, audit } = setup();
    await services.connections.updateCredentials('1', { password: 'pw' });
    expect(backend.connectionsUpdateCredentials).toHaveBeenCalledWith('1', 'pw');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      pluginId: 'datafleet',
      action: 'connections.updateCredentials',
      target: '1',
    }));
  });

  it('updateCredentials rejects empty password', async () => {
    const { services } = setup();
    await expect(services.connections.updateCredentials('1', { password: '' }))
      .rejects.toThrow(/non-empty/);
  });

  it('updateCredentials requires connections:write', async () => {
    const { services } = setup([]);
    await expect(services.connections.updateCredentials('1', { password: 'pw' }))
      .rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
