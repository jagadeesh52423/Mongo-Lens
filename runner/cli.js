#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const DEFAULT_URI = 'mongodb://localhost:27017';
const DEFAULT_PAGE = '0';
const DEFAULT_PAGE_SIZE = '10';

function printUsage() {
  process.stderr.write(
    'Usage: node runner/cli.js --db <database> --file <query-file> ' +
    '[--uri mongodb://localhost:27017] [--page 0] [--page-size 10] [--debug]\n',
  );
}

function parseArgs(argv) {
  const args = {
    db: null,
    file: null,
    uri: DEFAULT_URI,
    page: DEFAULT_PAGE,
    pageSize: DEFAULT_PAGE_SIZE,
    debug: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--db':
        args.db = argv[++i];
        break;
      case '--file':
        args.file = argv[++i];
        break;
      case '--uri':
        args.uri = argv[++i];
        break;
      case '--page':
        args.page = argv[++i];
        break;
      case '--page-size':
        args.pageSize = argv[++i];
        break;
      case '--debug':
        args.debug = true;
        break;
      default:
        process.stderr.write(`Unknown argument: ${arg}\n`);
        printUsage();
        process.exit(1);
    }
  }
  return args;
}

const state = { lastGroupSize: 0 };

function formatGroup(msg) {
  const { __group: idx, docs } = msg;
  const arr = Array.isArray(docs) ? docs : [docs];
  state.lastGroupSize = arr.length;
  let out = `[group ${idx}] ${arr.length} docs\n`;
  for (const doc of arr) {
    out += JSON.stringify(doc, null, 2) + '\n';
  }
  return out;
}

function formatPagination(msg) {
  const { total, page, pageSize } = msg.__pagination;
  return `\nPage ${page} · showing ${state.lastGroupSize} of ${total} · page size ${pageSize}\n`;
}

function handleLine(line, debug) {
  if (!line) return 0;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (_e) {
    process.stdout.write(line + '\n');
    return 0;
  }
  if (msg.__error !== undefined) {
    const lineInfo = msg.line != null ? ` (line ${msg.line})` : '';
    process.stderr.write(`Error: ${msg.__error}${lineInfo}\n`);
    return 1;
  }
  if (msg.__debug !== undefined) {
    if (debug) process.stderr.write(msg.__debug + '\n');
    return 0;
  }
  if (msg.__group !== undefined) {
    process.stdout.write(formatGroup(msg));
    return 0;
  }
  if (msg.__pagination !== undefined) {
    process.stdout.write(formatPagination(msg));
    return 0;
  }
  process.stdout.write(line + '\n');
  return 0;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.db || !args.file) {
    process.stderr.write('Error: --db and --file are required\n');
    printUsage();
    process.exit(1);
  }

  const harnessPath = path.resolve(__dirname, 'harness.js');
  const child = spawn(
    process.execPath,
    [harnessPath, args.db, args.file],
    {
      env: {
        ...process.env,
        MONGO_URI: args.uri,
        MONGO_PAGE: args.page,
        MONGO_PAGE_SIZE: args.pageSize,
        NODE_PATH: require('os').homedir() + '/.mongomacapp/runner/node_modules',
      },
      stdio: ['inherit', 'pipe', 'pipe'],
    },
  );

  let exitCode = 0;

  const stdoutRl = readline.createInterface({ input: child.stdout });
  stdoutRl.on('line', (line) => {
    const rc = handleLine(line, args.debug);
    if (rc !== 0) exitCode = rc;
  });

  const stderrRl = readline.createInterface({ input: child.stderr });
  stderrRl.on('line', (line) => {
    const rc = handleLine(line, args.debug);
    if (rc !== 0) exitCode = rc;
  });

  child.on('close', (code) => {
    process.exit(code !== 0 ? code : exitCode);
  });

  child.on('error', (err) => {
    process.stderr.write(`Failed to start harness: ${err.message}\n`);
    process.exit(1);
  });
}

main();
