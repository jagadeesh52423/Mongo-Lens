// NoopLogger — the default Logger adapter.
//
// Used as the fallback in LoggerProvider, the default in createLogger({env:'test'}),
// and as the seed logger for existing singletons that accept a logger via setter.
// Every method is a no-op so unit tests stay quiet and the app stays silent when
// logging is explicitly disabled.

import type { Logger, LogCtx } from './types';

export class NoopLogger implements Logger {
  error(_msg: string, _ctx?: LogCtx): void {}
  warn(_msg: string, _ctx?: LogCtx): void {}
  info(_msg: string, _ctx?: LogCtx): void {}
  debug(_msg: string, _ctx?: LogCtx): void {}
  child(_bindings: LogCtx): Logger {
    return this;
  }
}
