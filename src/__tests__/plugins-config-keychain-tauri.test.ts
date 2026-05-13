import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { TauriKeychainBackend } from '../plugins/config/keychainBackend.tauri';

beforeEach(() => { invoke.mockReset(); });

describe('TauriKeychainBackend', () => {
  it('get returns undefined when underlying returns null', async () => {
    invoke.mockResolvedValueOnce(null);
    const kb = new TauriKeychainBackend();
    expect(await kb.get('ns')).toBeUndefined();
    expect(invoke).toHaveBeenCalledWith('get_plugin_secret', { namespace: 'ns' });
  });

  it('get returns the string when underlying returns a string', async () => {
    invoke.mockResolvedValueOnce('hello');
    const kb = new TauriKeychainBackend();
    expect(await kb.get('ns')).toBe('hello');
  });

  it('set invokes set_plugin_secret with namespace and value', async () => {
    invoke.mockResolvedValueOnce(undefined);
    const kb = new TauriKeychainBackend();
    await kb.set('ns', 'v');
    expect(invoke).toHaveBeenCalledWith('set_plugin_secret', { namespace: 'ns', value: 'v' });
  });

  it('delete invokes delete_plugin_secret', async () => {
    invoke.mockResolvedValueOnce(undefined);
    const kb = new TauriKeychainBackend();
    await kb.delete('ns');
    expect(invoke).toHaveBeenCalledWith('delete_plugin_secret', { namespace: 'ns' });
  });

  it('wraps "locked" errors in KeychainLockedError', async () => {
    invoke.mockRejectedValueOnce('keychain locked: master key unavailable');
    invoke.mockRejectedValueOnce('keychain locked: master key unavailable');
    const kb = new TauriKeychainBackend();
    await expect(kb.set('ns', 'v')).rejects.toThrow(/locked/i);
    await expect(kb.set('ns', 'v').catch(e => e.name)).resolves.toBe('KeychainLockedError');
  });
});
