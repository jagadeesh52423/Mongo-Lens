import type { RecordAction } from './RecordAction';
import type { RecordContext } from './RecordContext';
import { keyboardService } from '../KeyboardService';

class RecordActionRegistry {
  private actions: RecordAction[] = [];

  register(action: RecordAction): void {
    if (this.actions.some((a) => a.id === action.id)) return;
    this.actions.push(action);
    if (action.keyBinding) {
      keyboardService.defineShortcut({
        id: action.id,
        keys: action.keyBinding,
        label: action.label,
        scope: action.scope ?? 'results',
        showInContextMenu: action.showInContextMenu,
      });
    }
  }

  getAll(): RecordAction[] {
    return this.actions;
  }

  getExecutable(context: RecordContext): RecordAction[] {
    return this.actions.filter((a) => a.canExecute(context));
  }

  getById(id: string): RecordAction | undefined {
    return this.actions.find((a) => a.id === id);
  }
}

export const recordActionRegistry = new RecordActionRegistry();
