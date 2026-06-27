import { useState } from 'react';
import { useAgentStore, type AgentEntry } from '../../../store/agent';
import { getActiveTarget } from '../../../services/ai/activeTarget';
import { startAgentRun } from '../../../services/ai/agentRunner';
import { AgentToolCard } from './AgentToolCard';
import { AgentConfirmCard } from './AgentConfirmCard';
import styles from './AgentPanel.module.css';

/**
 * Read-only Agent panel (phase 2a). Renders the per-tab agent transcript and
 * lets the user kick off an agent run against the active connection/database.
 * Writes are blocked at the policy layer; the `confirm` entry kind is rendered
 * in a later task once the approval UI exists.
 */
export function AgentPanel({ tabId }: { tabId: string }) {
  const [goal, setGoal] = useState('');
  const tab = useAgentStore((s) => s.byTab[tabId]);
  const entries = tab?.entries ?? [];
  const running = tab?.running ?? false;
  const target = getActiveTarget();
  const ready = !!target.connectionId && !!target.database;

  const submit = () => {
    const g = goal.trim();
    if (!g || !ready || running) return;
    setGoal('');
    void startAgentRun(tabId, g, {
      connectionId: target.connectionId!,
      database: target.database!,
    });
  };

  return (
    <div className={styles.panel}>
      <div className={styles.transcript}>
        {entries.map((e, i) => (
          <Entry key={i} e={e} tabId={tabId} />
        ))}
        {running && <div className={styles.thinking}>Working…</div>}
      </div>
      <div className={styles.inputRow}>
        <input
          className={styles.input}
          placeholder={ready ? 'Ask the agent…' : 'Connect to a database first'}
          value={goal}
          disabled={!ready || running}
          onChange={(ev) => setGoal(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') submit();
          }}
        />
        <button
          type="button"
          className={styles.run}
          onClick={submit}
          disabled={!ready || running || !goal.trim()}
        >
          Run
        </button>
      </div>
    </div>
  );
}

function Entry({ e, tabId }: { e: AgentEntry; tabId: string }) {
  if (e.kind === 'tool-call') return <AgentToolCard statement={e.statement} />;
  if (e.kind === 'tool-result')
    return <div className={e.ok ? styles.toolOk : styles.toolErr}>{e.summary}</div>;
  if (e.kind === 'final') return <div className={styles.final}>{e.text}</div>;
  if (e.kind === 'error') return <div className={styles.error}>{e.text}</div>;
  if (e.kind === 'model-text') return <div className={styles.modelText}>{e.text}</div>;
  if (e.kind === 'confirm')
    return (
      <AgentConfirmCard
        tabId={tabId}
        id={e.id}
        statement={e.statement}
        category={e.category}
        collection={e.collection}
        resolved={e.resolved}
      />
    );
  return null;
}
