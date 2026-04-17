import { create } from 'zustand';
import type { Connection } from '../types';

interface ConnectionsState {
  connections: Connection[];
  activeConnectionId: string | null;
  activeDatabase: string | null;
  connectedIds: Set<string>;
  setConnections: (list: Connection[]) => void;
  addConnection: (c: Connection) => void;
  updateConnection: (c: Connection) => void;
  removeConnection: (id: string) => void;
  setActive: (connectionId: string | null, database?: string | null) => void;
  markConnected: (id: string) => void;
  markDisconnected: (id: string) => void;
}

export const useConnectionsStore = create<ConnectionsState>((set) => ({
  connections: [],
  activeConnectionId: null,
  activeDatabase: null,
  connectedIds: new Set(),
  setConnections: (list) => set({ connections: list }),
  addConnection: (c) => set((s) => ({ connections: [...s.connections, c] })),
  updateConnection: (c) =>
    set((s) => ({
      connections: s.connections.map((x) => (x.id === c.id ? c : x)),
    })),
  removeConnection: (id) =>
    set((s) => ({
      connections: s.connections.filter((x) => x.id !== id),
      activeConnectionId: s.activeConnectionId === id ? null : s.activeConnectionId,
      connectedIds: new Set([...s.connectedIds].filter((x) => x !== id)),
    })),
  setActive: (connectionId, database) =>
    set({ activeConnectionId: connectionId, activeDatabase: database ?? null }),
  markConnected: (id) =>
    set((s) => ({ connectedIds: new Set([...s.connectedIds, id]) })),
  markDisconnected: (id) =>
    set((s) => ({ connectedIds: new Set([...s.connectedIds].filter((x) => x !== id)) })),
}));
