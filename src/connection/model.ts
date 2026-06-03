// Tagged-union connection model. Mirrored in Rust at src-tauri/src/connection/model.rs.
// Shared JSON fixtures in tests/fixtures/connection/ lock the wire contract.
//
// Extension contract: to add a new auth mode / target kind / proxy type, add a
// new variant here AND a mirror in the Rust enum, then add a fixture exercising
// the new variant. The fixture round-trip test enforces parity.

export type AuthMode =
  | { kind: 'none' }
  | {
      kind: 'scram';
      username: string;
      authDb: string;
      mechanism?: 'SCRAM-SHA-1' | 'SCRAM-SHA-256' | 'auto';
    }
  | { kind: 'legacy-cr'; username: string; authDb: string }
  | { kind: 'x509'; certFile: string; certKeyFile?: string }
  | { kind: 'ldap'; username: string }
  | {
      kind: 'kerberos';
      principal: string;
      serviceName?: string;
      canonicalizeHostName?: boolean;
    }
  | {
      kind: 'aws-iam';
      accessKeyId?: string;
      sessionToken?: string;
      useEnvCreds?: boolean;
    }
  | { kind: 'oidc'; principal?: string; providerName?: string };

export type ConnectionTarget =
  | { kind: 'uri'; uri: string }
  | {
      kind: 'direct';
      host: string;
      port: number;
      replicaSet?: string;
      readPreference?:
        | 'primary'
        | 'primaryPreferred'
        | 'secondary'
        | 'secondaryPreferred'
        | 'nearest';
      directConnection?: boolean;
    };

export type Tls =
  | { enabled: false }
  | {
      enabled: true;
      allowInvalidCerts?: boolean;
      allowInvalidHostnames?: boolean;
      caFile?: string;
      clientCertFile?: string;
    };

export type SshAuth =
  | { kind: 'password' }
  | { kind: 'key'; keyPath: string; hasPassphrase: boolean }
  | { kind: 'agent' };

export type SshTunnel = {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  auth: SshAuth;
  knownHostsPolicy: 'strict' | 'add-and-trust' | 'accept-any';
};

export type Proxy = {
  enabled: boolean;
  kind: 'http' | 'socks4' | 'socks5';
  host: string;
  port: number;
  auth?: { username: string };
};

export type IntelliShellOverrides = {
  commandTimeoutMs?: number;
  autoCompleteEnabled?: boolean;
  printLimit?: number;
};

export type ToolsOverrides = {
  mongodumpPath?: string;
  mongorestorePath?: string;
  mongoexportPath?: string;
  mongoimportPath?: string;
};

export type AdvancedOverrides = {
  appName?: string;
  retryWrites?: boolean;
  retryReads?: boolean;
  compressors?: Array<'snappy' | 'zlib' | 'zstd'>;
  serverSelectionTimeoutMs?: number;
  connectTimeoutMs?: number;
  socketTimeoutMs?: number;
};

export interface Connection {
  id: string;
  name: string;
  color?: string;
  target: ConnectionTarget;
  auth: AuthMode;
  tls?: Tls;
  ssh?: SshTunnel;
  proxy?: Proxy;
  overrides?: {
    intelliShell?: IntelliShellOverrides;
    tools?: ToolsOverrides;
    advanced?: AdvancedOverrides;
  };
  createdAt: string;
}
