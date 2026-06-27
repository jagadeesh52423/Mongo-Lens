import { parseAIContent, type AISegment } from '../../../utils/aiContent';
import { CodeBlock } from './CodeBlock';
import styles from './AIMessageBubble.module.css';

/**
 * Renders assistant text: prose as text, fenced code as an extractable
 * `CodeBlock` (Insert / Update / Append / Explain). Shared by the Chat bubble
 * and the Agent transcript so both surfaces get identical code-extraction
 * affordances. `onSendToAI`, when provided, lets a code block feed a follow-up
 * back into the conversation.
 */
export function AssistantContent({
  content,
  onSendToAI,
}: {
  content: string;
  onSendToAI?: (content: string) => void;
}) {
  const segments = parseAIContent(content);
  if (segments.length === 0) return null;
  return <>{segments.map((seg, i) => renderSegment(seg, i, onSendToAI))}</>;
}

function renderSegment(seg: AISegment, key: number, onSendToAI?: (content: string) => void) {
  if (seg.kind === 'text') {
    return <div key={key} className={styles.content}>{seg.text}</div>;
  }
  return <CodeBlock key={key} lang={seg.lang} code={seg.code} onSendToAI={onSendToAI} />;
}
