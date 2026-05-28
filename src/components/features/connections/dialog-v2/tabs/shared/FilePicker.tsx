import { open } from '@tauri-apps/plugin-dialog';
import { FormField } from '../../../../../ui/FormField';
import { Button } from '../../../../../ui/Button';
import styles from './FilePicker.module.css';

export interface FilePickerProps {
  id: string;
  label: string;
  value: string | undefined;
  onChange: (path: string | undefined) => void;
  filters?: { name: string; extensions: string[] }[];
}

export function FilePicker({ id, label, value, onChange, filters }: FilePickerProps) {
  async function browse() {
    const selected = await open({ multiple: false, directory: false, filters });
    if (typeof selected === 'string') onChange(selected);
  }
  return (
    <FormField>
      <FormField.Label htmlFor={id}>{label}</FormField.Label>
      <div className={styles.row}>
        <FormField.Input
          id={id}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
        <Button type="button" onClick={browse}>Browse…</Button>
      </div>
    </FormField>
  );
}
