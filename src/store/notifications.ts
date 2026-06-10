import { create } from 'zustand';

/**
 * App-wide transient notifications (toasts). The single mechanism for surfacing
 * out-of-band success/failure that has no natural inline home — e.g. a settings
 * write that fails after the user already moved on.
 *
 * Push from anywhere (inside or outside React):
 *   useNotificationsStore.getState().notify({ level: 'error', message: '...' });
 *
 * `level` is plain data, not a hardcoded switch — the <Toaster> host maps each
 * level to a style token via a registry, so adding a level needs no store change.
 */
export type NotificationLevel = 'error' | 'warning' | 'info' | 'success';

export interface Notification {
  id: string;
  level: NotificationLevel;
  message: string;
  /** Optional secondary line (e.g. an error detail), shown muted under the message. */
  detail?: string;
  /**
   * Auto-dismiss delay in ms. `0` (or absent) means sticky — the user must
   * dismiss it. Errors default to sticky so they are never missed.
   */
  durationMs: number;
}

export type NotifyInput = Omit<Notification, 'id' | 'durationMs'> & { durationMs?: number };

interface NotificationsState {
  notifications: Notification[];
  notify: (input: NotifyInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

/** Default auto-dismiss per level; errors stay until dismissed. */
const DEFAULT_DURATION_MS: Record<NotificationLevel, number> = {
  error: 0,
  warning: 6000,
  info: 5000,
  success: 4000,
};

let nextId = 0;
function makeId(): string {
  nextId += 1;
  return `ntf-${nextId}`;
}

export const useNotificationsStore = create<NotificationsState>((set) => ({
  notifications: [],

  notify: (input) => {
    const id = makeId();
    const notification: Notification = {
      id,
      level: input.level,
      message: input.message,
      detail: input.detail,
      durationMs: input.durationMs ?? DEFAULT_DURATION_MS[input.level],
    };
    set((s) => ({ notifications: [...s.notifications, notification] }));
    return id;
  },

  dismiss: (id) =>
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })),

  clear: () => set({ notifications: [] }),
}));
