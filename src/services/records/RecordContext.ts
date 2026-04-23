export interface RecordContext {
  doc: Record<string, unknown>;
  connectionId?: string;
  database?: string;
  collection?: string; // undefined for manual/saved-script tabs
}
