import { Button, Dialog, Text } from '../../ui';
import styles from './HostKeyDialog.module.css';

interface HostKeyDialogProps {
  host: string;
  port: number;
  algorithm: string;
  fingerprint: string;
  onAccept: () => void;
  onReject: () => void;
}

/**
 * Displays the SSH host key fingerprint and asks the user whether to trust it.
 * Shown when `connect_connection` returns `HostKeyUnknown`.
 * On accept the connection is retried with `acceptHostKey: true`, causing the
 * key to be persisted to the app's known_hosts file.
 */
export function HostKeyDialog({
  host,
  port,
  algorithm,
  fingerprint,
  onAccept,
  onReject,
}: HostKeyDialogProps) {
  return (
    <Dialog open onClose={onReject} ariaLabel="Unknown SSH Host Key" width={440}>
      <Dialog.Header title="Unknown SSH Host Key" onClose={onReject} />
      <Dialog.Body>
        <div className={styles.body}>
          <Text variant="dim" as="p">
            The authenticity of <strong>{host}:{port}</strong> cannot be established.
            Its {algorithm} key fingerprint is:
          </Text>
          <code className={styles.fingerprint}>{fingerprint}</code>
          <Text variant="dim" as="p">
            Are you sure you want to connect? If you trust this host, the key will be
            saved and you will not be prompted again.
          </Text>
        </div>
      </Dialog.Body>
      <Dialog.Footer>
        <Button onClick={onReject}>Cancel</Button>
        <Button variant="danger" onClick={onAccept}>Trust &amp; Connect</Button>
      </Dialog.Footer>
    </Dialog>
  );
}
