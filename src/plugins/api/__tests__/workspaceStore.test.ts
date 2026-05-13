import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryWorkspaceStore, namespaceFor } from '../workspaceStore';

describe('InMemoryWorkspaceStore', () => {
  let store: InMemoryWorkspaceStore;
  beforeEach(() => { store = new InMemoryWorkspaceStore(); });

  it('returns undefined for missing keys', async () => {
    expect(await store.get('k')).toBeUndefined();
  });

  it('round-trips set/get/delete', async () => {
    await store.set('k', 'v');
    expect(await store.get('k')).toBe('v');
    await store.delete('k');
    expect(await store.get('k')).toBeUndefined();
  });

  it('lists keys', async () => {
    await store.set('a', '1');
    await store.set('b', '2');
    expect((await store.keys()).sort()).toEqual(['a', 'b']);
  });

  it('namespaceFor produces plugin:<id>:<key>', () => {
    expect(namespaceFor('datafleet', 'requests')).toBe('plugin:datafleet:requests');
  });
});
