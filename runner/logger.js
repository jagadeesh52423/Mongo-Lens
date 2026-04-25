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
    let line;
    try {
      line = JSON.stringify(record);
    } catch (e) {
      // Logger failures must not crash the runner. JSON.stringify can throw on
      // circular references, BigInt values, or a thrown toJSON. Drop the bad
      // ctx and emit a minimal fallback record so the run continues and the
      // failure is grep-able.
      const fallback = {
        ts: record.ts,
        level: record.level,
        layer: record.layer,
        logger: record.logger,
        runId: record.runId,
        msg: record.msg,
        stringifyError: String(e && e.message || e),
      };
      try {
        line = JSON.stringify(fallback);
      } catch (_e2) {
        // Fallback is built from primitives only, so this branch is
        // theoretically unreachable — but defend anyway: anything we write
        // must be a single line of valid JSON.
        line = '{"level":"error","layer":"runner","msg":"logger stringify failed"}';
      }
    }
    this.writer.write(line);
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
