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
    // Spec §Error handling: "Logger failures must never crash the app." Wrap
    // the entire record-assembly path so a circular ref / BigInt / throwing
    // toJSON / throwing getter on bindings drops the record instead of
    // bubbling. Emit one stderr warn per process so the failure isn't
    // invisible, then keep the runner alive.
    let line;
    try {
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
      line = JSON.stringify(record);
    } catch (e) {
      if (!Logger._crashWarned) {
        Logger._crashWarned = true;
        process.stderr.write(`[logger] record assembly failed: ${e && e.message || e}\n`);
      }
      return;
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

// One-shot guard so we warn once per process about a stringify/redact failure
// and stay quiet thereafter. Static, not instance — shared across child loggers.
Logger._crashWarned = false;

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
