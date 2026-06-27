import styles from './AgentPanel.module.css';

/** Renders a single agent tool call (the MongoDB statement) as a code block. */
export function AgentToolCard({ statement }: { statement: string }) {
  return (
    <pre className={styles.toolCard}>
      <code>{statement}</code>
    </pre>
  );
}
