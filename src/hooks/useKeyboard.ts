import { useEffect } from 'react';
import { keyboardService, type ShortcutDef, type KeyboardService } from '../services/KeyboardService';

export function useKeyboard(def: ShortcutDef, svc: KeyboardService = keyboardService): void {
  useEffect(() => {
    return svc.register(def);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.id]);
}
