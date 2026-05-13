import { invoke } from '@tauri-apps/api/core';
import { KeychainBackend, KeychainLockedError } from './keychainBackend';

export class TauriKeychainBackend implements KeychainBackend {
  async get(namespace: string): Promise<string | undefined> {
    try {
      const v = await invoke<string | null>('get_plugin_secret', { namespace });
      return v === null ? undefined : v;
    } catch (e) {
      throw this.wrap(e);
    }
  }

  async set(namespace: string, value: string): Promise<void> {
    try {
      await invoke<void>('set_plugin_secret', { namespace, value });
    } catch (e) {
      throw this.wrap(e);
    }
  }

  async delete(namespace: string): Promise<void> {
    try {
      await invoke<void>('delete_plugin_secret', { namespace });
    } catch (e) {
      throw this.wrap(e);
    }
  }

  private wrap(e: unknown): Error {
    const msg = e instanceof Error ? e.message : String(e);
    if (/locked|unavailable|denied/i.test(msg)) return new KeychainLockedError(msg);
    return e instanceof Error ? e : new Error(msg);
  }
}
