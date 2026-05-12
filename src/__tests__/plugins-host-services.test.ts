import { createHostServices } from '../plugins/hostServices';
import { PermissionBroker, PermissionDeniedError } from '../plugins/PermissionBroker';
import { parseScope } from '../plugins/permissions';

describe('hostServices.db.find', () => {
  it('is denied without database:read', async () => {
    const broker = new PermissionBroker();
    broker.setGrants('p1', []);
    const svc = createHostServices({
      broker,
      pluginId: 'p1',
      backend: { dbFind: vi.fn(), netFetch: vi.fn() },
    });
    await expect(svc.db.find('coll', {})).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('is allowed and forwards to backend with database:read', async () => {
    const dbFind = vi.fn().mockResolvedValue([{ x: 1 }]);
    const broker = new PermissionBroker();
    broker.setGrants('p1', [parseScope('database:read')]);
    const svc = createHostServices({
      broker, pluginId: 'p1',
      backend: { dbFind, netFetch: vi.fn() },
    });
    await expect(svc.db.find('coll', { a: 1 })).resolves.toEqual([{ x: 1 }]);
    expect(dbFind).toHaveBeenCalledWith({ coll: 'coll', filter: { a: 1 }, opts: undefined });
  });

  it('net.fetch checks scope against URL', async () => {
    const broker = new PermissionBroker();
    broker.setGrants('p1', [parseScope('network:fetch:https://*.acme.com')]);
    const netFetch = vi.fn().mockResolvedValue({ status: 200 });
    const svc = createHostServices({
      broker, pluginId: 'p1',
      backend: { dbFind: vi.fn(), netFetch },
    });
    await expect(svc.net.fetch('https://api.acme.com/v1')).resolves.toEqual({ status: 200 });
    await expect(svc.net.fetch('https://evil.com/')).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
