import { runInPluginSandbox } from '../plugins/sandbox/runInPluginSandbox';

describe('runInPluginSandbox', () => {
  it('returns the value when the function succeeds', async () => {
    const result = await runInPluginSandbox('p1', () => 42, { onError: vi.fn() });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(42);
  });

  it('catches sync throws and reports via onError', async () => {
    const onError = vi.fn();
    const result = await runInPluginSandbox('p1', () => { throw new Error('boom'); }, { onError });
    expect(result.ok).toBe(false);
    expect(onError).toHaveBeenCalledWith('p1', expect.objectContaining({ message: 'boom' }));
  });

  it('catches async rejections and reports via onError', async () => {
    const onError = vi.fn();
    const result = await runInPluginSandbox('p1', async () => { throw new Error('async-boom'); }, { onError });
    expect(result.ok).toBe(false);
    expect(onError).toHaveBeenCalledWith('p1', expect.objectContaining({ message: 'async-boom' }));
  });

  it('enforces a timeout (rejects long-running)', async () => {
    const onError = vi.fn();
    const result = await runInPluginSandbox(
      'p1',
      () => new Promise(r => setTimeout(r, 200)),
      { onError, timeoutMs: 20 },
    );
    expect(result.ok).toBe(false);
    expect(onError).toHaveBeenCalledWith('p1', expect.objectContaining({ message: expect.stringMatching(/timed out/i) }));
  });
});
