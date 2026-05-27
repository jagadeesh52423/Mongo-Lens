import { Button, Dialog } from '../../ui';
import styles from './ConnectionPanel.module.css';

interface Props {
  message: string;
  onClose: () => void;
}

/**
 * Modal that surfaces a connection-attempt failure. Wraps the design-system
 * `Dialog` primitive so focus trapping, ESC-to-close, and backdrop-click
 * dismissal all come from the shared shell.
 */
export function ConnectionErrorDialog({ message, onClose }: Props) {
  return (
    <Dialog open onClose={onClose} ariaLabel="Connection error">
      <Dialog.Header title="Connection error" onClose={onClose} />
      <Dialog.Body>
        <pre className={styles.errorBody}>{message}</pre>
      </Dialog.Body>
      <Dialog.Footer>
        <Button autoFocus onClick={onClose}>OK</Button>
      </Dialog.Footer>
    </Dialog>
  );
}
