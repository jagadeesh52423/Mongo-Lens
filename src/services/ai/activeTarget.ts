import { useEditorStore } from '../../store/editor';
import { useConnectionsV2 } from '../../components/features/connections/useConnectionsV2';

export interface ActiveTarget {
  connectionId: string | null;
  database: string | null;
  collection: string | null;
}

/**
 * Resolve the active MongoDB target. The active editor tab's values override
 * the globally-active connection/database; collection only ever comes from the
 * tab. Used by both the AI context collectors and (later) the explain action.
 */
export function getActiveTarget(): ActiveTarget {
  const { tabs, activeTabId } = useEditorStore.getState();
  const { activeConnectionId, activeDatabase } = useConnectionsV2.getState();
  const tab = tabs.find((t) => t.id === activeTabId);
  return {
    connectionId: tab?.connectionId ?? activeConnectionId ?? null,
    database: tab?.database ?? activeDatabase ?? null,
    collection: tab?.collection ?? null,
  };
}
