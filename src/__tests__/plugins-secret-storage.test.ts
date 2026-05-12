import { InMemorySecretStorage, namespaceFor } from '../plugins/api/secretStorage';

describe('SecretStorage', () => {
  it('get/set/delete round-trips', async () => {
    const s = new InMemorySecretStorage();
    await s.store('k', 'v');
    expect(await s.get('k')).toBe('v');
    await s.delete('k');
    expect(await s.get('k')).toBeUndefined();
  });

  it('namespaceFor produces a stable plugin-scoped key', () => {
    expect(namespaceFor('acme.foo', 'api-token')).toBe('plugin:acme.foo:api-token');
  });
});
