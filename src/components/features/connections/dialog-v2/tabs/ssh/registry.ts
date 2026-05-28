import type { ComponentType } from 'react';
import type { SshAuth } from '../../../../../../connection/model';
import type { AuthSubFormProps } from '../auth/registry';
import { PasswordForm } from './PasswordForm';
import { KeyForm } from './KeyForm';
import { AgentForm } from './AgentForm';

/**
 * SSH auth-method sub-form registry.
 *
 * To add a new SshAuth variant:
 *   1. Extend `SshAuth` in src/connection/model.ts.
 *   2. Implement <Variant>Form.tsx alongside the existing forms.
 *   3. Register under SSH_AUTH_FORMS + SSH_AUTH_LABELS.
 */
export const SSH_AUTH_FORMS: Record<SshAuth['kind'], ComponentType<AuthSubFormProps>> = {
  password: PasswordForm,
  key: KeyForm,
  agent: AgentForm,
};

export const SSH_AUTH_LABELS: Record<SshAuth['kind'], string> = {
  password: 'Password',
  key: 'Private key',
  agent: 'SSH agent',
};
