import { ServerTab } from './ServerTab';
import { AuthTab } from './AuthTab';
import { TlsTab } from './TlsTab';
import { SshTab } from './SshTab';
import { validateTarget, validateAuth, validateTls, validateSsh } from '../../../../../connection/validation';
import type { TabSpec } from './types';

/**
 * Connection-dialog tab registry.
 *
 * To add a new tab: implement TabSpec in a new file under ./tabs, then add
 * one entry below. No other file edits required.
 */
export const TABS: TabSpec[] = [
  {
    id: 'server',
    label: 'Server',
    group: 'transport',
    Form: ServerTab,
    validate: (c) => validateTarget(c.target),
  },
  {
    id: 'auth',
    label: 'Auth',
    group: 'transport',
    Form: AuthTab,
    validate: (c) => validateAuth(c.auth),
  },
  {
    id: 'tls',
    label: 'TLS',
    group: 'transport',
    Form: TlsTab,
    validate: (c) => validateTls(c.tls),
  },
  {
    id: 'ssh',
    label: 'SSH',
    group: 'transport',
    Form: SshTab,
    validate: (c) => validateSsh(c.ssh),
  },
];
