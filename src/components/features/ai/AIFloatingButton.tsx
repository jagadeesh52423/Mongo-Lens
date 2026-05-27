import { useAIStore } from '../../../store/ai';
import styles from './AIFloatingButton.module.css';

export function AIFloatingButton() {
  const setPanelOpen = useAIStore((s) => s.setPanelOpen);
  return (
    <button
      type="button"
      aria-label="Open AI Assistant"
      title="Open AI Assistant"
      onClick={() => setPanelOpen(true)}
      className={styles.btn}
    >
      <span className={styles.icon}>✨</span>
    </button>
  );
}
