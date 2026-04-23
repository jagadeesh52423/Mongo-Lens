import type { KeyCombo } from '../KeyboardService';
import type { RecordContext } from './RecordContext';
import type { RecordActionHost } from './RecordActionHost';

// implement this interface and register in recordActionRegistry to add a new record action
export interface RecordAction {
  id: string;
  label: string;
  keyBinding?: KeyCombo;
  scope?: string; // defaults to 'results' if omitted
  showInContextMenu?: boolean;
  canExecute(context: RecordContext): boolean;
  execute(context: RecordContext, host: RecordActionHost): void;
}
