import type { SubFormProps } from '../types';

export function AgentForm({ value }: SubFormProps) {
  if (!value.ssh || value.ssh.auth.kind !== 'agent') return null;
  return <p>Uses identities from <code>SSH_AUTH_SOCK</code>.</p>;
}
