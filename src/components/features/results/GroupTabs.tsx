import styles from './GroupTabs.module.css';

interface Props {
  groupCount: number;
  logsCount: number;
  active: number | 'console';
  onChange: (next: number | 'console') => void;
}

/** Sub-toolbar tab strip: one tab per result group + an optional Console tab. */
export function GroupTabs({ groupCount, logsCount, active, onChange }: Props) {
  const hasLogs = logsCount > 0;
  if (groupCount <= 1 && !hasLogs) return null;
  const isConsoleActive = active === 'console';
  return (
    <div role="tablist" className={styles.strip}>
      {Array.from({ length: groupCount }, (_, idx) => {
        const isActive = !isConsoleActive && idx === active;
        return (
          <button
            key={idx}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(idx)}
            className={isActive ? `${styles.tab} ${styles.active}` : styles.tab}
          >
            Query {idx + 1}
          </button>
        );
      })}
      {hasLogs && (
        <button
          role="tab"
          aria-selected={isConsoleActive}
          onClick={() => onChange('console')}
          className={isConsoleActive ? `${styles.tab} ${styles.active}` : styles.tab}
        >
          Console ({logsCount})
        </button>
      )}
    </div>
  );
}
