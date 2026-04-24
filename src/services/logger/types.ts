// Shared Logger types for the frontend.
//
// This module defines the port (interface) used by all call sites. Concrete
// adapters (NoopLogger, MemoryLogger, ConsoleLogger, IpcLogger) implement the
// Logger interface and are wired at the composition root — callers never
// construct loggers directly.
//
// To add a new Logger variant: implement this interface and register it in
// `createLogger` in `./index.ts`. No other call sites need to change.

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
export type LogCtx = Record<string, unknown>;

export interface LogRecord {
  ts: number; // epoch ms
  level: LogLevel;
  logger: string; // dotted module path
  runId?: string;
  msg: string;
  ctx: LogCtx;
}

export interface Logger {
  error(msg: string, ctx?: LogCtx): void;
  warn(msg: string, ctx?: LogCtx): void;
  info(msg: string, ctx?: LogCtx): void;
  debug(msg: string, ctx?: LogCtx): void;
  /** Returns a new Logger whose records merge `bindings` into every ctx. */
  child(bindings: LogCtx): Logger;
}

export const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

export function levelEnabled(target: LogLevel, threshold: LogLevel): boolean {
  return LOG_LEVEL_ORDER[target] <= LOG_LEVEL_ORDER[threshold];
}
