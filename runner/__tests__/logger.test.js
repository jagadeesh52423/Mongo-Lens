import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
const { Logger, FileWriter, NullWriter, createLogger } = require(path.resolve(__dirname, '..', 'logger.js'));

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

  // M-1: a ctx that JSON.stringify cannot serialize (circular ref, BigInt,
  // throwing toJSON) must NOT crash the runner. The logger swallows the
  // failure and emits a fallback record so the rest of the run continues.
  it('does not throw on a circular reference in ctx', () => {
    const log = createLogger({ runId: 'circ', logsDir: dir, level: 'info' });
    const a = { name: 'a' };
    a.self = a;
    expect(() => log.info('cycle', { a })).not.toThrow();
    const file = path.join(dir, 'runner-circ.log');
    expect(fs.existsSync(file)).toBe(true);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    // At least one line emitted (the fallback). Each line must be parseable JSON.
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    // The fallback record marks the failure so it's grep-able.
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.msg).toBe('cycle');
    expect(last.stringifyError).toBeDefined();
  });

  it('does not throw on a BigInt in ctx', () => {
    const log = createLogger({ runId: 'bi', logsDir: dir, level: 'info' });
    expect(() => log.info('big', { n: 9007199254740993n })).not.toThrow();
    const file = path.join(dir, 'runner-bi.log');
    expect(fs.existsSync(file)).toBe(true);
  });

  it('does not throw when toJSON throws', () => {
    const log = createLogger({ runId: 'tj', logsDir: dir, level: 'info' });
    const bad = { toJSON() { throw new Error('boom'); } };
    expect(() => log.info('thrower', { bad })).not.toThrow();
  });
});
