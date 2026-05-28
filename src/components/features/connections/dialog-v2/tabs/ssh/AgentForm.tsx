import type { AuthSubFormProps } from '../auth/registry';

export function AgentForm({ value }: AuthSubFormProps) {
  if (!value.ssh || value.ssh.auth.kind !== 'agent') return null;
  return <p>Uses identities from <code>SSH_AUTH_SOCK</code>.</p>;
}
