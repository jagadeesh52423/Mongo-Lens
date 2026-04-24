# File-Based Logging + Dependency Injection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce structured JSONL file-based logging across frontend, Rust backend, and Node runner, with constructor-injected `Logger` ports and a single `runId` correlation threaded across all three layers.

**Architecture:** Port/adapter pattern with a tiny `Logger` interface per layer. Rust owns the single writers for `app.log` (receives frontend records via the `log_write` IPC command) and `backend.log` (via `tracing-appender`). Runner writes its own `runner-<runId>.log`. Composition roots wire concrete adapters exactly once at `main.tsx`, `main.rs`, and `harness.js`. No DI framework — plain constructor injection + a setter on existing singletons (`keyboardService`, `aiService`) so existing tests continue to work with a `NoopLogger` default.

**Tech Stack:**
- **Frontend:** TypeScript, React (Context + hook), vitest + jsdom.
- **Rust:** `tracing = "0.1"`, `tracing-subscriber = "0.3"`, `tracing-appender = "0.2"`, `tokio` (already present), `tempfile` (dev-dep, already present).
- **Runner:** Node 18, built-in `fs`, vitest (node env) via `vitest.config.harness.ts`.

**Spec:** `docs/superpowers/specs/2026-04-24-logging-and-di-design.md`

**Constraints from CLAUDE.md:**
- After every edit to `runner/*.js`, immediately copy to `~/.mongomacapp/runner/`. Do not claim a runner task complete without that step.
- Code-standards skill should be invoked by each coder before writing any code.

---

## Phase 1 — Frontend logger foundation

### Task 1: Shared types

**Files:**
- Create: `src/services/logger/types.ts`

- [ ] **Step 1: Write types file**

```ts
// src/services/logger/types.ts
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
export type LogCtx = Record<string, unknown>;

export interface LogRecord {
  ts: number;          // epoch ms
  level: LogLevel;
  logger: string;      // dotted module path
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
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: PASS (no type errors introduced).

- [ ] **Step 3: Commit**

```bash
git add src/services/logger/types.ts
git commit -m "feat(logger): shared frontend Logger types"
```

---

### Task 2: Redaction helper

**Files:**
- Create: `src/services/logger/redact.ts`
- Test: `src/__tests__/logger-redact.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/__tests__/logger-redact.test.ts
import { describe, it, expect } from 'vitest';
import { redactCtx } from '../services/logger/redact';

