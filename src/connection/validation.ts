// Pure per-tab connection validators. No IO, no Tauri, no React.
// Each validator returns ValidationIssue[]; empty array means valid.
// The `tab` field lets the UI route an error to the right form section.
//
// Extension contract: to add a new auth mode / target kind, add a case
// to the corresponding switch — `AuthMode` cases use exhaustive switch
// so TS will flag a missing case at compile time.

import type {
  Connection,
  ConnectionTarget,
  AuthMode,
  Tls,
  SshTunnel,
  Proxy,
} from './model';

export type ValidationTab = 'server' | 'auth' | 'tls' | 'ssh' | 'proxy';

export type ValidationIssue = {
  tab: ValidationTab;
  message: string;
};

const MIN_PORT = 1;
const MAX_PORT = 65535;
const MONGODB_URI_RE = /^mongodb(\+srv)?:\/\//;

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;
}

export function validateTarget(target: ConnectionTarget): ValidationIssue[] {
  if (target.kind === 'uri') {
    if (!target.uri.trim()) {
      return [{ tab: 'server', message: 'Connection URI is required' }];
    }
    if (!MONGODB_URI_RE.test(target.uri)) {
      return [
        {
          tab: 'server',
          message: 'URI must start with mongodb:// or mongodb+srv://',
        },
      ];
    }
    return [];
  }
  const issues: ValidationIssue[] = [];
  if (!target.host.trim()) {
    issues.push({ tab: 'server', message: 'Host is required' });
  }
  if (!isValidPort(target.port)) {
    issues.push({ tab: 'server', message: 'Port must be 1–65535' });
  }
  return issues;
}

export function validateAuth(auth: AuthMode): ValidationIssue[] {
  switch (auth.kind) {
    case 'none':
      return [];
    case 'scram':
    case 'legacy-cr': {
      const issues: ValidationIssue[] = [];
      if (!auth.username.trim()) {
        issues.push({ tab: 'auth', message: 'Username is required' });
      }
      if (!auth.authDb.trim()) {
        issues.push({ tab: 'auth', message: 'Auth DB is required' });
      }
      return issues;
    }
    case 'x509':
      return auth.certFile.trim()
        ? []
        : [
            {
              tab: 'auth',
              message: 'Client certificate file is required',
            },
          ];
    case 'ldap':
      return auth.username.trim()
        ? []
        : [{ tab: 'auth', message: 'Username is required' }];
    case 'kerberos':
      return auth.principal.trim()
        ? []
        : [{ tab: 'auth', message: 'Principal is required' }];
    case 'aws-iam':
      // accessKeyId optional (env creds path)
      return [];
    case 'oidc':
      return [];
  }
}

export function validateTls(tls: Tls | undefined): ValidationIssue[] {
  if (!tls || !tls.enabled) return [];
  // CA/clientCert paths optional; allowInvalid* is user choice
  return [];
}

export function validateSsh(ssh: SshTunnel | undefined): ValidationIssue[] {
  if (!ssh) return [];
  const issues: ValidationIssue[] = [];
  if (!ssh.host.trim()) {
    issues.push({ tab: 'ssh', message: 'SSH host is required' });
  }
  if (!isValidPort(ssh.port)) {
    issues.push({ tab: 'ssh', message: 'SSH port must be 1–65535' });
  }
  if (!ssh.user.trim()) {
    issues.push({ tab: 'ssh', message: 'SSH user is required' });
  }
  if (ssh.auth.kind === 'key' && !ssh.auth.keyPath.trim()) {
    issues.push({ tab: 'ssh', message: 'SSH key path is required' });
  }
  return issues;
}

export function validateProxy(proxy: Proxy | undefined): ValidationIssue[] {
  if (!proxy) return [];
  const issues: ValidationIssue[] = [];
  if (!proxy.host.trim()) {
    issues.push({ tab: 'proxy', message: 'Proxy host is required' });
  }
  if (!isValidPort(proxy.port)) {
    issues.push({ tab: 'proxy', message: 'Proxy port must be 1–65535' });
  }
  return issues;
}

export function validateConnection(connection: Connection): ValidationIssue[] {
  const nameIssues: ValidationIssue[] = connection.name.trim()
    ? []
    : [{ tab: 'server', message: 'Name is required' }];
  return [
    ...nameIssues,
    ...validateTarget(connection.target),
    ...validateAuth(connection.auth),
    ...validateTls(connection.tls),
    ...validateSsh(connection.ssh),
    ...validateProxy(connection.proxy),
  ];
}
