export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

export function createPluginLogger(pluginId: string, underlying: Logger): Logger {
  const tag = (ctx?: Record<string, unknown>) => ({ ...(ctx ?? {}), pluginId });
  return {
    debug: (m, c) => underlying.debug(m, tag(c)),
    info:  (m, c) => underlying.info(m,  tag(c)),
    warn:  (m, c) => underlying.warn(m,  tag(c)),
    error: (m, c) => underlying.error(m, tag(c)),
  };
}