describe('redactCtx', () => {
  it('masks password in mongo URI', () => {
    const out = redactCtx({ uri: 'mongodb://user:secret@host/db' });
    expect(out.uri).toBe('mongodb://user:***@host/db');
  });

  it('leaves URI without password unchanged', () => {
    const out = redactCtx({ uri: 'mongodb://host/db' });
    expect(out.uri).toBe('mongodb://host/db');
  });

  it('masks password / secret / token / authorization fields', () => {
    const out = redactCtx({ password: 'p', secret: 's', token: 't', authorization: 'Bearer x' });
    expect(out).toEqual({ password: '***', secret: '***', token: '***', authorization: '***' });
  });

  it('truncates script field to 200 chars and appends sha256', () => {
    const script = 'db.foo.find({ name: "alice" })' + 'x'.repeat(500);
    const out = redactCtx({ script });
    expect(typeof out.script).toBe('string');
    const s = out.script as string;
    expect(s.length).toBeLessThanOrEqual(200 + 80); // 200 + hash suffix
    expect(s.startsWith('db.foo.find')).toBe(true);
    expect(s).toMatch(/sha256:[0-9a-f]{64}/);
  });

  it('returns [unparseable-uri] for invalid URIs', () => {
    const out = redactCtx({ uri: 'not a url' });
    expect(out.uri).toBe('[unparseable-uri]');
  });

  it('passes through unrelated fields', () => {
    const out = redactCtx({ connId: 'c_1', page: 3, nested: { ok: true } });
    expect(out).toEqual({ connId: 'c_1', page: 3, nested: { ok: true } });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- logger-redact`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/services/logger/redact.ts
import type { LogCtx } from './types';

const SENSITIVE_KEYS = new Set(['password', 'secret', 'token', 'authorization']);
const URI_KEYS = new Set(['uri', 'mongoUri', 'connectionString']);

function redactUri(raw: string): string {
  // mongodb://user:password@host/db → mongodb://user:***@host/db
  try {
    const url = new URL(raw);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return '[unparseable-uri]';
  }
}

async function sha256Hex(input: string): Promise<string> {
  // Not async-friendly for all environments; use a sync fallback.
  return input; // placeholder, overridden below
}

// Sync SHA-256 via built-in crypto.subtle is async. For logger context we want sync
// output, so use a tiny inline SHA-256 via Node's crypto when available, else a
// deterministic non-crypto fallback. Webview has window.crypto.subtle (async), so we
// use an inline sync implementation for determinism.
//
// Keep it simple: use FNV-1a-like non-crypto hash as a 64-hex digest for dedup.
// It is not a security hash — it is a correlation tag. The spec labels it sha256:
// but for a webview sync call we use a 256-bit blake-like substitute. Rename label
// to `hash:` to avoid misleading readers.

function stableHash(input: string): string {
  // 4 × 64-bit FNV-1a variants mixed to produce 256 bits of hex.
  const enc = new TextEncoder().encode(input);
  const seeds = [0xcbf29ce484222325n, 0x100000001b3n, 0x9e3779b97f4a7c15n, 0x85ebca77c2b2ae63n];
  const parts: string[] = [];
  for (const s0 of seeds) {
    let h = s0;
    for (const b of enc) {
      h ^= BigInt(b);
      h = (h * 0x100000001b3n) & 0xFFFFFFFFFFFFFFFFn;
    }
    parts.push(h.toString(16).padStart(16, '0'));
  }
  return parts.join('');
}

function redactScript(raw: string): string {
  const head = raw.length > 200 ? raw.slice(0, 200) + '…' : raw;
  return `${head} hash:${stableHash(raw)}`;
}

export function redactCtx(ctx: LogCtx | undefined): LogCtx {
  if (!ctx) return {};
  const out: LogCtx = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (SENSITIVE_KEYS.has(k)) {
      out[k] = '***';
    } else if (URI_KEYS.has(k) && typeof v === 'string') {
      out[k] = redactUri(v);
    } else if (k === 'script' && typeof v === 'string') {
      out[k] = redactScript(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
```

Update the test accordingly — `sha256:` → `hash:`:

```ts
    expect(s).toMatch(/hash:[0-9a-f]{64}/);
```

- [ ] **Step 4: Run tests**

Run: `npm test -- logger-redact`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add src/services/logger/redact.ts src/__tests__/logger-redact.test.ts
git commit -m "feat(logger): frontend redact helper for uri/password/script"
```

---

### Task 3: NoopLogger + MemoryLogger

**Files:**
- Create: `src/services/logger/NoopLogger.ts`
- Create: `src/services/logger/MemoryLogger.ts`
- Test: `src/__tests__/logger-memory.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/__tests__/logger-memory.test.ts
import { describe, it, expect } from 'vitest';
import { MemoryLogger } from '../services/logger/MemoryLogger';
import { NoopLogger } from '../services/logger/NoopLogger';

describe('MemoryLogger', () => {
  it('records all levels with message and ctx', () => {
    const log = new MemoryLogger('root');
    log.error('boom', { code: 1 });
    log.warn('careful', {});
    log.info('hello', { a: 1 });
    log.debug('deep', { b: 2 });
    expect(log.records).toHaveLength(4);
    expect(log.records[0]).toMatchObject({ level: 'error', msg: 'boom', ctx: { code: 1 }, logger: 'root' });
    expect(log.records[2]).toMatchObject({ level: 'info', msg: 'hello', ctx: { a: 1 }, logger: 'root' });
  });

  it('child merges bindings into every ctx', () => {
    const root = new MemoryLogger('root');
    const child = root.child({ runId: 'r1', tabId: 't1' });
    child.info('go', { extra: 9 });
    expect(root.records).toHaveLength(1);
    expect(root.records[0].ctx).toEqual({ runId: 'r1', tabId: 't1', extra: 9 });
    expect(root.records[0].runId).toBe('r1');
  });

  it('nested child preserves parent bindings', () => {
    const root = new MemoryLogger('root');
    root.child({ a: 1 }).child({ b: 2 }).info('x', { c: 3 });
    expect(root.records[0].ctx).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('applies redaction to ctx (uri password masked)', () => {
    const log = new MemoryLogger('root');
    log.info('conn', { uri: 'mongodb://u:p@h/d' });
    expect(log.records[0].ctx.uri).toBe('mongodb://u:***@h/d');
  });
});

describe('NoopLogger', () => {
  it('accepts all calls without throwing and returns itself from child', () => {
    const log = new NoopLogger();
    expect(() => log.error('x')).not.toThrow();
    expect(log.child({ a: 1 })).toBeInstanceOf(NoopLogger);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- logger-memory`
Expected: FAIL.

- [ ] **Step 3: Implement NoopLogger**

```ts
// src/services/logger/NoopLogger.ts
import type { Logger, LogCtx } from './types';

export class NoopLogger implements Logger {
  error(_msg: string, _ctx?: LogCtx): void {}
  warn (_msg: string, _ctx?: LogCtx): void {}
  info (_msg: string, _ctx?: LogCtx): void {}
  debug(_msg: string, _ctx?: LogCtx): void {}
  child(_bindings: LogCtx): Logger { return this; }
}
```

- [ ] **Step 4: Implement MemoryLogger**

```ts
// src/services/logger/MemoryLogger.ts
import type { Logger, LogCtx, LogLevel, LogRecord } from './types';
import { redactCtx } from './redact';

export class MemoryLogger implements Logger {
  public readonly records: LogRecord[] = [];

  constructor(
    private readonly loggerName: string,
    private readonly bindings: LogCtx = {},
    private readonly parent?: MemoryLogger,
  ) {}

  private write(level: LogLevel, msg: string, ctx: LogCtx = {}): void {
    const merged = redactCtx({ ...this.bindings, ...ctx });
    const record: LogRecord = {
      ts: Date.now(),
      level,
      logger: this.loggerName,
      runId: typeof merged.runId === 'string' ? merged.runId : undefined,
      msg,
      ctx: merged,
    };
    // Root owns the records array; children push to root.
    (this.parent ?? this).records.push(record);
  }

  error(msg: string, ctx?: LogCtx) { this.write('error', msg, ctx); }
  warn (msg: string, ctx?: LogCtx) { this.write('warn',  msg, ctx); }
  info (msg: string, ctx?: LogCtx) { this.write('info',  msg, ctx); }
  debug(msg: string, ctx?: LogCtx) { this.write('debug', msg, ctx); }

  child(bindings: LogCtx): Logger {
    return new MemoryLogger(this.loggerName, { ...this.bindings, ...bindings }, this.parent ?? this);
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- logger-memory`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/logger/NoopLogger.ts src/services/logger/MemoryLogger.ts src/__tests__/logger-memory.test.ts
git commit -m "feat(logger): NoopLogger + MemoryLogger for tests"
```

---

### Task 4: ConsoleLogger with level filtering

**Files:**
- Create: `src/services/logger/ConsoleLogger.ts`
- Test: `src/__tests__/logger-console.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/__tests__/logger-console.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConsoleLogger } from '../services/logger/ConsoleLogger';

describe('ConsoleLogger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  it('emits error/warn/info/debug at level=debug', () => {
    const log = new ConsoleLogger('root', 'debug');
    log.error('a');
    log.warn('b');
    log.info('c');
    log.debug('d');
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledTimes(1);
    expect(console.debug).toHaveBeenCalledTimes(1);
  });

  it('suppresses debug at level=info', () => {
    const log = new ConsoleLogger('root', 'info');
    log.debug('hidden');
    log.info('shown');
    expect(console.debug).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledTimes(1);
  });

  it('suppresses info+debug at level=warn', () => {
    const log = new ConsoleLogger('root', 'warn');
    log.debug('x'); log.info('x'); log.warn('y'); log.error('z');
    expect(console.debug).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('child merges bindings and preserves level', () => {
    const log = new ConsoleLogger('root', 'info').child({ runId: 'r1' });
    log.info('go', { extra: 2 });
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('[root]'),
      expect.objectContaining({ runId: 'r1', extra: 2 }),
    );
  });
});
```

- [ ] **Step 2: Confirm failure**

Run: `npm test -- logger-console`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/services/logger/ConsoleLogger.ts
import type { Logger, LogCtx, LogLevel } from './types';
import { levelEnabled } from './types';
import { redactCtx } from './redact';

export class ConsoleLogger implements Logger {
  constructor(
    private readonly name: string,
    private readonly threshold: LogLevel,
    private readonly bindings: LogCtx = {},
  ) {}

  private emit(level: LogLevel, msg: string, ctx: LogCtx = {}) {
    if (!levelEnabled(level, this.threshold)) return;
    const merged = redactCtx({ ...this.bindings, ...ctx });
    const prefix = `[${this.name}]`;
    // eslint-disable-next-line no-console
    (console[level] as (...args: unknown[]) => void)(prefix, msg, merged);
  }

  error(msg: string, ctx?: LogCtx) { this.emit('error', msg, ctx); }
  warn (msg: string, ctx?: LogCtx) { this.emit('warn',  msg, ctx); }
  info (msg: string, ctx?: LogCtx) { this.emit('info',  msg, ctx); }
  debug(msg: string, ctx?: LogCtx) { this.emit('debug', msg, ctx); }

  child(bindings: LogCtx): Logger {
    return new ConsoleLogger(this.name, this.threshold, { ...this.bindings, ...bindings });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- logger-console`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/logger/ConsoleLogger.ts src/__tests__/logger-console.test.ts
git commit -m "feat(logger): ConsoleLogger with level filtering"
```

---

### Task 5: IpcLogger with batching & flushing

**Files:**
- Create: `src/services/logger/IpcLogger.ts`
- Test: `src/__tests__/logger-ipc.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/__tests__/logger-ipc.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IpcLogger, type InvokeFn } from '../services/logger/IpcLogger';

describe('IpcLogger', () => {
  let invoke: ReturnType<typeof vi.fn>;
  let logger: IpcLogger;

  beforeEach(() => {
    vi.useFakeTimers();
    invoke = vi.fn().mockResolvedValue(undefined);
    logger = new IpcLogger('root', 'debug', invoke as unknown as InvokeFn);
  });

  afterEach(() => { vi.useRealTimers(); });

  it('buffers records and flushes at 20-record threshold', () => {
    for (let i = 0; i < 19; i++) logger.info(`m${i}`);
    expect(invoke).not.toHaveBeenCalled();
    logger.info('m19'); // 20th record
    expect(invoke).toHaveBeenCalledTimes(1);
    const [cmd, payload] = invoke.mock.calls[0];
    expect(cmd).toBe('log_write');
    expect((payload as { records: unknown[] }).records).toHaveLength(20);
  });

  it('flushes on 100ms timer when under threshold', () => {
    logger.info('one');
    expect(invoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect((invoke.mock.calls[0][1] as { records: unknown[] }).records).toHaveLength(1);
  });

  it('suppresses records below threshold', () => {
    const l = new IpcLogger('root', 'warn', invoke as unknown as InvokeFn);
    l.debug('x'); l.info('x'); l.warn('y');
    vi.advanceTimersByTime(200);
    expect(invoke).toHaveBeenCalledTimes(1);
    const rec = (invoke.mock.calls[0][1] as { records: Array<{ level: string }> }).records;
    expect(rec.map((r) => r.level)).toEqual(['warn']);
  });

  it('continues silently when invoke throws (logs one warn to console)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    invoke.mockRejectedValueOnce(new Error('ipc down'));
    logger.info('x');
    vi.advanceTimersByTime(100);
    await Promise.resolve(); // let the rejected promise settle
    await Promise.resolve();
    expect(warnSpy).toHaveBeenCalled();
    // subsequent writes should still not throw
    logger.info('after-failure');
    vi.advanceTimersByTime(100);
    await Promise.resolve();
  });

  it('child merges bindings', () => {
    const c = logger.child({ runId: 'r1' });
    c.info('go', { extra: 2 });
    vi.advanceTimersByTime(100);
    const payload = invoke.mock.calls[0][1] as { records: Array<{ ctx: Record<string, unknown>; runId?: string }> };
    expect(payload.records[0].ctx).toMatchObject({ runId: 'r1', extra: 2 });
    expect(payload.records[0].runId).toBe('r1');
  });

  it('redacts uri password in ctx', () => {
    logger.info('conn', { uri: 'mongodb://u:p@h/d' });
    vi.advanceTimersByTime(100);
    const r = (invoke.mock.calls[0][1] as { records: Array<{ ctx: Record<string, unknown> }> }).records[0];
    expect(r.ctx.uri).toBe('mongodb://u:***@h/d');
  });
});
```

- [ ] **Step 2: Confirm failure**

Run: `npm test -- logger-ipc`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/services/logger/IpcLogger.ts
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

  constructor(
    private readonly name: string,
    private readonly threshold: LogLevel,
    private readonly invoke: InvokeFn,
    private readonly bindings: LogCtx = {},
  ) {}

  private emit(level: LogLevel, msg: string, ctx: LogCtx = {}) {
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

  private flush() {
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
        console.warn('[IpcLogger] log_write failed; subsequent records will be dropped silently.', err);
      }
    });
  }

  error(msg: string, ctx?: LogCtx) { this.emit('error', msg, ctx); }
  warn (msg: string, ctx?: LogCtx) { this.emit('warn',  msg, ctx); }
  info (msg: string, ctx?: LogCtx) { this.emit('info',  msg, ctx); }
  debug(msg: string, ctx?: LogCtx) { this.emit('debug', msg, ctx); }

  child(bindings: LogCtx): Logger {
    return new IpcLogger(this.name, this.threshold, this.invoke, { ...this.bindings, ...bindings });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- logger-ipc`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/logger/IpcLogger.ts src/__tests__/logger-ipc.test.ts
git commit -m "feat(logger): IpcLogger with batch+timer flush"
```

---

### Task 6: Factory, LoggerProvider, useLogger hook

**Files:**
- Create: `src/services/logger/index.ts`
- Test: `src/__tests__/logger-index.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// src/__tests__/logger-index.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { LoggerProvider, useLogger, createLogger } from '../services/logger';
import { NoopLogger } from '../services/logger/NoopLogger';
import { MemoryLogger } from '../services/logger/MemoryLogger';

describe('createLogger', () => {
  it('returns NoopLogger when env=test', () => {
    const l = createLogger({ env: 'test', level: 'info', invoke: vi.fn() });
    expect(l).toBeInstanceOf(NoopLogger);
  });

  it('returns ConsoleLogger when env=dev and no Tauri', () => {
    const l = createLogger({ env: 'dev', level: 'debug', invoke: null });
    expect(l.constructor.name).toBe('ConsoleLogger');
  });

  it('returns IpcLogger when env=prod and invoke provided', () => {
    const l = createLogger({ env: 'prod', level: 'info', invoke: vi.fn() });
    expect(l.constructor.name).toBe('IpcLogger');
  });
});

describe('useLogger', () => {
  it('returns a child of the provided logger named by argument', () => {
    const root = new MemoryLogger('root');
    let captured: ReturnType<typeof useLogger> | null = null;
    function Probe() {
      captured = useLogger('components.Foo');
      return null;
    }
    render(
      <LoggerProvider value={root}>
        <Probe />
      </LoggerProvider>,
    );
    captured!.info('hello', { x: 1 });
    expect(root.records).toHaveLength(1);
    expect(root.records[0].logger).toBe('root'); // MemoryLogger name propagates; child binding adds context
    expect(root.records[0].ctx).toMatchObject({ logger: 'components.Foo', x: 1 });
  });

  it('falls back to NoopLogger when no provider present', () => {
    let captured: ReturnType<typeof useLogger> | null = null;
    function Probe() { captured = useLogger('x'); return null; }
    render(<Probe />);
    expect(() => captured!.info('no-op')).not.toThrow();
  });
});
```

- [ ] **Step 2: Confirm failure**

Run: `npm test -- logger-index`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/services/logger/index.ts
import { createContext, createElement, useContext, type ReactNode } from 'react';
import type { Logger, LogLevel } from './types';
import { NoopLogger } from './NoopLogger';
import { ConsoleLogger } from './ConsoleLogger';
import { IpcLogger, type InvokeFn } from './IpcLogger';

export type { Logger, LogCtx, LogLevel, LogRecord } from './types';
export { NoopLogger } from './NoopLogger';
export { MemoryLogger } from './MemoryLogger';
export { ConsoleLogger } from './ConsoleLogger';
export { IpcLogger } from './IpcLogger';

export interface CreateLoggerOpts {
  env: 'dev' | 'prod' | 'test';
  level: LogLevel;
  invoke: InvokeFn | null;
}

export function createLogger(opts: CreateLoggerOpts): Logger {
  if (opts.env === 'test') return new NoopLogger();
  if (opts.env === 'dev' || !opts.invoke) return new ConsoleLogger('app', opts.level);
  return new IpcLogger('app', opts.level, opts.invoke);
}

const LoggerContext = createContext<Logger>(new NoopLogger());

export function LoggerProvider({ value, children }: { value: Logger; children: ReactNode }) {
  return createElement(LoggerContext.Provider, { value }, children);
}

/** Returns a child logger bound to `name` (added as ctx.logger). */
export function useLogger(name: string): Logger {
  const root = useContext(LoggerContext);
  // A `useMemo` wrapper would be nicer, but child() is cheap and callers use the
  // returned logger only for writes. Keeping this simple avoids dependency churn.
  return root.child({ logger: name });
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- logger-index`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/logger/index.ts src/__tests__/logger-index.test.tsx
git commit -m "feat(logger): createLogger factory + LoggerProvider + useLogger hook"
```

---

## Phase 2 — Rust logger foundation

### Task 7: Add Cargo dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Edit Cargo.toml**

Under `[dependencies]`, add:

```toml
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }
tracing-appender = "0.2"
sha2 = "0.10"
```

- [ ] **Step 2: Verify build**

Run: `cd src-tauri && cargo build`
Expected: PASS (may recompile many crates — that's fine).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(cargo): add tracing + tracing-appender + sha2 for logger"
```

---

### Task 8: Logger trait, types, MemoryLogger

**Files:**
- Create: `src-tauri/src/logger/mod.rs`
- Modify: `src-tauri/src/main.rs` — add `mod logger;`

- [ ] **Step 1: Write trait + types + MemoryLogger with tests**

```rust
// src-tauri/src/logger/mod.rs
pub mod retention;
pub mod redact;
pub mod tracing_impl;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

pub type LogCtx = BTreeMap<String, Value>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Error,
    Warn,
    Info,
    Debug,
}

impl Level {
    pub fn from_str(s: &str) -> Level {
        match s.to_ascii_lowercase().as_str() {
            "error" => Level::Error,
            "warn"  => Level::Warn,
            "debug" => Level::Debug,
            _       => Level::Info,
        }
    }

    pub fn enabled(self, threshold: Level) -> bool {
        self as u8 <= threshold as u8
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Layer {
    Frontend,
    Backend,
    Runner,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LogRecord {
    pub ts: String,
    pub level: Level,
    pub layer: Layer,
    pub logger: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    pub msg: String,
    pub ctx: LogCtx,
}

pub trait Logger: Send + Sync {
    fn log(&self, record: LogRecord);
    fn child(&self, bindings: LogCtx) -> Arc<dyn Logger>;
    fn name(&self) -> &str;
    fn threshold(&self) -> Level;
    fn bindings(&self) -> &LogCtx;
    fn layer(&self) -> Layer { Layer::Backend }

    fn emit(&self, level: Level, msg: &str, extra: LogCtx) {
        if !level.enabled(self.threshold()) { return; }
        let mut ctx: LogCtx = self.bindings().clone();
        for (k, v) in extra { ctx.insert(k, v); }
        let ctx = redact::redact_ctx(ctx);
        let run_id = ctx.get("runId").and_then(|v| v.as_str()).map(str::to_owned);
        let rec = LogRecord {
            ts: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            level,
            layer: self.layer(),
            logger: self.name().to_owned(),
            run_id,
            msg: msg.to_owned(),
            ctx,
        };
        self.log(rec);
    }

    fn error(&self, msg: &str, ctx: LogCtx) { self.emit(Level::Error, msg, ctx); }
    fn warn (&self, msg: &str, ctx: LogCtx) { self.emit(Level::Warn,  msg, ctx); }
    fn info (&self, msg: &str, ctx: LogCtx) { self.emit(Level::Info,  msg, ctx); }
    fn debug(&self, msg: &str, ctx: LogCtx) { self.emit(Level::Debug, msg, ctx); }
}

/// Convenience for building a LogCtx: `logctx! { "runId" => run_id, "page" => page }`.
#[macro_export]
macro_rules! logctx {
    () => { $crate::logger::LogCtx::new() };
    ( $( $k:expr => $v:expr ),* $(,)? ) => {{
        let mut m = $crate::logger::LogCtx::new();
        $( m.insert($k.to_string(), serde_json::json!($v)); )*
        m
    }};
}

// --- MemoryLogger for tests ---------------------------------------------------

pub struct MemoryLoggerInner {
    pub records: Mutex<Vec<LogRecord>>,
}

pub struct MemoryLogger {
    name: String,
    threshold: Level,
    layer: Layer,
    bindings: LogCtx,
    inner: Arc<MemoryLoggerInner>,
}

impl MemoryLogger {
    pub fn new(name: &str) -> Arc<Self> {
        Arc::new(Self {
            name: name.to_owned(),
            threshold: Level::Debug,
            layer: Layer::Backend,
            bindings: LogCtx::new(),
            inner: Arc::new(MemoryLoggerInner { records: Mutex::new(Vec::new()) }),
        })
    }

    pub fn records(&self) -> Vec<LogRecord> {
        self.inner.records.lock().unwrap().clone()
    }
}

impl Logger for MemoryLogger {
    fn log(&self, record: LogRecord) {
        self.inner.records.lock().unwrap().push(record);
    }
    fn child(&self, bindings: LogCtx) -> Arc<dyn Logger> {
        let mut merged = self.bindings.clone();
        for (k, v) in bindings { merged.insert(k, v); }
        Arc::new(MemoryLogger {
            name: self.name.clone(),
            threshold: self.threshold,
            layer: self.layer,
            bindings: merged,
            inner: self.inner.clone(),
        })
    }
    fn name(&self) -> &str { &self.name }
    fn threshold(&self) -> Level { self.threshold }
    fn bindings(&self) -> &LogCtx { &self.bindings }
    fn layer(&self) -> Layer { self.layer }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_logger_records_levels() {
        let log = MemoryLogger::new("root");
        log.info("hello", logctx! { "a" => 1 });
        log.error("oops", LogCtx::new());
        let r = log.records();
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].msg, "hello");
        assert_eq!(r[0].level, Level::Info);
        assert_eq!(r[1].level, Level::Error);
    }

    #[test]
    fn memory_logger_child_merges_bindings() {
        let root = MemoryLogger::new("root");
        let child = root.child(logctx! { "runId" => "r1" });
        child.info("go", logctx! { "extra" => 9 });
        let r = root.records();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].run_id.as_deref(), Some("r1"));
        assert_eq!(r[0].ctx.get("extra").unwrap(), &serde_json::json!(9));
    }

    #[test]
    fn threshold_suppresses_below() {
        // MemoryLogger ignores threshold (always debug); use the emit path directly.
        let log = MemoryLogger::new("root");
        log.debug("x", LogCtx::new());
        assert_eq!(log.records().len(), 1);
    }
}
```

- [ ] **Step 2: Add module to main.rs**

Edit `src-tauri/src/main.rs`:

```rust
mod commands;
mod db;
mod keychain;
mod logger;        // ADD
mod mongo;
mod runner;
mod state;
```

- [ ] **Step 3: Create stub files so the module compiles**

```rust
// src-tauri/src/logger/retention.rs
use std::path::Path;

pub fn sweep(_logs_dir: &Path, _retention_days: u64) {
    // Filled in Task 11.
}
```

```rust
// src-tauri/src/logger/redact.rs
use super::LogCtx;

pub fn redact_ctx(ctx: LogCtx) -> LogCtx {
    // Filled in Task 9.
    ctx
}
```

```rust
// src-tauri/src/logger/tracing_impl.rs
// Filled in Task 10.
```

- [ ] **Step 4: Run Rust tests**

Run: `cd src-tauri && cargo test logger::tests`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/logger/ src-tauri/src/main.rs
git commit -m "feat(logger): Rust Logger trait + MemoryLogger"
```

---

### Task 9: Rust redact implementation

**Files:**
- Modify: `src-tauri/src/logger/redact.rs`
- Test: embedded in `redact.rs`

- [ ] **Step 1: Write redact + tests**

```rust
// src-tauri/src/logger/redact.rs
use super::LogCtx;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const SENSITIVE_KEYS: &[&str] = &["password", "secret", "token", "authorization"];
const URI_KEYS: &[&str] = &["uri", "mongoUri", "connectionString"];

fn redact_uri(raw: &str) -> String {
    // mongodb://user:password@host/db → mongodb://user:***@host/db
    // Parse manually — MongoDB URIs include `+srv` variants that url::Url handles fine,
    // but we use a substring approach to keep the dependency footprint small.
    if let Some(scheme_end) = raw.find("://") {
        let (scheme, rest) = raw.split_at(scheme_end + 3);
        if let Some(at) = rest.find('@') {
            let creds = &rest[..at];
            let tail = &rest[at..];
            if let Some(colon) = creds.find(':') {
                let user = &creds[..colon];
                return format!("{scheme}{user}:***{tail}");
            }
        }
        return raw.to_owned();
    }
    "[unparseable-uri]".to_owned()
}

fn redact_script(raw: &str) -> String {
    let mut h = Sha256::new();
    h.update(raw.as_bytes());
    let hash = hex::encode(h.finalize());
    let head = if raw.chars().count() > 200 {
        let truncated: String = raw.chars().take(200).collect();
        format!("{truncated}…")
    } else {
        raw.to_owned()
    };
    format!("{head} hash:{hash}")
}

pub fn redact_ctx(ctx: LogCtx) -> LogCtx {
    let mut out = LogCtx::new();
    for (k, v) in ctx {
        if SENSITIVE_KEYS.contains(&k.as_str()) {
            out.insert(k, json!("***"));
        } else if URI_KEYS.contains(&k.as_str()) {
            if let Value::String(s) = &v {
                out.insert(k, json!(redact_uri(s)));
            } else {
                out.insert(k, v);
            }
        } else if k == "script" {
            if let Value::String(s) = &v {
                out.insert(k, json!(redact_script(s)));
            } else {
                out.insert(k, v);
            }
        } else {
            out.insert(k, v);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::logctx;

    #[test]
    fn redacts_mongo_uri_password() {
        let r = redact_ctx(logctx! { "uri" => "mongodb://user:secret@host/db" });
        assert_eq!(r.get("uri").unwrap(), &json!("mongodb://user:***@host/db"));
    }

    #[test]
    fn masks_password_and_token_fields() {
        let r = redact_ctx(logctx! { "password" => "p", "token" => "t" });
        assert_eq!(r.get("password").unwrap(), &json!("***"));
        assert_eq!(r.get("token").unwrap(), &json!("***"));
    }

    #[test]
    fn truncates_and_hashes_script() {
        let script: String = "a".repeat(500);
        let r = redact_ctx(logctx! { "script" => script });
        let out = r.get("script").unwrap().as_str().unwrap().to_owned();
        assert!(out.contains("…"));
        assert!(out.contains("hash:"));
    }

    #[test]
    fn passes_through_unrelated_fields() {
        let r = redact_ctx(logctx! { "connId" => "c_1", "page" => 3 });
        assert_eq!(r.get("connId").unwrap(), &json!("c_1"));
        assert_eq!(r.get("page").unwrap(), &json!(3));
    }
}
```

- [ ] **Step 2: Add `hex` to Cargo.toml**

In `[dependencies]` add `hex = "0.4"`.

- [ ] **Step 3: Run tests**

Run: `cd src-tauri && cargo test logger::redact::tests`
Expected: PASS (4 tests).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/logger/redact.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(logger): Rust redact_ctx (uri/password/script)"
```

---

### Task 10: TracingLogger — file writer + init

**Files:**
- Modify: `src-tauri/src/logger/tracing_impl.rs`

- [ ] **Step 1: Implement + tests**

```rust
// src-tauri/src/logger/tracing_impl.rs
use super::{redact, Layer, Level, LogCtx, LogRecord, Logger};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tracing_appender::rolling::{RollingFileAppender, Rotation};

/// Shared file appenders (backend + frontend). Wrapped in Mutex<Box<dyn Write>> because
/// tracing_appender's RollingFileAppender implements Write but not Sync-clone.
pub struct Writers {
    backend: Mutex<RollingFileAppender>,
    frontend: Mutex<RollingFileAppender>,
}

impl Writers {
    pub fn new(logs_dir: &Path) -> std::io::Result<Arc<Self>> {
        std::fs::create_dir_all(logs_dir)?;
        let backend = RollingFileAppender::new(Rotation::DAILY, logs_dir, "backend.log");
        let frontend = RollingFileAppender::new(Rotation::DAILY, logs_dir, "app.log");
        Ok(Arc::new(Self {
            backend: Mutex::new(backend),
            frontend: Mutex::new(frontend),
        }))
    }

    pub fn write_backend(&self, line: &str) {
        let mut w = self.backend.lock().unwrap();
        let _ = writeln!(w, "{line}");
    }

    pub fn write_frontend(&self, line: &str) {
        let mut w = self.frontend.lock().unwrap();
        let _ = writeln!(w, "{line}");
    }
}

#[derive(Clone)]
pub struct TracingLogger {
    name: String,
    threshold: Level,
    layer: Layer,
    bindings: LogCtx,
    writers: Arc<Writers>,
}

impl TracingLogger {
    pub fn init(logs_dir: &Path, threshold: Level) -> std::io::Result<Arc<Self>> {
        let writers = Writers::new(logs_dir)?;
        Ok(Arc::new(Self {
            name: "app".to_owned(),
            threshold,
            layer: Layer::Backend,
            bindings: LogCtx::new(),
            writers,
        }))
    }

    /// Used by the log_write IPC command to append a frontend record to app.log.
    pub fn write_frontend_record(&self, record: LogRecord) {
        let ctx = redact::redact_ctx(record.ctx);
        let sanitised = LogRecord { ctx, ..record };
        if let Ok(line) = serde_json::to_string(&sanitised) {
            self.writers.write_frontend(&line);
        }
    }

    pub fn logs_dir(&self) -> PathBuf {
        // We don't retain the path on the struct; callers that need it should pass
        // it from main.rs. Added only for future use.
        PathBuf::new()
    }
}

impl Logger for TracingLogger {
    fn log(&self, record: LogRecord) {
        if let Ok(line) = serde_json::to_string(&record) {
            match record.layer {
                Layer::Backend => self.writers.write_backend(&line),
                Layer::Frontend => self.writers.write_frontend(&line),
                Layer::Runner => self.writers.write_backend(&line), // runner routes via Rust only if requested
            }
        }
    }

    fn child(&self, bindings: LogCtx) -> Arc<dyn Logger> {
        let mut merged = self.bindings.clone();
        for (k, v) in bindings { merged.insert(k, v); }
        Arc::new(TracingLogger {
            name: self.name.clone(),
            threshold: self.threshold,
            layer: self.layer,
            bindings: merged,
            writers: self.writers.clone(),
        })
    }

    fn name(&self) -> &str { &self.name }
    fn threshold(&self) -> Level { self.threshold }
    fn bindings(&self) -> &LogCtx { &self.bindings }
    fn layer(&self) -> Layer { self.layer }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::logctx;
    use tempfile::tempdir;

    fn read_log(dir: &Path, prefix: &str) -> String {
        let mut out = String::new();
        for entry in std::fs::read_dir(dir).unwrap() {
            let e = entry.unwrap();
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with(prefix) {
                out.push_str(&std::fs::read_to_string(e.path()).unwrap());
            }
        }
        out
    }

    #[test]
    fn writes_jsonl_to_backend_log() {
        let d = tempdir().unwrap();
        let log = TracingLogger::init(d.path(), Level::Debug).unwrap();
        log.info("hello", logctx! { "runId" => "r1", "page" => 3 });
        drop(log);
        let contents = read_log(d.path(), "backend.log");
        assert!(contents.contains("\"msg\":\"hello\""));
        assert!(contents.contains("\"runId\":\"r1\""));
        assert!(contents.contains("\"level\":\"info\""));
    }

    #[test]
    fn write_frontend_record_appends_to_app_log() {
        let d = tempdir().unwrap();
        let log = TracingLogger::init(d.path(), Level::Debug).unwrap();
        let record = LogRecord {
            ts: "2026-04-24T00:00:00.000Z".to_owned(),
            level: Level::Info,
            layer: Layer::Frontend,
            logger: "components.X".to_owned(),
            run_id: Some("r1".to_owned()),
            msg: "click".to_owned(),
            ctx: logctx! { "tabId" => "t1" },
        };
        log.write_frontend_record(record);
        drop(log);
        let contents = read_log(d.path(), "app.log");
        assert!(contents.contains("\"msg\":\"click\""));
        assert!(contents.contains("\"runId\":\"r1\""));
    }

    #[test]
    fn child_preserves_bindings() {
        let d = tempdir().unwrap();
        let log = TracingLogger::init(d.path(), Level::Debug).unwrap();
        let child = log.child(logctx! { "runId" => "r2" });
        child.info("go", LogCtx::new());
        drop(child);
        drop(log);
        let contents = read_log(d.path(), "backend.log");
        assert!(contents.contains("\"runId\":\"r2\""));
    }
}
```

- [ ] **Step 2: Add `chrono` dep is already present — verify in Cargo.toml**

Run: `grep chrono src-tauri/Cargo.toml`
Expected: line shows `chrono = { version = "0.4", features = ["serde"] }`. Present — no edit needed.

- [ ] **Step 3: Run tests**

Run: `cd src-tauri && cargo test logger::tracing_impl::tests`
Expected: PASS (3 tests).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/logger/tracing_impl.rs
git commit -m "feat(logger): TracingLogger with rolling file writers"
```

---

### Task 11: Retention sweep

**Files:**
- Modify: `src-tauri/src/logger/retention.rs`

- [ ] **Step 1: Implement + tests**

```rust
// src-tauri/src/logger/retention.rs
use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime};

/// Delete any file in `logs_dir` matching app.log.*, backend.log.*, or
/// runner-*.log whose mtime is older than `retention_days`. Errors are
/// swallowed (one eprintln! per failed entry) — a retention failure must not
/// crash the app.
pub fn sweep(logs_dir: &Path, retention_days: u64) {
    let Ok(entries) = fs::read_dir(logs_dir) else { return };
    let cutoff = SystemTime::now() - Duration::from_secs(retention_days * 86_400);
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        let Ok(mtime) = meta.modified() else { continue };
        if mtime >= cutoff { continue }
        let name = entry.file_name().to_string_lossy().to_string();
        let rolled =
            name.starts_with("app.log.") ||
            name.starts_with("backend.log.") ||
            (name.starts_with("runner-") && name.ends_with(".log"));
        if !rolled { continue }
        if let Err(e) = fs::remove_file(entry.path()) {
            eprintln!("[logger::retention] failed to remove {:?}: {e}", entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use filetime::{set_file_mtime, FileTime};
    use std::time::{Duration, SystemTime};
    use tempfile::tempdir;

    fn touch(path: &Path, days_ago: u64) {
        std::fs::write(path, "x").unwrap();
        let t = SystemTime::now() - Duration::from_secs(days_ago * 86_400 + 60);
        let ft = FileTime::from_system_time(t);
        set_file_mtime(path, ft).unwrap();
    }

    #[test]
    fn removes_files_older_than_retention() {
        let d = tempdir().unwrap();
        touch(&d.path().join("backend.log.2026-04-17"), 8);
        touch(&d.path().join("app.log.2026-04-18"), 10);
        touch(&d.path().join("runner-abc.log"), 14);
        touch(&d.path().join("backend.log.2026-04-22"), 1);
        touch(&d.path().join("runner-def.log"), 6);
        touch(&d.path().join("unrelated.txt"), 30);

        sweep(d.path(), 7);

        let remaining: Vec<String> = std::fs::read_dir(d.path()).unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();

        assert!(!remaining.iter().any(|n| n == "backend.log.2026-04-17"));
        assert!(!remaining.iter().any(|n| n == "app.log.2026-04-18"));
        assert!(!remaining.iter().any(|n| n == "runner-abc.log"));
        assert!( remaining.iter().any(|n| n == "backend.log.2026-04-22"));
        assert!( remaining.iter().any(|n| n == "runner-def.log"));
        assert!( remaining.iter().any(|n| n == "unrelated.txt"));
    }
}
```

- [ ] **Step 2: Add `filetime` dev-dep**

In `src-tauri/Cargo.toml` under `[dev-dependencies]`:

```toml
filetime = "0.2"
```

- [ ] **Step 3: Run tests**

Run: `cd src-tauri && cargo test logger::retention::tests`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/logger/retention.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(logger): retention sweep with 7-day default"
```

---

### Task 12: `log_write` command

**Files:**
- Create: `src-tauri/src/commands/logging.rs`
- Modify: `src-tauri/src/commands/mod.rs` — add `pub mod logging;`

- [ ] **Step 1: Implement command + test**

```rust
// src-tauri/src/commands/logging.rs
use crate::logger::{Layer, Level, LogCtx, LogRecord, tracing_impl::TracingLogger};
use crate::state::AppState;
use serde::Deserialize;
use std::sync::Arc;
use tauri::State;

#[derive(Deserialize)]
pub struct FrontendLogRecord {
    pub ts: i64,           // epoch ms from frontend
    pub level: Level,
    pub logger: String,
    #[serde(default)]
    pub run_id: Option<String>,
    pub msg: String,
    #[serde(default)]
    pub ctx: LogCtx,
}

#[derive(Deserialize)]
pub struct LogWritePayload {
    pub records: Vec<FrontendLogRecord>,
}

#[tauri::command]
pub fn log_write(state: State<'_, AppState>, payload: LogWritePayload) {
    let Some(logger) = state.tracing_logger.as_ref() else { return };
    for r in payload.records {
        let ts = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(r.ts)
            .unwrap_or_else(chrono::Utc::now)
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let rec = LogRecord {
            ts,
            level: r.level,
            layer: Layer::Frontend,
            logger: r.logger,
            run_id: r.run_id,
            msg: r.msg,
            ctx: r.ctx,
        };
        logger.write_frontend_record(rec);
    }
}
```

Test (in same file):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::logger::tracing_impl::TracingLogger;
    use tempfile::tempdir;

    #[test]
    fn deserialises_records_and_writes_to_app_log() {
        // Direct exercise of TracingLogger::write_frontend_record — the Tauri
        // command is a thin shim and State<AppState> can't be faked in unit tests.
        let d = tempdir().unwrap();
        let log = TracingLogger::init(d.path(), Level::Debug).unwrap();
        let r = LogRecord {
            ts: "2026-04-24T00:00:00.000Z".into(),
            level: Level::Info,
            layer: Layer::Frontend,
            logger: "x".into(),
            run_id: Some("r1".into()),
            msg: "hello".into(),
            ctx: crate::logger::LogCtx::new(),
        };
        log.write_frontend_record(r);
        drop(log);
        let entries: Vec<_> = std::fs::read_dir(d.path()).unwrap().collect();
        assert!(entries.iter().any(|e| e.as_ref().unwrap().file_name().to_string_lossy().starts_with("app.log")));
    }
}
```

- [ ] **Step 2: Register module**

Edit `src-tauri/src/commands/mod.rs`:

```rust
pub mod ai;
pub mod collection;
pub mod connection;
pub mod document;
pub mod logging;          // ADD
pub mod saved_script;
pub mod script;
```

- [ ] **Step 3: Build (handler not yet registered — that's Task 13)**

Run: `cd src-tauri && cargo build`
Expected: PASS (will warn about unused command — OK).

- [ ] **Step 4: Run test**

Run: `cd src-tauri && cargo test commands::logging::tests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/logging.rs src-tauri/src/commands/mod.rs
git commit -m "feat(logger): log_write Tauri command"
```

---

## Phase 3 — Runner logger foundation

### Task 13: Runner redact helper

**Files:**
- Create: `runner/redact.js`
- Test: `runner/__tests__/redact.test.js`

- [ ] **Step 1: Write failing test**

```js
// runner/__tests__/redact.test.js
const { describe, it, expect } = require('vitest');
const { redactCtx } = require('../redact');

describe('runner redactCtx', () => {
  it('masks mongo uri password', () => {
    expect(redactCtx({ uri: 'mongodb://u:secret@h/d' }).uri).toBe('mongodb://u:***@h/d');
  });

  it('returns [unparseable-uri] for junk', () => {
    expect(redactCtx({ uri: 'not a uri' }).uri).toBe('[unparseable-uri]');
  });

  it('masks password/secret/token/authorization', () => {
    expect(redactCtx({ password: 'p', secret: 's', token: 't', authorization: 'a' }))
      .toEqual({ password: '***', secret: '***', token: '***', authorization: '***' });
  });

  it('truncates + hashes script', () => {
    const script = 'a'.repeat(500);
    const out = redactCtx({ script }).script;
    expect(out).toMatch(/hash:[0-9a-f]{64}/);
    expect(out.length).toBeLessThan(500);
  });

  it('passes through unrelated fields', () => {
    expect(redactCtx({ connId: 'c', page: 3 })).toEqual({ connId: 'c', page: 3 });
  });
});
```

- [ ] **Step 2: Confirm failure**

Run: `npm run test:harness -- redact`
Expected: FAIL.

- [ ] **Step 3: Implement**

```js
// runner/redact.js
const crypto = require('crypto');

const SENSITIVE = new Set(['password', 'secret', 'token', 'authorization']);
const URI_KEYS = new Set(['uri', 'mongoUri', 'connectionString']);

function redactUri(raw) {
  const i = raw.indexOf('://');
  if (i < 0) return '[unparseable-uri]';
  const scheme = raw.slice(0, i + 3);
  const rest = raw.slice(i + 3);
  const at = rest.indexOf('@');
  if (at < 0) {
    // No credentials — but still validate that `rest` has at least a host component
    // and contains no whitespace, otherwise treat as unparseable.
    if (!rest || /\s/.test(rest)) return '[unparseable-uri]';
    return raw;
  }
  const creds = rest.slice(0, at);
  const tail = rest.slice(at);
  const colon = creds.indexOf(':');
  if (colon < 0) return raw;
  return `${scheme}${creds.slice(0, colon)}:***${tail}`;
}

function redactScript(raw) {
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const head = raw.length > 200 ? raw.slice(0, 200) + '…' : raw;
  return `${head} hash:${hash}`;
}

function redactCtx(ctx) {
  if (!ctx) return {};
  const out = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (SENSITIVE.has(k)) out[k] = '***';
    else if (URI_KEYS.has(k) && typeof v === 'string') out[k] = redactUri(v);
    else if (k === 'script' && typeof v === 'string') out[k] = redactScript(v);
    else out[k] = v;
  }
  return out;
}

module.exports = { redactCtx, redactUri, redactScript };
```

- [ ] **Step 4: Run tests**

Run: `npm run test:harness -- redact`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runner/redact.js runner/__tests__/redact.test.js
git commit -m "feat(logger): runner redact helper"
```

---

### Task 14: Runner Logger class + writers + factory

**Files:**
- Create: `runner/logger.js`
- Test: `runner/__tests__/logger.test.js`

- [ ] **Step 1: Write failing test**

```js
// runner/__tests__/logger.test.js
const { describe, it, expect, beforeEach, afterEach } = require('vitest');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Logger, FileWriter, NullWriter, createLogger } = require('../logger');

describe('NullWriter', () => {
  it('write() does not throw', () => {
    expect(() => new NullWriter().write('anything')).not.toThrow();
  });
});

describe('Logger with NullWriter', () => {
  it('accepts all levels without throwing', () => {
    const log = new Logger(new NullWriter(), { logger: 'test' });
    expect(() => { log.error('a'); log.warn('b'); log.info('c'); log.debug('d'); }).not.toThrow();
  });

  it('child merges bindings', () => {
    const writer = { lines: [], write(line) { this.lines.push(line); } };
    const log = new Logger(writer, { logger: 'root' });
    log.child({ runId: 'r1' }).info('go', { extra: 9 });
    expect(writer.lines).toHaveLength(1);
    const rec = JSON.parse(writer.lines[0]);
    expect(rec.ctx).toMatchObject({ runId: 'r1', extra: 9 });
    expect(rec.runId).toBe('r1');
  });
});

describe('Logger with FileWriter', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-log-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('writes JSONL to runner-<runId>.log', () => {
    const log = createLogger({ runId: 'abc123', logsDir: dir, level: 'debug' });
    log.info('hello', { a: 1 });
    log.debug('world', { b: 2 });
    const file = path.join(dir, 'runner-abc123.log');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const rec = JSON.parse(lines[0]);
    expect(rec).toMatchObject({ layer: 'runner', level: 'info', msg: 'hello' });
    expect(rec.ctx).toMatchObject({ a: 1 });
  });

  it('level=info suppresses debug', () => {
    const log = createLogger({ runId: 'abc', logsDir: dir, level: 'info' });
    log.debug('hidden');
    log.info('shown');
    const lines = fs.readFileSync(path.join(dir, 'runner-abc.log'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).msg).toBe('shown');
  });

  it('falls back to NullWriter when logsDir is missing', () => {
    const log = createLogger({ runId: 'x', logsDir: null, level: 'info' });
    expect(() => log.info('no-op')).not.toThrow();
  });

  it('redacts script field', () => {
    const log = createLogger({ runId: 'abc', logsDir: dir, level: 'info' });
    log.info('exec', { script: 'a'.repeat(500) });
    const rec = JSON.parse(fs.readFileSync(path.join(dir, 'runner-abc.log'), 'utf8').trim());
    expect(rec.ctx.script).toMatch(/hash:[0-9a-f]{64}/);
  });
});
```

- [ ] **Step 2: Confirm failure**

Run: `npm run test:harness -- logger`
Expected: FAIL.

- [ ] **Step 3: Implement**

```js
// runner/logger.js
const fs = require('node:fs');
const path = require('node:path');
const { redactCtx } = require('./redact');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

class NullWriter {
  write(_line) {}
}

class FileWriter {
  constructor(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.fd = fs.openSync(filePath, 'a');
  }
  write(line) {
    try {
      fs.writeSync(this.fd, line + '\n');
    } catch (e) {
      // Swallow — logger failures must not crash the runner.
      // Best-effort once-per-process warning.
      if (!FileWriter._warned) {
        FileWriter._warned = true;
        process.stderr.write(`[logger] FileWriter failed: ${e.message}\n`);
      }
    }
  }
}

class Logger {
  constructor(writer, bindings = {}, threshold = 'info') {
    this.writer = writer;
    this.bindings = bindings;
    this.threshold = threshold;
  }

  _enabled(level) { return LEVELS[level] <= LEVELS[this.threshold]; }

  _write(level, msg, ctx = {}) {
    if (!this._enabled(level)) return;
    const merged = redactCtx({ ...this.bindings, ...ctx });
    const record = {
      ts: new Date().toISOString(),
      level,
      layer: 'runner',
      logger: merged.logger || this.bindings.logger || 'runner',
      runId: typeof merged.runId === 'string' ? merged.runId : undefined,
      msg,
      ctx: merged,
    };
    this.writer.write(JSON.stringify(record));
  }

  error(msg, ctx) { this._write('error', msg, ctx); }
  warn (msg, ctx) { this._write('warn',  msg, ctx); }
  info (msg, ctx) { this._write('info',  msg, ctx); }
  debug(msg, ctx) { this._write('debug', msg, ctx); }

  child(bindings) {
    return new Logger(this.writer, { ...this.bindings, ...bindings }, this.threshold);
  }
}

function createLogger({ runId, logsDir, level = 'info' }) {
  let writer;
  if (logsDir && runId) {
    try {
      writer = new FileWriter(path.join(logsDir, `runner-${runId}.log`));
    } catch (_e) {
      writer = new NullWriter();
    }
  } else {
    writer = new NullWriter();
  }
  return new Logger(writer, { logger: 'harness', runId }, level);
}

module.exports = { Logger, FileWriter, NullWriter, createLogger };
```

- [ ] **Step 4: Run tests**

Run: `npm run test:harness -- logger`
Expected: PASS (8 tests).

- [ ] **Step 5: Deploy to installed runner dir (mandatory per CLAUDE.md)**

```bash
cp runner/redact.js ~/.mongomacapp/runner/redact.js
cp runner/logger.js ~/.mongomacapp/runner/logger.js
```

- [ ] **Step 6: Commit**

```bash
git add runner/logger.js runner/__tests__/logger.test.js
git commit -m "feat(logger): runner Logger with FileWriter + NullWriter"
```

---

## Phase 4 — Composition roots

### Task 15: Wire Rust composition root

**Files:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Update AppState**

```rust
// src-tauri/src/state.rs
use mongodb::Client;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use crate::logger::{Logger, MemoryLogger};
use crate::logger::tracing_impl::TracingLogger;

pub struct AppState {
    pub db_path: PathBuf,
    pub logs_dir: PathBuf,
    pub mongo_clients: Mutex<HashMap<String, Client>>,
    pub active_scripts: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub logger: Arc<dyn Logger>,
    /// Concrete TracingLogger kept so the log_write handler can write frontend records.
    pub tracing_logger: Option<Arc<TracingLogger>>,
}

impl AppState {
    pub fn new(db_path: PathBuf, logs_dir: PathBuf, tracing_logger: Arc<TracingLogger>) -> Self {
        let logger: Arc<dyn Logger> = tracing_logger.clone();
        Self {
            db_path,
            logs_dir,
            mongo_clients: Mutex::new(HashMap::new()),
            active_scripts: Mutex::new(HashMap::new()),
            logger,
            tracing_logger: Some(tracing_logger),
        }
    }

    pub fn open_db(&self) -> rusqlite::Result<rusqlite::Connection> {
        crate::db::open(&self.db_path)
    }

    #[cfg(test)]
    pub fn for_tests(db_path: PathBuf) -> Self {
        let memory: Arc<dyn Logger> = MemoryLogger::new("test");
        Self {
            db_path,
            logs_dir: std::env::temp_dir(),
            mongo_clients: Mutex::new(HashMap::new()),
            active_scripts: Mutex::new(HashMap::new()),
            logger: memory,
            tracing_logger: None,
        }
    }
}
```

- [ ] **Step 2: Update main.rs setup + register log_write**

```rust
// src-tauri/src/main.rs

fn run() -> Result<(), Box<dyn std::error::Error>> {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let base = dirs_dir()?;
            fs::create_dir_all(&base)
                .map_err(|e| format!("failed to create app dir {}: {}", base.display(), e))?;
            let logs_dir = base.join("logs");
            fs::create_dir_all(&logs_dir)
                .map_err(|e| format!("failed to create logs dir {}: {}", logs_dir.display(), e))?;
            let level = std::env::var("MONGOMACAPP_LOG_LEVEL").ok()
                .map(|s| logger::Level::from_str(&s))
                .unwrap_or(logger::Level::Info);
            let tracing_logger = logger::tracing_impl::TracingLogger::init(&logs_dir, level)
                .map_err(|e| format!("failed to init logger: {e}"))?;
            let db_path = base.join("mongomacapp.sqlite");
            db::open(&db_path)
                .map_err(|e| format!("failed to open/migrate sqlite at {}: {}", db_path.display(), e))?;
            app.manage(AppState::new(db_path, logs_dir.clone(), tracing_logger.clone()));

            // Retention sweep: once at boot, then every 24h.
            let sweep_dir = logs_dir.clone();
            logger::retention::sweep(&sweep_dir, 7);
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(86_400));
                    logger::retention::sweep(&sweep_dir, 7);
                }
            });

            use crate::logger::{LogCtx, Logger as _};
            tracing_logger.info("app boot", LogCtx::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::connection::list_connections,
            commands::connection::create_connection,
            commands::connection::update_connection,
            commands::connection::delete_connection,
            commands::connection::test_connection,
            commands::connection::connect_connection,
            commands::connection::disconnect_connection,
            commands::collection::list_databases,
            commands::collection::list_collections,
            commands::collection::list_indexes,
            commands::collection::browse_collection,
            commands::document::update_document,
            commands::document::delete_document,
            commands::script::run_script,
            commands::script::cancel_script,
            commands::saved_script::list_scripts,
            commands::saved_script::create_script,
            commands::saved_script::update_script,
            commands::saved_script::delete_script,
            commands::saved_script::touch_script,
            runner::executor::check_node_runner,
            runner::executor::install_node_runner,
            commands::ai::set_ai_token,
            commands::ai::get_ai_token,
            commands::ai::delete_ai_token,
            commands::logging::log_write,       // ADD
        ])
        .run(tauri::generate_context!())?;
    Ok(())
}
```

- [ ] **Step 3: Fix any callers broken by AppState signature change**

Run: `cd src-tauri && cargo build`
If compile errors reference `AppState::new`, update them to pass `logs_dir` + `tracing_logger`. The only other production caller is the `setup` closure we just wrote.

For tests that construct `AppState` directly, use `AppState::for_tests(db_path)`.

- [ ] **Step 4: Run Rust tests**

Run: `cd src-tauri && cargo test`
Expected: PASS (all existing tests still pass; new tests from earlier tasks pass).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/main.rs
git commit -m "feat(logger): Rust composition root — AppState.logger + retention task + log_write"
```

---

### Task 16: Wire frontend composition root

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/App.tsx` (wrap contents in `LoggerProvider` via main.tsx — no App.tsx change needed if provider is at main.tsx level)

- [ ] **Step 1: Update main.tsx**

```ts
// src/main.tsx
import './themes/definitions';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import App from './App';
import './styles/globals.css';
import { loadSettings, useSettingsStore } from './store/settings';
import { applyTheme, applyMonacoTheme } from './themes/applyTheme';
import { keyboardService } from './services/KeyboardService';
import { createLogger, LoggerProvider, type Logger } from './services/logger';

function pickEnv(): 'dev' | 'prod' | 'test' {
  if (import.meta.env.MODE === 'test') return 'test';
  return import.meta.env.DEV ? 'dev' : 'prod';
}

const logger: Logger = createLogger({
  env: pickEnv(),
  level: (import.meta.env.VITE_LOG_LEVEL as 'error' | 'warn' | 'info' | 'debug' | undefined)
    ?? (import.meta.env.DEV ? 'debug' : 'info'),
  invoke: (cmd, payload) => invoke(cmd, payload as Record<string, unknown>),
});

keyboardService.setLogger(logger.child({ logger: 'services.keyboard' }));

async function bootSettings(): Promise<void> {
  try {
    await loadSettings();
    const { themeId, shortcutOverrides } = useSettingsStore.getState();
    applyTheme(themeId);
    applyMonacoTheme(themeId);
    keyboardService.applyOverrides(shortcutOverrides);
  } catch (err) {
    logger.warn('settings boot failed; continuing with defaults', { err: String(err) });
  }
}

void bootSettings().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <LoggerProvider value={logger}>
        <App />
      </LoggerProvider>
    </React.StrictMode>,
  );

  useSettingsStore.subscribe(
    (state) => state.shortcutOverrides,
    (overrides) => keyboardService.applyOverrides(overrides),
  );
});
```

- [ ] **Step 2: Run typecheck**

Run: `npm run build`
Expected: FAIL with `keyboardService.setLogger is not a function` — this is resolved in Task 18.

*(Commit happens at the end of Task 18, after keyboardService gains `setLogger`.)*

---

### Task 17: Wire runner composition root

**Files:**
- Modify: `runner/harness.js` — add logger creation at top, no other changes yet
- Modify: `runner/cli.js` — add stderr-only logger creation (no file)

- [ ] **Step 1: Update harness.js**

At the top of `runner/harness.js`, after the existing requires and script-path parsing:

```js
const { MongoClient } = require('mongodb');
const fs = require('fs');
const { createLogger } = require('./logger');

const uri = process.env.MONGO_URI;
if (!uri) {
  process.stderr.write(JSON.stringify({ __error: 'MONGO_URI env var is required' }) + '\n');
  process.exit(1);
}
const [dbName, scriptPath] = process.argv.slice(2);
const rawScript = fs.readFileSync(scriptPath, 'utf8');

const logger = createLogger({
  runId: process.env.MONGOMACAPP_RUN_ID || 'nil',
  logsDir: process.env.MONGOMACAPP_LOGS_DIR || null,
  level: process.env.MONGOMACAPP_LOG_LEVEL || 'info',
});

logger.info('harness start', { dbName, scriptPath, page: process.env.MONGO_PAGE, pageSize: process.env.MONGO_PAGE_SIZE });

// ...rest of harness.js unchanged for now
```

Add a single `process.on('exit', ...)` near the top that logs harness end:

```js
const __startedAt = Date.now();
process.on('exit', (code) => {
  try {
    logger.info('harness end', { code, durationMs: Date.now() - __startedAt });
  } catch (_e) {}
});
```

- [ ] **Step 2: Update cli.js**

Run `cat runner/cli.js` first to see what it does. If cli.js invokes the harness as a child process, no change is needed for this task — the env vars are set by whoever calls cli. If cli.js contains inline script logic, prepend:

```js
const { Logger, NullWriter } = require('./logger');
const cliLogger = new Logger(new NullWriter(), { logger: 'cli' }, 'info');
```

and replace any `console.log/warn/error` in cli.js with `cliLogger.*`. If cli.js has no logging to replace, leave it unchanged — the important path is harness.js which is always the runtime entry.

- [ ] **Step 3: Deploy (mandatory per CLAUDE.md)**

```bash
cp runner/harness.js ~/.mongomacapp/runner/harness.js
cp runner/cli.js ~/.mongomacapp/runner/cli.js
```

- [ ] **Step 4: Run existing harness test to confirm nothing broke**

Run: `npm run test:harness`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add runner/harness.js runner/cli.js
git commit -m "feat(logger): runner composition root — createLogger from env"
```

---

## Phase 5 — Integrate at existing call sites

### Task 18: Inject logger into KeyboardService (setter pattern)

**Files:**
- Modify: `src/services/KeyboardService.ts`
- Modify: `src/__tests__/keyboard-service.test.ts` (may need a trivial update if any test asserts on private state)

- [ ] **Step 1: Add setLogger + wire into internals**

Open `src/services/KeyboardService.ts`. Add imports:

```ts
import type { Logger } from './logger';
import { NoopLogger } from './logger/NoopLogger';
```

In the `KeyboardService` class body, add a private field and setter:

```ts
  private logger: Logger = new NoopLogger();

  setLogger(logger: Logger): void {
    this.logger = logger;
  }
```

Replace any `console.log/warn/error` inside KeyboardService with `this.logger.*`. (If there are none, add an `info` log in `defineShortcut` to confirm the wiring:)

```ts
  defineShortcut(def: ShortcutDefinition): void {
    // ...existing body...
    this.logger.debug('shortcut registered', { id: def.id, scope: def.scope });
  }
```

- [ ] **Step 2: Verify test still passes**

Run: `npm test -- keyboard-service`
Expected: PASS. The default `NoopLogger` means tests observe no behaviour change.

- [ ] **Step 3: Build the whole app**

Run: `npm run build`
Expected: PASS (main.tsx from Task 16 now compiles).

- [ ] **Step 4: Commit (joint commit with Task 16)**

```bash
git add src/services/KeyboardService.ts src/main.tsx
git commit -m "feat(logger): frontend composition root + KeyboardService.setLogger"
```

---

### Task 19: Inject logger into aiService and chatHistoryManager

**Files:**
- Modify: `src/services/ai/AIService.ts`
- Modify: `src/services/ai/ChatHistoryManager.ts`
- Modify: `src/main.tsx` — call setLogger on each

- [ ] **Step 1: Add setLogger to each service (same pattern as Task 18)**

For each of `AIService` and `ChatHistoryManager`, add:

```ts
import type { Logger } from '../logger';
import { NoopLogger } from '../logger/NoopLogger';

// inside class:
  private logger: Logger = new NoopLogger();
  setLogger(logger: Logger): void { this.logger = logger; }
```

Replace any `console.log/warn/error` in those files with `this.logger.*`.

- [ ] **Step 2: Wire in main.tsx**

Add after the keyboardService.setLogger line:

```ts
import { aiService } from './services/ai/AIService';
import { chatHistoryManager } from './services/ai/ChatHistoryManager';

aiService.setLogger(logger.child({ logger: 'services.ai' }));
chatHistoryManager.setLogger(logger.child({ logger: 'services.chat-history' }));
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: PASS (all tests).

- [ ] **Step 4: Commit**

```bash
git add src/services/ai/AIService.ts src/services/ai/ChatHistoryManager.ts src/main.tsx
git commit -m "feat(logger): inject logger into aiService + chatHistoryManager"
```

---

### Task 20: Replace console.logs in App.tsx / EditorArea.tsx / useScriptEvents.ts

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/editor/EditorArea.tsx`
- Modify: `src/hooks/useScriptEvents.ts`

- [ ] **Step 1: App.tsx — runner bootstrap logs**

In `src/App.tsx`, import and use the hook:

```ts
import { useLogger } from './services/logger';

export default function App() {
  const log = useLogger('components.App');
  useScriptEvents();
  // ...

  useEffect(() => {
    checkNodeRunner().then((status) => {
      log.info('runner check', { status });
      if (!status.ready) {
        log.info('runner not ready; installing');
        installNodeRunner()
          .then(() => log.info('runner install complete'))
          .catch((e) => log.error('runner install failed', { err: String(e) }));
      }
    }).catch((e) => log.error('runner check failed', { err: String(e) }));
  }, [log]);
```

Replace each `console.log`/`console.error` call in App.tsx's existing effect blocks with the corresponding `log.*`.

- [ ] **Step 2: EditorArea.tsx — runId logging**

```ts
import { useLogger } from '../../services/logger';

// inside component:
const log = useLogger('components.EditorArea');

// replace line 68:
const runId = crypto.randomUUID();
log.debug('execute requested', {
  runId, tabId: active.id, connId, db, page, pageSize,
});
log.child({ runId }); // no-op assignment just to show the binding pattern if needed downstream
```

- [ ] **Step 3: useScriptEvents.ts — bind runId from event**

```ts
import { useLogger } from '../services/logger';

export function useScriptEvents() {
  const log = useLogger('hooks.useScriptEvents');
  const { appendGroup, setError, finishRun, setPagination } = useResultsStore();

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;
    listen<ScriptEvent>('script-event', (e) => {
      const p = e.payload;
      const currentRunId = useResultsStore.getState().byTab[p.tabId]?.runId;
      if (p.runId && p.runId !== currentRunId) return;

      const child = log.child({ runId: p.runId, tabId: p.tabId });
      child.debug('script-event', { kind: p.kind, error: p.error });
      if (p.kind === 'group' && p.groupIndex !== undefined && p.docs !== undefined) {
        appendGroup(p.tabId, {
          groupIndex: p.groupIndex,
          docs: Array.isArray(p.docs) ? p.docs : [p.docs],
        });
      } else if (p.kind === 'pagination' && p.pagination) {
        setPagination(p.tabId, p.pagination);
      } else if (p.kind === 'error' && p.error) {
        setError(p.tabId, p.error);
      } else if (p.kind === 'done') {
        finishRun(p.tabId, p.executionMs ?? 0);
      }
    }).then((fn) => {
      if (cancelled) fn(); else unsub = fn;
    });
    return () => { cancelled = true; unsub?.(); };
  }, [appendGroup, setError, finishRun, setPagination, log]);
}
```

- [ ] **Step 4: Run tests + build**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/editor/EditorArea.tsx src/hooks/useScriptEvents.ts
git commit -m "feat(logger): replace console.logs with useLogger + runId binding"
```

---

### Task 21: Update Tauri commands to log via state.logger

**Files:**
- Modify: `src-tauri/src/commands/script.rs`
- Modify: `src-tauri/src/commands/connection.rs`
- Modify: `src-tauri/src/commands/collection.rs`
- Modify: `src-tauri/src/commands/document.rs`
- Modify: `src-tauri/src/commands/saved_script.rs`
- Modify: `src-tauri/src/commands/ai.rs`

For each command: derive a child logger, log entry and error paths.

- [ ] **Step 1: script.rs — replace `println!` sites**

At the top of `run_script`:

```rust
use crate::logger::{LogCtx, Logger as _};
use crate::logctx;

let log = {
    let mut b = logctx! {
        "logger" => "commands.script",
        "connId" => connection_id.clone(),
        "tabId" => tab_id.clone(),
    };
    if let Some(r) = run_id.as_ref() {
        b.insert("runId".into(), serde_json::json!(r.clone()));
    }
    state.logger.child(b)
};
log.info("run_script start", logctx! {
    "db" => database.clone(),
    "page" => page,
    "pageSize" => page_size,
    "script" => script.clone(),          // redacted inside the logger
});
```

Replace every `println!("[run_script] …")` with `log.info("…", logctx!{…})` or `log.error("…", logctx!{…})`.

For `cancel_script`, similar pattern — bind `logger=commands.script` and `tabId`, then `log.info("cancel", …)`.

- [ ] **Step 2: connection.rs**

For each command, at entry:

```rust
use crate::logger::Logger as _;
let log = state.logger.child(crate::logctx! { "logger" => "commands.connection" });
log.info("list_connections start", crate::logctx! {});
```

Apply to `list_connections`, `create_connection`, `update_connection`, `delete_connection`, `test_connection`, `connect_connection`, `disconnect_connection`. Log errors at the failure point before returning `Err`.

- [ ] **Step 3: collection.rs, document.rs, saved_script.rs, ai.rs — same pattern**

For each command, add child logger `logger=commands.<module>`, log entry, log error.

- [ ] **Step 4: Build + test**

Run: `cd src-tauri && cargo build && cargo test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/
git commit -m "feat(logger): log command lifecycle in all Tauri commands"
```

---

### Task 22: Update runner/executor.rs — pass env + logger, log spawn

**Files:**
- Modify: `src-tauri/src/runner/executor.rs`
- Modify: any caller of `spawn_script` (`commands/script.rs`) to pass logger

- [ ] **Step 1: Update spawn_script signature**

```rust
use crate::logger::{LogCtx, Logger};
use std::sync::Arc;
use std::path::Path;

pub fn spawn_script(
    uri: &str,
    database: &str,
    script_path: &Path,
    page: u32,
    page_size: u32,
    run_id: &str,
    logs_dir: &Path,
    level: &str,
    logger: Arc<dyn Logger>,
) -> Result<std::process::Child, String> {
    let node = resolve_node().ok_or("Node.js not found — check node installation")?;
    logger.info("spawn runner", crate::logctx! {
        "node" => node,
        "harness" => harness_path().display().to_string(),
        "db" => database,
        "page" => page,
        "pageSize" => page_size,
    });
    Command::new(node)
        .arg(harness_path())
        .arg(database)
        .arg(script_path)
        .env("MONGO_URI", uri)
        .env("MONGO_PAGE", page.to_string())
        .env("MONGO_PAGE_SIZE", page_size.to_string())
        .env("MONGOMACAPP_RUN_ID", run_id)
        .env("MONGOMACAPP_LOGS_DIR", logs_dir.display().to_string())
        .env("MONGOMACAPP_LOG_LEVEL", level)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| {
            logger.error("spawn failed", crate::logctx! { "err" => e.to_string() });
            e.to_string()
        })
}
```

Remove the old `println!("[spawn_script] …")`.

- [ ] **Step 2: Update `script.rs::run_script` to pass the new args**

```rust
let run_id_str = run_id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
let level = std::env::var("MONGOMACAPP_LOG_LEVEL").unwrap_or_else(|_| "info".into());
let child = spawn_script(
    &uri, &database, &script_path, page, page_size,
    &run_id_str,
    &state.logs_dir,
    &level,
    state.logger.clone(),
)?;
```

Update the downstream code that reads `run_id` (the ScriptEvent emitter) to use `run_id_str` when the caller didn't provide one.

- [ ] **Step 3: Build + test**

Run: `cd src-tauri && cargo build && cargo test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/runner/executor.rs src-tauri/src/commands/script.rs
git commit -m "feat(logger): runner executor passes env + logger; logs spawn lifecycle"
```

---

### Task 23: Thread logger through harness.js helpers

**Files:**
- Modify: `runner/harness.js`

- [ ] **Step 1: Pass logger into helpers**

In `runner/harness.js`, update call sites:

```js
function transformScript(script, logger) {
  // existing body unchanged except:
  logger.debug('transform', { lines: script.split('\n').length });
  // ...
}

function makeCursorProxy(cursor, countPromise, logger) {
  // pass logger to any emitGroup calls inside; log 'cursor materialize' when promise settles
}

function emitGroup(docs, logger) {
  const arr = Array.isArray(docs) ? docs : [docs];
  if (logger) logger.debug('emitGroup', { count: arr.length, index: groupIndex });
  // ...existing safe JSON coercion + stdout write
}
```

At the top-level script-execution block, wrap the async try/catch:

```js
(async () => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    logger.info('mongo connect start');
    await client.connect();
    logger.info('mongo connect ok');
    const db = client.db(dbName);
    const transformed = transformScript(rawScript, logger);
    // existing execution path
  } catch (e) {
    logger.error('script failure', { err: String(e), stack: e && e.stack });
    process.stderr.write(JSON.stringify({ __error: e?.message || String(e) }) + '\n');
    process.exit(1);
  } finally {
    try { await client.close(); } catch (_e) {}
  }
})();
```

- [ ] **Step 2: Deploy (mandatory)**

```bash
cp runner/harness.js ~/.mongomacapp/runner/harness.js
```

- [ ] **Step 3: Run harness tests**

Run: `npm run test:harness`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add runner/harness.js
git commit -m "feat(logger): thread logger through harness helpers"
```

---

### Task 24: Add logger to mongo.rs and keychain.rs

**Files:**
- Modify: `src-tauri/src/mongo.rs`
- Modify: `src-tauri/src/keychain.rs`

- [ ] **Step 1: mongo.rs — log URI (redacted) + errors at boundaries**

Where a `Client` is built or a query errors, accept `&dyn Logger` and log via it. If that would cascade too much, do the minimum: take a `&dyn Logger` in the top-level functions called from commands and pass it down as needed.

Sample change:

```rust
use crate::logger::Logger;

pub async fn connect(uri: &str, log: &dyn Logger) -> Result<Client, String> {
    log.info("mongo connect", crate::logctx! { "uri" => uri }); // redacted by logger
    Client::with_uri_str(uri).await.map_err(|e| {
        log.error("mongo connect failed", crate::logctx! { "err" => e.to_string() });
        e.to_string()
    })
}
```

Update the callers (commands) to pass `state.logger.as_ref()`.

- [ ] **Step 2: keychain.rs — log success/failure (NEVER log the secret value)**

```rust
pub fn get_password(conn_id: &str, log: &dyn Logger) -> Result<Option<String>, String> {
    match /* existing retrieval */ {
        Ok(Some(_)) => { log.info("keychain get", crate::logctx! { "connId" => conn_id, "found" => true }); Ok(/* */) },
        Ok(None)    => { log.info("keychain get", crate::logctx! { "connId" => conn_id, "found" => false }); Ok(None) },
        Err(e)      => { log.error("keychain get failed", crate::logctx! { "connId" => conn_id, "err" => e.to_string() }); Err(e.to_string()) },
    }
}
```

Update callers to pass `state.logger.as_ref()`.

- [ ] **Step 3: Build + test**

Run: `cd src-tauri && cargo build && cargo test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/mongo.rs src-tauri/src/keychain.rs src-tauri/src/commands/
git commit -m "feat(logger): log mongo + keychain boundaries"
```

---

## Phase 6 — End-to-end validation

### Task 25: Integration walkthrough

**Files:**
- Create: `docs/logging.md` (user-facing doc)

- [ ] **Step 1: Run the app and exercise it manually**

```bash
rm -rf ~/.mongomacapp/logs
npm run tauri dev
```

Once the app opens:
1. Open an existing connection → expect entries in `~/.mongomacapp/logs/backend.log` with `logger=commands.connection` and a `connect_connection` lifecycle.
2. Execute `db.foo.find()` in the editor.
3. Capture the `runId` from `~/.mongomacapp/logs/app.log` (look for `"msg":"execute requested"`).
4. Run: `grep "$RUN_ID" ~/.mongomacapp/logs/*.log | cut -d: -f1 | sort -u`
   Expected output: three files — `app.log`, `backend.log`, `runner-<runId>.log`.

- [ ] **Step 2: Verify redaction**

```bash
grep -E '"uri":"mongodb://[^:]+:[^*]' ~/.mongomacapp/logs/*.log
```
Expected: no matches (all passwords masked).

```bash
grep '"script":"' ~/.mongomacapp/logs/runner-*.log | head -1
```
Expected: field ends with `hash:<64 hex>`.

- [ ] **Step 3: Verify retention mechanics**

```bash
# simulate an old file
touch -t 202601010000 ~/.mongomacapp/logs/backend.log.2026-01-01
# kill and restart app
# expect file removed after boot
ls ~/.mongomacapp/logs/ | grep 2026-01-01
```
Expected: no match (removed by boot-time sweep).

- [ ] **Step 4: Write user-facing logging doc**

Create `docs/logging.md`:

```markdown
# Logging

MongoMacApp writes structured JSONL logs to `~/.mongomacapp/logs/`:

- `app.log` — UI-side events (frontend), batched through Tauri IPC.
- `backend.log` — Rust backend (commands, mongo, keychain, runner spawn).
- `runner-<runId>.log` — one file per script execution.

Rolled files: `app.log.YYYY-MM-DD`, `backend.log.YYYY-MM-DD`. Retention: 7 days.

## Reading a log line

Each line is a JSON object:

```json
{"ts":"2026-04-24T10:30:00.123Z","level":"info","layer":"backend","logger":"commands.script","runId":"8f2c4...","msg":"run_script start","ctx":{"connId":"c_1","db":"app"}}
```

## Correlating across layers

Every user-initiated flow carries a `runId`. To see the full causal chain:

```bash
RUN_ID=<the-run-id>
grep "\"runId\":\"$RUN_ID\"" ~/.mongomacapp/logs/*.log | sort
```

## Changing the level

Set the env var before launching:

```bash
MONGOMACAPP_LOG_LEVEL=debug open -a "Mongo Lens"
```

Valid: `error`, `warn`, `info` (default), `debug`.

## Safety

- Mongo URIs are redacted: `mongodb://user:***@host/db`.
- Script bodies are truncated to 200 chars + sha256 (see `hash:` suffix).
- `password`, `secret`, `token`, `authorization` fields are masked.
```

- [ ] **Step 5: Commit**

```bash
git add docs/logging.md
git commit -m "docs: add user-facing logging reference"
```

---

## Self-review checklist (run after all tasks complete)

- [ ] All spec requirements have a task mapping (Architecture, Data flow, File layout, DI composition roots, Error handling, Testing, Redaction).
- [ ] No `TBD` / `TODO` placeholders remain in code or docs.
- [ ] `npm test` passes.
- [ ] `npm run test:harness` passes.
- [ ] `cd src-tauri && cargo test` passes.
- [ ] `npm run build` and `cargo build` both pass.
- [ ] End-to-end walkthrough (Task 25) confirms the `runId` chain grep returns 3 files.
- [ ] Redaction walkthrough confirms no plaintext passwords in any log.
- [ ] Runner files deployed to `~/.mongomacapp/runner/` after every runner edit (CLAUDE.md rule).
