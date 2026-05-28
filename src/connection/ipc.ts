// Thin invoke wrappers for the CONN_V2-gated Tauri commands. These exist
// so callers (Phase 2 dialog code, tests) program against typed function
// signatures rather than stringly-typed `invoke` calls scattered across
// the UI. The Rust side lives at:
//
//   src-tauri/src/commands/connection_v2.rs   (list/save/delete/test)
//   src-tauri/src/commands/prefs.rs           (get/set/resolve_effective)
//
// Wire format matches the Rust serde shape exactly — see those files
// and the JSON fixtures under tests/fixtures/connection/ for the
// authoritative contract.

import { invoke } from '@tauri-apps/api/core';
import type { Connection } from './model';
import type { EffectivePrefs, GlobalPrefs } from './overrides';

// ──────────────────────────────────────────────────────────────────────────
// Shared types
// ──────────────────────────────────────────────────────────────────────────

/// Wire-format strings for `SecretSlot`. Mirror the kebab-case spellings
/// in `SecretSlot::as_wire` (src-tauri/src/connection/secrets.rs).
/// `oidc-refresh-token` exists for completeness but is set by the Rust
/// side during the device-code flow, never via this IPC surface.
export type SecretSlotName =
  | 'auth-password'
  | 'ssh-password'
  | 'ssh-key-passphrase'
  | 'proxy-password'
  | 'aws-secret-key'
  | 'oidc-refresh-token';

/// Alias for ergonomic imports in dialog code.
export type SecretSlot = SecretSlotName;

export interface SecretInput {
  slot: SecretSlotName;
  value: string;
}

export interface SaveInput {
  connection: Connection;
  secrets: SecretInput[];
}

/// Stage at which `connections_v2_test` failed. Discriminator the
/// new-dialog tabs use to highlight the offending step.
export type BuildStage = 'ssh' | 'tls' | 'auth' | 'ping';

/// Test result is a discriminated union on `ok` (boolean). On success
/// the `serverInfo` is the `hello` response from the admin db.
export type TestResult =
  | { ok: true; serverInfo: unknown }
  | { ok: false; stage: BuildStage; error: string };

// ──────────────────────────────────────────────────────────────────────────
// connections_v2_*
// ──────────────────────────────────────────────────────────────────────────

export const listV2 = (): Promise<Connection[]> =>
  invoke<Connection[]>('connections_v2_list');

export const saveV2 = (input: SaveInput): Promise<Connection> =>
  invoke<Connection>('connections_v2_save', { input });

export const deleteV2 = (id: string): Promise<void> =>
  invoke<void>('connections_v2_delete', { id });

export const testV2 = (input: SaveInput): Promise<TestResult> =>
  invoke<TestResult>('connections_v2_test', { input });

/// Outcome of `connections_v2_connect`. The dialog routes on `type`:
///   - `'connected'`             → close the dialog, flip to "live"
///   - `'passphraseRequired'`    → open PassphraseDialog; retry with `passphrase`
///   - `'hostKeyUnknown'`        → open HostKeyDialog; retry with `acceptHostKey:true`
///
/// Mirrors `ConnectResultV2` in src-tauri/src/commands/connection_v2.rs.
export type ConnectResultV2 =
  | { type: 'connected' }
  | { type: 'passphraseRequired'; connectionId: string }
  | {
      type: 'hostKeyUnknown';
      connectionId: string;
      fingerprint: string;
      algorithm: string;
      host: string;
      port: number;
    };

export const connectV2 = (
  id: string,
  passphrase?: string,
  acceptHostKey?: boolean,
): Promise<ConnectResultV2> =>
  invoke<ConnectResultV2>('connections_v2_connect', {
    id,
    passphrase,
    acceptHostKey,
  });

export const disconnectV2 = (id: string): Promise<void> =>
  invoke<void>('connections_v2_disconnect', { id });

// ──────────────────────────────────────────────────────────────────────────
// prefs_*
// ──────────────────────────────────────────────────────────────────────────

export const prefsGet = (): Promise<GlobalPrefs> =>
  invoke<GlobalPrefs>('prefs_get');

export const prefsSet = (prefs: GlobalPrefs): Promise<void> =>
  invoke<void>('prefs_set', { prefs });

export const prefsResolveEffective = (
  connectionId: string,
): Promise<EffectivePrefs> =>
  invoke<EffectivePrefs>('prefs_resolve_effective', { connectionId });
