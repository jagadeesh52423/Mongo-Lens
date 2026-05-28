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

export interface ConnectionsV2Store {
  connections: Connection[];
  loading: boolean;
  refresh: () => Promise<void>;
  save: (input: SaveInput) => Promise<Connection>;
  remove: (id: string) => Promise<void>;
  test: (input: SaveInput) => Promise<TestResult>;
}

export const useConnectionsV2 = create<ConnectionsV2Store>((set, get) => ({
  connections: [],
  loading: false,
  refresh: async () => {
    set({ loading: true });
    try {
      const connections = await listV2();
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
    await get().refresh();
  },
  test: (input) => testV2(input),
}));
