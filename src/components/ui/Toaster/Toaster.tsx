/**
 * Toaster — renders the app-wide notification queue from `useNotificationsStore`.
 *
 * Mount once near the layout root. Producers never import this; they push via
 * `useNotificationsStore.getState().notify(...)`.
 *
 * To add a notification level: add it to `NotificationLevel`, give it a default
 * duration in the store, and add a `.<level>` rule in Toaster.module.css. The
 * `levelClass` registry below resolves the class — no JSX branching to touch.
 */
import { useEffect } from 'react';
import { IconButton } from '../IconButton';
import {
  useNotificationsStore,
  type Notification,
  type NotificationLevel,
} from '../../../store/notifications';
import styles from './Toaster.module.css';

const levelClass: Record<NotificationLevel, string> = {
  error: styles.error,
  warning: styles.warning,
  info: styles.info,
  success: styles.success,
};

function ToastItem({ notification }: { notification: Notification }) {
  const dismiss = useNotificationsStore((s) => s.dismiss);

  useEffect(() => {
    if (notification.durationMs <= 0) return;
    const timer = setTimeout(() => dismiss(notification.id), notification.durationMs);
    return () => clearTimeout(timer);
  }, [notification.id, notification.durationMs, dismiss]);

  return (
    <div className={`${styles.toast} ${levelClass[notification.level]}`} role="alert">
      <div className={styles.content}>
        <span className={styles.message}>{notification.message}</span>
        {notification.detail && <span className={styles.detail}>{notification.detail}</span>}
      </div>
      <IconButton
        aria-label="Dismiss notification"
        icon="✕"
        size="sm"
        onClick={() => dismiss(notification.id)}
      />
    </div>
  );
}

export function Toaster() {
  const notifications = useNotificationsStore((s) => s.notifications);
  if (notifications.length === 0) return null;
  return (
    <div className={styles.region} role="region" aria-label="Notifications">
      {notifications.map((notification) => (
        <ToastItem key={notification.id} notification={notification} />
      ))}
    </div>
  );
}
