// Per-field override resolution for connection-scoped preferences.
//
// GlobalPrefs holds fully-populated defaults; per-connection `overrides`
// shadow individual fields. `undefined` means "inherit from global" — it
// never overwrites the global value with undefined. `false`, `0`, and
// empty-string ARE distinct from undefined and DO override.
//
// Arrays replace wholesale; they do not merge.

import type {
  IntelliShellOverrides,
  ToolsOverrides,
  AdvancedOverrides,
} from './model';

export interface GlobalPrefs {
  intelliShell: Required<IntelliShellOverrides>;
  tools: Required<ToolsOverrides>;
  advanced: Required<AdvancedOverrides>;
}

export interface EffectivePrefs {
  intelliShell: Required<IntelliShellOverrides>;
  tools: Required<ToolsOverrides>;
  advanced: Required<AdvancedOverrides>;
}

export interface ConnectionOverrides {
  intelliShell?: IntelliShellOverrides;
  tools?: ToolsOverrides;
  advanced?: AdvancedOverrides;
}

function mergeBlock<T extends object>(
  global: T,
  overrides: Partial<T> | undefined,
): T {
  if (!overrides) return { ...global };
  const merged: T = { ...global };
  for (const key of Object.keys(overrides) as Array<keyof T>) {
    const value = overrides[key];
    if (value !== undefined) {
      merged[key] = value as T[keyof T];
    }
  }
  return merged;
}

/// Fully-populated defaults used by the UI when the user hasn't customised
/// global prefs yet. Mirrors the Rust-side defaults in
/// `src-tauri/src/prefs/mod.rs::GlobalPrefs::default`.
export const DEFAULT_GLOBAL_PREFS: GlobalPrefs = {
  intelliShell: { commandTimeoutMs: 30000, autoCompleteEnabled: true, printLimit: 1000 },
  tools: {
    mongodumpPath: '/usr/bin/mongodump',
    mongorestorePath: '/usr/bin/mongorestore',
    mongoexportPath: '/usr/bin/mongoexport',
    mongoimportPath: '/usr/bin/mongoimport',
  },
  advanced: {
    appName: 'mongo-lens', retryWrites: true, retryReads: true,
    compressors: ['snappy'],
    serverSelectionTimeoutMs: 30000, connectTimeoutMs: 10000, socketTimeoutMs: 0,
  },
};

export function resolveEffective(
  global: GlobalPrefs,
  overrides?: ConnectionOverrides,
): EffectivePrefs {
  return {
    intelliShell: mergeBlock(global.intelliShell, overrides?.intelliShell),
    tools: mergeBlock(global.tools, overrides?.tools),
    advanced: mergeBlock(global.advanced, overrides?.advanced),
  };
}
