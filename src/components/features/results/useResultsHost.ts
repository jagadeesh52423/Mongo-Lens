import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { recordActionRegistry } from '../../../services/records/RecordActionRegistry';
import type { RecordActionHost } from '../../../services/records/RecordActionHost';
import type { RecordContext } from '../../../services/records/RecordContext';

export interface ModalState {
  title: string;
  body: ReactNode;
  footer: ReactNode;
  beforeClose?: () => boolean | Promise<boolean>;
}

interface UseResultsHostInput {
  /** Updated each render so executeAction sees the current context. */
  recordContext: RecordContext;
  onDocUpdated?: () => void;
}

interface UseResultsHostOutput {
  modal: ModalState | null;
  setModal: (modal: ModalState | null) => void;
  host: RecordActionHost;
  /** Ref tracking the context of the currently-active action. Read by useRecordActions. */
  activeContextRef: React.MutableRefObject<RecordContext>;
}

/**
 * Encapsulates the record-action plumbing for the results panel: modal state,
 * the RecordActionHost adapter, and the activeContextRef threaded into action
 * execution. Extracting it keeps ResultsPanel focused on layout/orchestration.
 */
export function useResultsHost({ recordContext, onDocUpdated }: UseResultsHostInput): UseResultsHostOutput {
  const [modal, setModal] = useState<ModalState | null>(null);
  // Mirrors `modal` so host.close (called from action code, e.g. the Cancel
  // button in EditBody) can consult beforeClose without re-rendering through
  // a stale closure.
  const modalRef = useRef<ModalState | null>(null);
  modalRef.current = modal;

  const onDocUpdatedRef = useRef(onDocUpdated);
  onDocUpdatedRef.current = onDocUpdated;

  const activeContextRef = useRef<RecordContext>(recordContext);

  const host = useMemo<RecordActionHost>(() => {
    const h: RecordActionHost = {
      openModal(title, body, footer, options) {
        setModal({ title, body, footer, beforeClose: options?.beforeClose });
      },
      async close() {
        const gate = modalRef.current?.beforeClose;
        if (gate) {
          const result = await gate();
          if (result === false) return;
        }
        setModal(null);
      },
      triggerDocUpdate() {
        onDocUpdatedRef.current?.();
      },
      executeAction(id) {
        const action = recordActionRegistry.getById(id);
        if (!action) return;
        const ctx = activeContextRef.current;
        if (!action.canExecute(ctx)) return;
        action.execute(ctx, h);
      },
    };
    return h;
  }, []);

  return { modal, setModal, host, activeContextRef };
}
