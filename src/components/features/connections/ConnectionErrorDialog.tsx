import { Button, Dialog } from '../../ui';
import { stageHeading, type StagedErrorMessage } from '../../../connection/staged-error';
import styles from './ConnectionPanel.module.css';

interface Props {
  /** Name of the connection that failed, shown as a subtitle. */
  connectionName: string;
  /**
   * Either a legacy plain error string (old IPC path) or a staged
   * `{ stage, error }` payload from `connections_v2_*`. Keeping the legacy
   * shape unblocks existing callers; staged callers get a stage heading.
   */
  message: StagedErrorMessage;
  onClose: () => void;
}

/**
 * Modal that surfaces a connection-attempt failure. Wraps the design-system
 * `Dialog` primitive so focus trapping, ESC-to-close, and backdrop-click
 * dismissal all come from the shared shell.
 *
 * Rendering branches on the message shape:
 *   - string → plain text body (legacy)
 *   - { stage, error } → bold stage heading + error detail body
 */
export function ConnectionErrorDialog({ connectionName, message, onClose }: Props) {
  const isStaged = typeof message !== 'string';
  return (
    <Dialog open onClose={onClose} ariaLabel="Connection error">
      <Dialog.Header title="Connection error" onClose={onClose} />
      <Dialog.Body>
        <p className={styles.errorSubtitle}>Failed to connect to “{connectionName}”</p>
        {isStaged ? (
          <>
            <strong>{stageHeading(message.stage)}</strong>
            <pre className={styles.errorBody}>{message.error}</pre>
          </>
        ) : (
          <pre className={styles.errorBody}>{message}</pre>
        )}
      </Dialog.Body>
      <Dialog.Footer>
        <Button autoFocus onClick={onClose}>OK</Button>
      </Dialog.Footer>
    </Dialog>
  );
}
