import { ServerTab } from './ServerTab';
import { AuthTab } from './AuthTab';
import { TlsTab } from './TlsTab';
import { SshTab } from './SshTab';
import { ProxyTab } from './ProxyTab';
import { IntelliShellTab, hasIntelliShellOverrides } from './IntelliShellTab';
import { ToolsTab, hasToolsOverrides } from './ToolsTab';
import { AdvancedTab, hasAdvancedOverrides } from './AdvancedTab';
import { validateTarget, validateAuth, validateTls, validateSsh, validateProxy } from '../../../../../connection/validation';
import { TAB_ICONS } from './icons';
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
    icon: TAB_ICONS.server,
    Form: ServerTab,
    validate: (c) => validateTarget(c.target),
  },
  {
    id: 'auth',
    label: 'Auth',
    group: 'transport',
    icon: TAB_ICONS.auth,
    Form: AuthTab,
    validate: (c) => validateAuth(c.auth),
  },
  {
    id: 'tls',
    label: 'TLS',
    group: 'transport',
    icon: TAB_ICONS.tls,
    Form: TlsTab,
    validate: (c) => validateTls(c.tls),
  },
  {
    id: 'ssh',
    label: 'SSH',
    group: 'transport',
    icon: TAB_ICONS.ssh,
    Form: SshTab,
    validate: (c) => validateSsh(c.ssh),
  },
  {
    id: 'proxy',
    label: 'Proxy',
    group: 'transport',
    icon: TAB_ICONS.proxy,
    Form: ProxyTab,
    validate: (c) => validateProxy(c.proxy),
  },
  {
    id: 'intelliShell',
    label: 'IntelliShell',
    group: 'prefs',
    icon: TAB_ICONS.intelliShell,
    Form: IntelliShellTab,
    validate: () => [],
    hasOverrides: hasIntelliShellOverrides,
  },
  {
    id: 'tools',
    label: 'Tools',
    group: 'prefs',
    icon: TAB_ICONS.tools,
    Form: ToolsTab,
    validate: () => [],
    hasOverrides: hasToolsOverrides,
  },
  {
    id: 'advanced',
    label: 'Advanced',
    group: 'prefs',
    icon: TAB_ICONS.advanced,
    Form: AdvancedTab,
    validate: () => [],
    hasOverrides: hasAdvancedOverrides,
  },
];
