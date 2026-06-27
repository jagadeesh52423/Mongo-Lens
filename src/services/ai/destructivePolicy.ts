import { useAgentStore, registerConfirm, type AgentEntry } from '../../store/agent';

export interface DestructiveRequest { statement: string; category: string | null; collection: string | null; }
export interface DestructiveDecision { run: boolean; feedback?: string; }
/** Strategy: decide whether a destructive statement may run. */
export type DestructivePolicy = (req: DestructiveRequest) => Promise<DestructiveDecision>;

/** Phase 2a policy: never run writes; tell the model they are disabled. */
export const blockWrites: DestructivePolicy = async () => ({
  run: false,
  feedback: 'This statement modifies data and write execution is disabled. Do not retry it; propose it to the user instead.',
});

/** Phase 2b: surface a confirm card and await the user's Approve/Deny. */
export function confirmViaStore(tabId: string): DestructivePolicy {
  return (req) => new Promise((resolve) => {
    const id = globalThis.crypto?.randomUUID?.() ?? `confirm-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const entry: AgentEntry = { kind: 'confirm', id, statement: req.statement, category: req.category, collection: req.collection };
    useAgentStore.getState().append(tabId, entry);
    registerConfirm(`${tabId}:${id}`, (decision) => resolve(
      decision === 'approved'
        ? { run: true }
        : { run: false, feedback: 'The user declined to run this statement. Propose an alternative or ask for guidance.' },
    ));
  });
}
