import { IconButton } from '../../ui';
import styles from './AIChatHeader.module.css';

interface Props {
  /** Called when the user clicks the close (collapse) button. */
  onClose: () => void;
}

/**
 * Header strip for the AI chat panel — title on the left, collapse button on
 * the right. Settings and clear-context actions live in the input area's
 * footer, not here, because they are tied to message-list state.
 */
export function AIChatHeader({ onClose }: Props) {
  return (
    <div className={styles.header}>
      <span className={styles.title}>✨ AI Assistant</span>
      <IconButton
        aria-label="Close AI panel"
        tooltip="Close"
        size="sm"
        onClick={onClose}
        icon={<span className={styles.closeGlyph}>×</span>}
      />
    </div>
  );
}
