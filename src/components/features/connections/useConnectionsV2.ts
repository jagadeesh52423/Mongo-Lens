import { create } from 'zustand';
import {
  listV2,
  saveV2,
  deleteV2,
  testV2,
  type SaveInput,
  type TestResult,
} from '../../../connection/ipc';
import type { Connection } from '../../../connection/model';

/**
 * The connections store — single source of truth for the v2 connection list
 * AND the cross-cutting runtime state (`activeConnectionId`, `activeDatabase`,
 * `connectedIds`, `markConnected`, `markDisconnected`, `setActive`) that the
 * editor / context / AI subsystems read.
 */
export interface ConnectionsV2Store {
  // ────────── connection list (IPC-backed) ──────────
  connections: Connection[];
  loading: boolean;
  refresh: () => Promise<void>;
  save: (input: SaveInput) => Promise<Connection>;
  remove: (id: string) => Promise<void>;
  test: (input: SaveInput) => Promise<TestResult>;

  // ────────── runtime state (migrated from legacy store) ──────────
  /** Currently-selected connection in the UI; null when none. */
  activeConnectionId: string | null;
  /** Currently-selected database for the active connection; null when none. */
  activeDatabase: string | null;
  /** IDs of connections in the "live" state (connect succeeded, not yet disconnected). */
  connectedIds: Set<string>;
  /** Update the active selection. Pass null/null to clear. */
  setActive: (connectionId: string | null, database?: string | null) => void;
  /** Add an id to `connectedIds`. Idempotent. */
  markConnected: (id: string) => void;
  /** Drop an id from `connectedIds`. Idempotent. */
  markDisconnected: (id: string) => void;
}

export const useConnectionsV2 = create<ConnectionsV2Store>((set, get) => ({
  connections: [],
  loading: false,
  refresh: async () => {
    set({ loading: true });
    try {
      // Defensive: an undefined/null IPC response (e.g. from an unmocked test
      // path) must not poison the store with a non-array value, since UI code
      // calls `.find` on this list.
      const connections = (await listV2()) ?? [];
      set({ connections });
    } finally {
      set({ loading: false });
    }
  },
  save: async (input) => {
    const saved = await saveV2(input);
    await get().refresh();
    return saved;
  },
  remove: async (id) => {
    await deleteV2(id);
    // Match the legacy store's removeConnection side effects: clear active
    // selection if it pointed at the removed connection, and drop it from
    // the connected set — both invariants must hold across the IPC round trip.
    set((s) => ({
      activeConnectionId: s.activeConnectionId === id ? null : s.activeConnectionId,
      connectedIds: new Set([...s.connectedIds].filter((x) => x !== id)),
    }));
    await get().refresh();
  },
  test: (input) => testV2(input),

  activeConnectionId: null,
  activeDatabase: null,
  connectedIds: new Set(),
  setActive: (connectionId, database) =>
    set({ activeConnectionId: connectionId, activeDatabase: database ?? null }),
  markConnected: (id) =>
    set((s) => ({ connectedIds: new Set([...s.connectedIds, id]) })),
  markDisconnected: (id) =>
    set((s) => ({ connectedIds: new Set([...s.connectedIds].filter((x) => x !== id)) })),
}));
