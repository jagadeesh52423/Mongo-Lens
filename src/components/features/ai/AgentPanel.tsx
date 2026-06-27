import { useState } from 'react';
import { useAgentStore, type AgentEntry } from '../../../store/agent';
import { getActiveTarget } from '../../../services/ai/activeTarget';
import { startAgentRun } from '../../../services/ai/agentRunner';
import { AssistantContent } from './AssistantContent';
import { AgentToolCard } from './AgentToolCard';
import { AgentConfirmCard } from './AgentConfirmCard';
import styles from './AgentPanel.module.css';

/**
 * Agent panel. Renders the per-tab agent transcript and runs the agent against
 * the active connection/database. Each submit continues the prior conversation
 * (history is carried in the agent store), so follow-up questions keep context.
 * Model text, the final answer, and each executed statement render through the
 * shared CodeBlock pipeline, so their code is extractable into the editor.
 */
export function AgentPanel({ tabId }: { tabId: string }) {
  const [goal, setGoal] = useState('');
  const tab = useAgentStore((s) => s.byTab[tabId]);
  const clear = useAgentStore((s) => s.clear);
  const entries = tab?.entries ?? [];
  const running = tab?.running ?? false;
  const target = getActiveTarget();
  const ready = !!target.connectionId && !!target.database;

  const run = (text: string) => {
    const g = text.trim();
    if (!g || !ready || running) return;
    void startAgentRun(tabId, g, {
      connectionId: target.connectionId!,
      database: target.database!,
    });
  };

  const submit = () => {
    if (!goal.trim()) return;
    run(goal);
    setGoal('');
  };

  return (
    <div className={styles.panel}>
      <div className={styles.transcript}>
        {entries.map((e, i) => (
          <Entry key={i} e={e} tabId={tabId} onSendToAI={run} />
        ))}
        {running && <div className={styles.thinking}>Working…</div>}
      </div>
      <div className={styles.inputRow}>
        {entries.length > 0 && (
          <button
            type="button"
            className={styles.clear}
            onClick={() => clear(tabId)}
            disabled={running}
            title="Clear the agent conversation and start fresh"
          >
            Clear
          </button>
        )}
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

function Entry({
  e,
  tabId,
  onSendToAI,
}: {
  e: AgentEntry;
  tabId: string;
  onSendToAI: (content: string) => void;
}) {
  if (e.kind === 'user') return <div className={styles.userText}>{e.text}</div>;
  if (e.kind === 'tool-call') return <AgentToolCard statement={e.statement} onSendToAI={onSendToAI} />;
  if (e.kind === 'tool-result')
    return <div className={e.ok ? styles.toolOk : styles.toolErr}>{e.summary}</div>;
  if (e.kind === 'final') return <AssistantContent content={e.text} onSendToAI={onSendToAI} />;
  if (e.kind === 'model-text') return <AssistantContent content={e.text} onSendToAI={onSendToAI} />;
  if (e.kind === 'error') return <div className={styles.error}>{e.text}</div>;
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
