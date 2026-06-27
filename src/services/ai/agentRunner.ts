import { AgentService } from './AgentService';
import type { AgentTarget } from './AgentService';
import { runStatement } from './runStatement';
import { classifyStatement } from './agentTools';
import { confirmViaStore } from './destructivePolicy';
import { providerRegistry, OPENAI_COMPATIBLE } from './providers/ProviderRegistry';
import { useSettingsStore } from '../../store/settings';
import { getAiToken, listCollections } from '../../ipc';
import { useAgentStore } from '../../store/agent';

/** Wire and run a real agent turn for a tab. Destructive statements require user approval. */
export async function startAgentRun(
  tabId: string,
  goal: string,
  target: { connectionId: string; database: string },
): Promise<void> {
  const store = useAgentStore.getState();
  store.append(tabId, { kind: 'model-text', text: goal });
  store.setRunning(tabId, true);
  try {
    const cfg = useSettingsStore.getState().aiConfig;
    const apiToken = (await getAiToken()) ?? '';
    const provider = providerRegistry.get(OPENAI_COMPATIBLE, { ...cfg, apiToken });
    const collections = await listCollections(target.connectionId, target.database)
      .then((cs) => cs.map((c) => c.name))
      .catch(() => [] as string[]);
    const svc = new AgentService({
      provider,
      runStatement,
      classify: classifyStatement,
      onDestructive: confirmViaStore(tabId),
      emit: (e) => useAgentStore.getState().append(tabId, e),
      model: cfg.model,
    });
    const full: AgentTarget = { ...target, collections };
    await svc.run(goal, full);
  } catch (err) {
    useAgentStore.getState().append(tabId, {
      kind: 'error',
      text: err instanceof Error ? err.message : String(err),
    });
  } finally {
    useAgentStore.getState().setRunning(tabId, false);
  }
}
