import { createPluginHost } from '../plugins/host';

describe('plugin host singleton', () => {
  it('initializes manager with registries, broker, and a backend stub', () => {
    const host = createPluginHost({ hostApiVersion: '1.0.0', logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    expect(host.manager).toBeDefined();
    expect(host.registries).toBeDefined();
    expect(host.broker).toBeDefined();
  });
});
