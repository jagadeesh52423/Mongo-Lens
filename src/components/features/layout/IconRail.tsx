import { IconButton, VStack } from '../../ui';
import type { ActivityItem } from '../../../layout/activityBar';
import styles from './IconRail.module.css';

interface Props {
  items: ActivityItem[];
  activeId: string | null;
  onChange: (id: string) => void;
  onSettingsOpen: () => void;
  settingsOpen: boolean;
}

export function IconRail({ items, activeId, onChange, onSettingsOpen, settingsOpen }: Props) {
  return (
    <VStack gap="none" className={styles.rail}>
      <div className={styles.logoCell}>
        <img src="/logo.svg" alt="Logo" className={styles.logo} />
      </div>
      {items.map((item) => {
        const isActive = !settingsOpen && activeId === item.id;
        const icon = item.iconUrl
          ? <img src={item.iconUrl} alt="" className={styles.iconImg} />
          : item.icon;
        return (
          <IconButton
            key={item.id}
            aria-label={item.title}
            tooltip={item.title}
            pressed={isActive}
            icon={icon}
            onClick={() => onChange(item.id)}
            className={`${styles.railBtn} ${isActive ? styles.active : ''}`}
          />
        );
      })}
      <div className={styles.spacer} />
      <IconButton
        aria-label="Settings"
        tooltip="Settings"
        pressed={settingsOpen}
        icon="⚙"
        onClick={onSettingsOpen}
        className={`${styles.railBtn} ${settingsOpen ? styles.active : ''}`}
      />
    </VStack>
  );
}
