import { CodeBlock } from './CodeBlock';

/**
 * Renders a statement the agent executed as an extractable `CodeBlock` — so the
 * user can Insert/Append it into the editor or Explain it, same as Chat code.
 */
export function AgentToolCard({
  statement,
  onSendToAI,
}: {
  statement: string;
  onSendToAI?: (content: string) => void;
}) {
  return <CodeBlock lang="javascript" code={statement} onSendToAI={onSendToAI} />;
}
