import { useAgentStore } from '../../../store/agent';
import styles from './AgentPanel.module.css';

export function AgentConfirmCard({ tabId, id, statement, category, collection, resolved }: {
  tabId: string; id: string; statement: string; category: string | null; collection: string | null; resolved?: 'approved' | 'denied';
}) {
  const resolve = useAgentStore((s) => s.resolveConfirm);
  return (
    <div className={styles.confirmCard}>
      <div className={styles.confirmTitle}>Approve {category ?? 'destructive'} on {collection ?? 'unknown'}?</div>
      <code className={styles.confirmStmt}>{statement}</code>
      {resolved ? (
        <div className={styles.confirmResolved}>{resolved}</div>
      ) : (
        <div className={styles.confirmButtons}>
          <button type="button" onClick={() => resolve(tabId, id, 'approved')}>Approve &amp; run</button>
          <button type="button" onClick={() => resolve(tabId, id, 'denied')}>Deny</button>
        </div>
      )}
    </div>
  );
}
