import { describe, it, expect, beforeEach } from 'vitest';
import { useNotificationsStore } from './notifications';

beforeEach(() => {
  useNotificationsStore.setState({ notifications: [] });
});

describe('notifications store', () => {
  it('appends a notification and returns its id', () => {
    const id = useNotificationsStore.getState().notify({ level: 'info', message: 'hi' });
    const list = useNotificationsStore.getState().notifications;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(list[0].message).toBe('hi');
  });

  it('defaults error notifications to sticky (durationMs = 0)', () => {
    useNotificationsStore.getState().notify({ level: 'error', message: 'boom' });
    expect(useNotificationsStore.getState().notifications[0].durationMs).toBe(0);
  });

  it('gives non-error levels an auto-dismiss duration', () => {
    useNotificationsStore.getState().notify({ level: 'success', message: 'ok' });
    expect(useNotificationsStore.getState().notifications[0].durationMs).toBeGreaterThan(0);
  });

  it('honours an explicit durationMs override', () => {
    useNotificationsStore.getState().notify({ level: 'error', message: 'x', durationMs: 1000 });
    expect(useNotificationsStore.getState().notifications[0].durationMs).toBe(1000);
  });

  it('dismiss removes only the matching notification', () => {
    const first = useNotificationsStore.getState().notify({ level: 'info', message: 'a' });
    useNotificationsStore.getState().notify({ level: 'info', message: 'b' });
    useNotificationsStore.getState().dismiss(first);
    const list = useNotificationsStore.getState().notifications;
    expect(list).toHaveLength(1);
    expect(list[0].message).toBe('b');
  });

  it('clear empties the queue', () => {
    useNotificationsStore.getState().notify({ level: 'info', message: 'a' });
    useNotificationsStore.getState().clear();
    expect(useNotificationsStore.getState().notifications).toHaveLength(0);
  });

  it('dedupes an identical (level + message) toast instead of stacking', () => {
    const first = useNotificationsStore.getState().notify({ level: 'error', message: 'persist failed' });
    const second = useNotificationsStore
      .getState()
      .notify({ level: 'error', message: 'persist failed', detail: 'disk full' });
    const list = useNotificationsStore.getState().notifications;
    expect(list).toHaveLength(1);
    expect(second).toBe(first); // refreshed in place, same id
    expect(list[0].detail).toBe('disk full'); // detail refreshed
  });

  it('treats a different message or level as a distinct toast', () => {
    useNotificationsStore.getState().notify({ level: 'error', message: 'persist failed' });
    useNotificationsStore.getState().notify({ level: 'error', message: 'load failed' });
    useNotificationsStore.getState().notify({ level: 'warning', message: 'persist failed' });
    expect(useNotificationsStore.getState().notifications).toHaveLength(3);
  });

  it('caps the queue and drops the oldest distinct toasts', () => {
    for (let i = 0; i < 8; i += 1) {
      useNotificationsStore.getState().notify({ level: 'info', message: `msg-${i}` });
    }
    const list = useNotificationsStore.getState().notifications;
    expect(list).toHaveLength(5);
    expect(list[0].message).toBe('msg-3'); // msg-0..2 evicted
    expect(list[4].message).toBe('msg-7');
  });
});
