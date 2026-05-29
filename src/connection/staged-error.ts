// Shared helpers for rendering staged connection-build failures.
//
// A `BuildStage` (defined in `./ipc.ts`) tells the UI *which* step of the
// connection-build pipeline failed (ssh tunnel → tls handshake → auth → ping).
// Both the in-dialog Test footer (`ConnectionDialogV2`) and the post-connect
// error modal (`ConnectionErrorDialog`) need to map that discriminator to the
// same human-readable heading — so the mapping lives here, not duplicated at
// each call site.

import type { BuildStage } from './ipc';

/**
 * Human-readable heading for a connection-build failure stage. The error
 * detail body is rendered separately by each caller.
 */
export function stageHeading(stage: BuildStage): string {
  switch (stage) {
    case 'ssh': return 'SSH tunnel failed';
    case 'tls': return 'TLS handshake failed';
    case 'auth': return 'Authentication failed';
    case 'ping': return 'Server ping failed';
  }
}

/**
 * Discriminated message shape for `ConnectionErrorDialog`. A plain string is
 * the legacy "we don't know which stage" payload from the old IPC; the staged
 * object is what `connections_v2_*` returns.
 */
export type StagedErrorMessage =
  | string
  | { stage: BuildStage; error: string };

// Leading "<stage>: " prefix emitted by the backend connect path. The stage
// keyword must be one of the known BuildStage values and be followed by a
// colon + whitespace, so arbitrary messages that merely contain a colon
// (e.g. "database error: refused") are never misparsed as staged.
const STAGED_PREFIX = /^(ssh|tls|auth|ping):\s/i;

/**
 * Parse a raw connect-error string into a `StagedErrorMessage`.
 *
 * The backend emits staged failures as `"<stage>: <detail>"` (lowercase
 * stage, e.g. `"tls: self-signed certificate"`); this strips the prefix and
 * returns `{ stage, error }`. A legacy capitalized form (`"Ssh: ..."`) is
 * tolerated for safety. Anything without a recognized stage prefix is
 * returned unchanged as the legacy plain-string payload.
 */
export function parseStagedError(raw: string): StagedErrorMessage {
  const match = STAGED_PREFIX.exec(raw);
  if (!match) return raw;
  return {
    stage: match[1].toLowerCase() as BuildStage,
    error: raw.slice(match[0].length),
  };
}
