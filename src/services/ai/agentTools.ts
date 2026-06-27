import type { ToolDef } from './providers/AIProvider';
import { queryTypeRegistry, isPotentiallyDestructive, splitStatements } from '../query/QueryTypeRegistry';
import type { QueryCategory } from '../../types';

export const RUN_MONGO_TOOL: ToolDef = {
  name: 'runMongo',
  description:
    'Run ONE MongoDB shell statement against the current database and get its result. ' +
    'Use it to explore before answering: sample docs (db.coll.find().limit(5)), list indexes ' +
    '(db.coll.getIndexes()), check a plan (db.coll.find(...).explain("executionStats")), or run ' +
    'aggregations/$lookup across collections. Read statements run automatically; statements that ' +
    'modify data (update/delete/drop/insert) require the user to approve before they run.',
  parameters: {
    type: 'object',
    properties: { statement: { type: 'string', description: 'A single MongoDB shell statement, e.g. db.users.find({ active: true }).limit(5)' } },
    required: ['statement'],
  },
};

export interface StatementClassification {
  destructive: boolean;
  category: QueryCategory | null;
  collection: string | null;
}

/** Fail-safe pre-execution gate. Multi-statement or unknown ⇒ destructive. */
export function classifyStatement(statement: string): StatementClassification {
  if (splitStatements(statement).filter((s) => s.trim()).length > 1) {
    return { destructive: true, category: null, collection: null };
  }
  const c = queryTypeRegistry.classify(statement);
  return { destructive: isPotentiallyDestructive(c), category: c.category, collection: c.collection };
}
