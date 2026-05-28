// Pure migrator from the legacy flat `Connection` shape (src/types.ts) to
// the new tagged-union `Connection` in this module. Used by:
//   - the lazy Rust migration runner (Task 11) which deserializes the
//     legacy row, calls a Rust mirror of this logic, and writes to
//     connections_v2;
//   - the TS app, in the rare case a frontend needs to project an
//     already-loaded legacy row into the new shape.
//
// Rules per spec §Migration:
//  • connString present              → target = uri, auth = none
//  • connString absent + username    → target = direct, auth = scram (authDb ?? 'admin')
//  • connString absent + no username → target = direct, auth = none
//  • sshHost present                 → ssh.auth = key (legacy only stored keyPath),
//                                       knownHostsPolicy = 'add-and-trust'
//  • tls / proxy / overrides         → omitted
//
// `'add-and-trust'` is chosen for migrated SSH rows because the old code did
// not enforce host-key checking; promoting to `'strict'` on migration would
// break existing users. New connections default to `'strict'` (set in the
// new dialog, not here).

import type { Connection } from './model';

export interface LegacyConnection {
  id: string;
  name: string;
  host?: string;
  port?: number;
  authDb?: string;
  username?: string;
  connString?: string;
  sshHost?: string;
  sshPort?: number;
  sshUser?: string;
  sshKeyPath?: string;
  createdAt: string;
}

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 27017;
const DEFAULT_AUTH_DB = 'admin';
const DEFAULT_SSH_PORT = 22;
const MIGRATED_SSH_HOST_KEY_POLICY = 'add-and-trust' as const;

export function migrateLegacy(legacy: LegacyConnection): Connection {
  const target: Connection['target'] = legacy.connString
    ? { kind: 'uri', uri: legacy.connString }
    : {
        kind: 'direct',
        host: legacy.host ?? DEFAULT_HOST,
        port: legacy.port ?? DEFAULT_PORT,
      };

  const auth: Connection['auth'] = legacy.connString
    ? { kind: 'none' } // URI carries credentials
    : legacy.username
      ? {
          kind: 'scram',
          username: legacy.username,
          authDb: legacy.authDb ?? DEFAULT_AUTH_DB,
          mechanism: 'auto',
        }
      : { kind: 'none' };

  const ssh: Connection['ssh'] = legacy.sshHost
    ? {
        host: legacy.sshHost,
        port: legacy.sshPort ?? DEFAULT_SSH_PORT,
        user: legacy.sshUser ?? '',
        auth: {
          kind: 'key',
          keyPath: legacy.sshKeyPath ?? '',
          hasPassphrase: false,
        },
        knownHostsPolicy: MIGRATED_SSH_HOST_KEY_POLICY,
      }
    : undefined;

  const migrated: Connection = {
    id: legacy.id,
    name: legacy.name,
    target,
    auth,
    createdAt: legacy.createdAt,
  };
  if (ssh) migrated.ssh = ssh;
  return migrated;
}
