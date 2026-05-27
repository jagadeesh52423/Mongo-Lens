import { useState } from 'react';
import { Button, Dialog, FormField, Text } from '../../ui';
import styles from './PassphraseDialog.module.css';

interface PassphraseDialogProps {
  /** Connection name shown in the dialog title. */
  connectionName: string;
  onConfirm: (passphrase: string) => void;
  onCancel: () => void;
}

/**
 * Prompts the user for the SSH private-key passphrase.
 * Shown when `connect_connection` returns `PassphraseRequired`.
 */
export function PassphraseDialog({ connectionName, onConfirm, onCancel }: PassphraseDialogProps) {
  const [passphrase, setPassphrase] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!passphrase) return;
    onConfirm(passphrase);
  }

  return (
    <Dialog open onClose={onCancel} ariaLabel="SSH Key Passphrase" width={360}>
      <Dialog.Header title="SSH Key Passphrase" onClose={onCancel} />
      <form onSubmit={handleSubmit}>
        <Dialog.Body>
          <div className={styles.body}>
            <Text variant="dim" as="p">
              The SSH key for <strong>{connectionName}</strong> is encrypted.
              Enter the passphrase to continue.
            </Text>
            <FormField>
              <FormField.Label htmlFor="passphrase-input">Passphrase</FormField.Label>
              <FormField.Input
                id="passphrase-input"
                type="password"
                autoFocus
                placeholder="Passphrase"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </FormField>
          </div>
        </Dialog.Body>
        <Dialog.Footer>
          <Button type="button" onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!passphrase}>Connect</Button>
        </Dialog.Footer>
      </form>
    </Dialog>
  );
}
