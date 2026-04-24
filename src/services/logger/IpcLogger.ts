// IpcLogger — prod/webview adapter that batches records and flushes them to
// Rust via the `log_write` Tauri IPC command. Rust owns the single writer for
// `app.log`, so every frontend log line goes through this adapter.
//
// Buffering rules:
//   - Flush immediately when the buffer reaches FLUSH_THRESHOLD records.
//   - Otherwise flush after FLUSH_INTERVAL_MS (timer-based coalescing).
//   - If the IPC call rejects, log one console.warn and silently drop
//     subsequent records. We never raise — logging must not break the app.
//
// Static state is module-scoped (not per-instance) so all child loggers share
// the same buffer and flush timer. `resetForTests()` exists to clear that
// state between unit tests.

import type { Logger, LogCtx, LogLevel, LogRecord } from './types';
import { levelEnabled } from './types';
import { redactCtx } from './redact';

export type InvokeFn = (cmd: string, payload: unknown) => Promise<unknown>;

const FLUSH_INTERVAL_MS = 100;
const FLUSH_THRESHOLD = 20;

export class IpcLogger implements Logger {
  private static buffer: LogRecord[] = [];
  private static timer: ReturnType<typeof setTimeout> | null = null;
  private static warned = false;

  /** Test-only helper. Clears module-level static state between test cases. */
  public static resetForTests(): void {
    if (IpcLogger.timer !== null) {
      clearTimeout(IpcLogger.timer);
      IpcLogger.timer = null;
    }
    IpcLogger.buffer = [];
    IpcLogger.warned = false;
  }

  constructor(
    private readonly name: string,
    private readonly threshold: LogLevel,
    private readonly invoke: InvokeFn,
    private readonly bindings: LogCtx = {},
  ) {}

  private emit(level: LogLevel, msg: string, ctx: LogCtx = {}): void {
    if (!levelEnabled(level, this.threshold)) return;
    const merged = redactCtx({ ...this.bindings, ...ctx });
    const record: LogRecord = {
      ts: Date.now(),
      level,
      logger: this.name,
      runId: typeof merged.runId === 'string' ? merged.runId : undefined,
      msg,
      ctx: merged,
    };
    IpcLogger.buffer.push(record);
    if (IpcLogger.buffer.length >= FLUSH_THRESHOLD) {
      this.flush();
    } else if (IpcLogger.timer === null) {
      IpcLogger.timer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
    }
  }

  private flush(): void {
    if (IpcLogger.timer !== null) {
      clearTimeout(IpcLogger.timer);
      IpcLogger.timer = null;
    }
    if (IpcLogger.buffer.length === 0) return;
    const records = IpcLogger.buffer;
    IpcLogger.buffer = [];
    this.invoke('log_write', { records }).catch((err) => {
      if (!IpcLogger.warned) {
        IpcLogger.warned = true;
        // eslint-disable-next-line no-console
        console.warn(
          '[IpcLogger] log_write failed; subsequent records will be dropped silently.',
          err,
        );
      }
    });
  }

  error(msg: string, ctx?: LogCtx) {
    this.emit('error', msg, ctx);
  }
  warn(msg: string, ctx?: LogCtx) {
    this.emit('warn', msg, ctx);
  }
  info(msg: string, ctx?: LogCtx) {
    this.emit('info', msg, ctx);
  }
  debug(msg: string, ctx?: LogCtx) {
    this.emit('debug', msg, ctx);
  }

  child(bindings: LogCtx): Logger {
    return new IpcLogger(this.name, this.threshold, this.invoke, {
      ...this.bindings,
      ...bindings,
    });
  }
}
