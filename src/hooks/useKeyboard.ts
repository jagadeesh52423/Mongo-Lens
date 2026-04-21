import { useEffect, useRef } from 'react';
import { keyboardService, type ShortcutDef, type KeyboardService } from '../services/KeyboardService';

export function useKeyboard(def: ShortcutDef, svc: KeyboardService = keyboardService): void {
  const actionRef = useRef(def.action);
  actionRef.current = def.action;

  useEffect(() => {
    return svc.register(def.id, () => actionRef.current());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.id, svc]);
}
