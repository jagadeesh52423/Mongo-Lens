export type SandboxResult<T> = { ok: true; value: T } | { ok: false; error: Error };

export interface SandboxOptions {
  onError: (pluginId: string, error: Error) => void;
  timeoutMs?: number;
}

export async function runInPluginSandbox<T>(
  pluginId: string,
  fn: () => T | Promise<T>,
  opts: SandboxOptions,
): Promise<SandboxResult<T>> {
  try {
    const work = Promise.resolve().then(fn);
    const value = opts.timeoutMs
      ? await Promise.race([
          work,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Plugin "${pluginId}" timed out after ${opts.timeoutMs}ms`)), opts.timeoutMs),
          ),
        ])
      : await work;
    return { ok: true, value };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    opts.onError(pluginId, err);
    return { ok: false, error: err };
  }
}
