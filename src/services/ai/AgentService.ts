import type { AgentMessage, ToolChatResponse, ToolDef } from './providers/AIProvider';
import { RUN_MONGO_TOOL } from './agentTools';
import type { StatementClassification } from './agentTools';
import type { StatementResult } from './runStatement';
import type { DestructivePolicy } from './destructivePolicy';
import type { AgentEntry } from '../../store/agent';
import { safeStringify } from './schemaUtils';

export interface AgentTarget { connectionId: string; database: string; collections: string[]; }

export interface AgentDeps {
  provider: { chatWithTools: (req: { messages: AgentMessage[]; model: string }, tools: ToolDef[], signal?: AbortSignal) => Promise<ToolChatResponse> };
  runStatement: (connectionId: string, database: string, statement: string) => Promise<StatementResult>;
  classify: (statement: string) => StatementClassification;
  onDestructive: DestructivePolicy;
  emit: (entry: AgentEntry) => void;
  model?: string;
  maxIter?: number;
  signal?: AbortSignal;
}

const SYSTEM = (db: string, collections: string[]) =>
  `You are a MongoDB agent operating on database "${db}". Available collections: ${collections.join(', ') || '(none listed)'}.\n` +
  'Use the runMongo tool to explore (sample docs, getIndexes(), explain()) across any collection before composing the final query. ' +
  'Prefer index-aware queries. When done, reply with the final query and a short explanation. Do not call tools in your final message.';

export class AgentService {
  constructor(private readonly deps: AgentDeps) {}

  /**
   * Run one agent turn. Pass `history` (the messages a prior run on the same tab
   * returned) to continue the conversation so follow-ups keep context; omit it
   * (or pass []) to start fresh. Returns the answer plus the full message list
   * to persist for the next turn.
   */
  async run(
    goal: string,
    target: AgentTarget,
    history: AgentMessage[] = [],
  ): Promise<{ answer: string; messages: AgentMessage[] }> {
    const { provider, runStatement, classify, onDestructive, emit, signal } = this.deps;
    const maxIter = this.deps.maxIter ?? 25;
    const model = this.deps.model ?? 'gpt-4o';
    const messages: AgentMessage[] = history.length
      ? [...history, { role: 'user', content: goal }]
      : [
          { role: 'system', content: SYSTEM(target.database, target.collections) },
          { role: 'user', content: goal },
        ];

    for (let i = 0; i < maxIter; i++) {
      if (signal?.aborted) return { answer: 'Agent stopped.', messages };
      const { content, toolCalls } = await provider.chatWithTools({ messages, model }, [RUN_MONGO_TOOL], signal);

      if (!toolCalls.length) {
        if (content) emit({ kind: 'final', text: content });
        return { answer: content, messages };
      }
      if (content) emit({ kind: 'model-text', text: content });
      messages.push({ role: 'assistant', content: content || null, toolCalls });

      for (const call of toolCalls) {
        const statement = String(call.arguments.statement ?? '').trim();
        emit({ kind: 'tool-call', id: call.id, statement });
        let toolContent: string;
        if (!statement) {
          toolContent = 'Error: empty statement.';
          emit({ kind: 'tool-result', id: call.id, ok: false, summary: toolContent });
        } else {
          const cls = classify(statement);
          if (cls.destructive) {
            const decision = await onDestructive({ statement, category: cls.category, collection: cls.collection });
            if (!decision.run) {
              toolContent = decision.feedback ?? 'Statement not executed.';
              emit({ kind: 'tool-result', id: call.id, ok: false, summary: toolContent });
              messages.push({ role: 'tool', toolCallId: call.id, content: toolContent });
              continue;
            }
          }
          try {
            const res = await runStatement(target.connectionId, target.database, statement);
            toolContent = safeStringify(res.groups.map((g) => ({ collection: g.collection, docs: g.docs, truncated: g.truncated })));
            emit({ kind: 'tool-result', id: call.id, ok: true, summary: `${res.groups.reduce((n, g) => n + g.docs.length, 0)} doc(s)` });
          } catch (err) {
            toolContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
            emit({ kind: 'tool-result', id: call.id, ok: false, summary: toolContent });
          }
        }
        messages.push({ role: 'tool', toolCallId: call.id, content: toolContent });
      }
    }
    const msg = 'Agent stopped after reaching the iteration limit.';
    emit({ kind: 'error', text: msg });
    return { answer: msg, messages };
  }
}
