import { describe, it, expect } from 'vitest';
import { resolveEffective, type GlobalPrefs } from '../overrides';

const GLOBAL: GlobalPrefs = {
  intelliShell: {
    commandTimeoutMs: 30000,
    autoCompleteEnabled: true,
    printLimit: 1000,
  },
  tools: {
    mongodumpPath: '/usr/bin/mongodump',
    mongorestorePath: '/usr/bin/mongorestore',
    mongoexportPath: '/usr/bin/mongoexport',
    mongoimportPath: '/usr/bin/mongoimport',
  },
  advanced: {
    appName: 'mongo-lens',
    retryWrites: true,
    retryReads: true,
    compressors: ['snappy'],
    serverSelectionTimeoutMs: 30000,
    connectTimeoutMs: 10000,
    socketTimeoutMs: 0,
  },
};

describe('resolveEffective', () => {
  it('returns global when no overrides at all', () => {
    expect(resolveEffective(GLOBAL, undefined)).toEqual(GLOBAL);
  });

  it('returns global when overrides is empty object', () => {
    expect(resolveEffective(GLOBAL, {})).toEqual(GLOBAL);
  });

  it('returns global when individual blocks are empty', () => {
    expect(
      resolveEffective(GLOBAL, { intelliShell: {}, tools: {}, advanced: {} }),
    ).toEqual(GLOBAL);
  });

  it('per-field override applies', () => {
    const effective = resolveEffective(GLOBAL, {
      intelliShell: { commandTimeoutMs: 5000 },
    });
    expect(effective.intelliShell.commandTimeoutMs).toBe(5000);
    expect(effective.intelliShell.autoCompleteEnabled).toBe(true); // inherited
    expect(effective.intelliShell.printLimit).toBe(1000); // inherited
  });

  it('undefined means inherit (not "set to undefined")', () => {
    const effective = resolveEffective(GLOBAL, {
      intelliShell: { commandTimeoutMs: undefined },
    });
    expect(effective.intelliShell.commandTimeoutMs).toBe(30000);
  });

  it('false is distinct from undefined and does override', () => {
    const effective = resolveEffective(GLOBAL, {
      advanced: { retryWrites: false },
    });
    expect(effective.advanced.retryWrites).toBe(false);
    expect(effective.advanced.retryReads).toBe(true); // inherited
  });

  it('zero is distinct from undefined and does override', () => {
    const effective = resolveEffective(GLOBAL, {
      intelliShell: { printLimit: 0 },
    });
    expect(effective.intelliShell.printLimit).toBe(0);
  });

  it('array override replaces, does not merge', () => {
    const effective = resolveEffective(GLOBAL, {
      advanced: { compressors: ['zstd'] },
    });
    expect(effective.advanced.compressors).toEqual(['zstd']);
  });

  it('empty-array override replaces with empty', () => {
    const effective = resolveEffective(GLOBAL, {
      advanced: { compressors: [] },
    });
    expect(effective.advanced.compressors).toEqual([]);
  });

  it('overrides multiple blocks simultaneously', () => {
    const effective = resolveEffective(GLOBAL, {
      intelliShell: { commandTimeoutMs: 1000 },
      tools: { mongodumpPath: '/opt/mongodump' },
      advanced: { appName: 'custom' },
    });
    expect(effective.intelliShell.commandTimeoutMs).toBe(1000);
    expect(effective.tools.mongodumpPath).toBe('/opt/mongodump');
    expect(effective.advanced.appName).toBe('custom');
    // Untouched fields still inherit
    expect(effective.tools.mongorestorePath).toBe('/usr/bin/mongorestore');
    expect(effective.advanced.retryWrites).toBe(true);
  });

  it('does not mutate the input global object', () => {
    const snapshot = JSON.parse(JSON.stringify(GLOBAL));
    resolveEffective(GLOBAL, { intelliShell: { commandTimeoutMs: 1 } });
    expect(GLOBAL).toEqual(snapshot);
  });

  it('does not mutate the input overrides object', () => {
    const overrides = { intelliShell: { commandTimeoutMs: 1 } };
    const snapshot = JSON.parse(JSON.stringify(overrides));
    resolveEffective(GLOBAL, overrides);
    expect(overrides).toEqual(snapshot);
  });
});
