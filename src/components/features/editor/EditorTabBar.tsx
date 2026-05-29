import { MouseEvent } from 'react';
import { Toolbar } from '../../ui';
import type { EditorTab } from '../../../types';
import styles from './EditorTabBar.module.css';

interface Props {
  tabs: EditorTab[];
  activeTabId: string | null;
  isRunning: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
  onCancel: () => void;
}

/**
 * Horizontal tab strip with overflow scrolling, "+ New" button, and a
 * conditional Cancel button (shown while a script is running). Pure UI —
 * all state and handlers are owned by EditorArea.
 *
 * The .tab-scroll utility (in globals.css) hides the horizontal scrollbar
 * while keeping the row scrollable; behavior is preserved from the prior
 * inline implementation.
 */
export function EditorTabBar({
  tabs,
  activeTabId,
  isRunning,
  onSelect,
  onClose,
  onNewTab,
  onCancel,
}: Props) {
  function handleClose(e: MouseEvent, id: string) {
    e.stopPropagation();
    onClose(id);
  }

  const tabRow = (
    <div className={`tab-scroll ${styles.scroll}`}>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          className={`${styles.tab} ${tab.id === activeTabId ? styles.tabActive : ''}`}
        >
          <span>{tab.title}</span>
          {tab.isDirty && <span className={styles.dirty} aria-label="unsaved changes" />}
          <span onClick={(e) => handleClose(e, tab.id)} className={styles.close}>
            ✕
          </span>
        </div>
      ))}
      <button onClick={onNewTab} className={styles.newBtn}>+ New</button>
    </div>
  );

  return (
    <Toolbar
      className={styles.toolbar}
      left={tabRow}
      right={
        isRunning ? (
          <div className={styles.cancelWrap}>
            <button onClick={onCancel}>✕ Cancel</button>
          </div>
        ) : undefined
      }
    />
  );
}
