import type { QueryCategory } from '../../types';

export interface RecordContext {
  doc: Record<string, unknown>;
  connectionId?: string;
  database?: string;
  collection?: string; // undefined for manual/saved-script tabs
  /**
   * Operation category of the result group this record comes from. Used by
   * record actions to gate availability (e.g. F4/Edit is only valid when the
   * underlying result was produced by a `query` — find/findOne — not a
   * mutation, aggregation, etc.). Undefined for legacy/out-of-band contexts.
   */
  category?: QueryCategory;
}
