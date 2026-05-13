import { describe, it, expect } from 'vitest';
import { InMemoryKeychainBackend } from '../plugins/config/keychainBackend';

describe('InMemoryKeychainBackend', () => {
  it('returns undefined for missing key', async () => {
    const kb = new InMemoryKeychainBackend();
    expect(await kb.get('x')).toBeUndefined();
  });

  it('round-trips set and get', async () => {
    const kb = new InMemoryKeychainBackend();
    await kb.set('x', 'value');
    expect(await kb.get('x')).toBe('value');
  });

  it('overwrites on second set', async () => {
    const kb = new InMemoryKeychainBackend();
    await kb.set('x', 'a');
    await kb.set('x', 'b');
    expect(await kb.get('x')).toBe('b');
  });

  it('deletes a key', async () => {
    const kb = new InMemoryKeychainBackend();
    await kb.set('x', 'a');
    await kb.delete('x');
    expect(await kb.get('x')).toBeUndefined();
  });

  it('delete is idempotent on missing key', async () => {
    const kb = new InMemoryKeychainBackend();
    await expect(kb.delete('nope')).resolves.toBeUndefined();
  });
});
