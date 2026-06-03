// Blank/disabled prototypes + emptiness predicates for the optional transport
// features (TLS / SSH / Proxy). These let the dialog render every feature's
// fields with the feature toggled off, persist what the user typed while
// disabled, and drop a feature from storage only when it is both disabled and
// carries no user-entered data.
//
// Extension contract: to add a new toggleable transport feature, add its BLANK_*
// prototype and an isBlank* predicate here; the save-normalization step keys off
// these helpers, so no caller changes are needed.

import type { SshTunnel, Proxy, Tls } from './model';

export const BLANK_SSH: SshTunnel = {
  enabled: false,
  host: '',
  port: 22,
  user: '',
  auth: { kind: 'password' },
  knownHostsPolicy: 'strict',
};

export const BLANK_PROXY: Proxy = {
  enabled: false,
  kind: 'socks5',
  host: '',
  port: 1080,
};

/** Disabled + no user-entered data → safe to drop from storage. */
export function isBlankSsh(ssh: SshTunnel): boolean {
  return (
    !ssh.enabled &&
    !ssh.host.trim() &&
    !ssh.user.trim() &&
    ssh.auth.kind === 'password'
  );
}

export function isBlankProxy(proxy: Proxy): boolean {
  return !proxy.enabled && !proxy.host.trim() && !proxy.auth;
}

export function isBlankTls(tls: Tls): boolean {
  if (tls.enabled) return false;
  // Disabled: blank unless cert/flag data was entered. The optional cert fields
  // only exist on the `enabled: true` arm of the union, so widen to read them.
  const extras = tls as {
    caFile?: string;
    clientCertFile?: string;
    allowInvalidCerts?: boolean;
    allowInvalidHostnames?: boolean;
  };
  return (
    !extras.caFile &&
    !extras.clientCertFile &&
    !extras.allowInvalidCerts &&
    !extras.allowInvalidHostnames
  );
}
