export interface DestructiveRequest { statement: string; category: string | null; collection: string | null; }
export interface DestructiveDecision { run: boolean; feedback?: string; }
/** Strategy: decide whether a destructive statement may run. */
export type DestructivePolicy = (req: DestructiveRequest) => Promise<DestructiveDecision>;

/** Phase 2a policy: never run writes; tell the model they are disabled. */
export const blockWrites: DestructivePolicy = async () => ({
  run: false,
  feedback: 'This statement modifies data and write execution is disabled. Do not retry it; propose it to the user instead.',
});
