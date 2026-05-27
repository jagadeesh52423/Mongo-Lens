import { useState } from 'react';
import { Button, Dialog, FormField } from '../../ui';

interface Props {
  initialName?: string;
  initialTags?: string;
  onSave: (name: string, tags: string) => Promise<void>;
  onCancel: () => void;
}

export function SaveScriptDialog({ initialName = '', initialTags = '', onSave, onCancel }: Props) {
  const [name, setName] = useState(initialName);
  const [tags, setTags] = useState(initialTags);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) {
      setErr('Name is required');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onSave(name.trim(), tags);
    } catch (e) {
      setErr((e as Error).message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onCancel} ariaLabel="Save Script" width={360}>
      <Dialog.Header title="Save Script" onClose={onCancel} />
      <Dialog.Body>
        <FormField>
          <FormField.Label htmlFor="save-script-name">Name</FormField.Label>
          <FormField.Input
            id="save-script-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </FormField>
        <FormField>
          <FormField.Label htmlFor="save-script-tags">Tags (comma-separated)</FormField.Label>
          <FormField.Input
            id="save-script-tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </FormField>
        <FormField.Error>{err}</FormField.Error>
      </Dialog.Body>
      <Dialog.Footer>
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
