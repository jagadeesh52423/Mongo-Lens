import { ask } from '@tauri-apps/plugin-dialog';

export function confirmDiscardUnsaved(): Promise<boolean> {
  return ask('You have unsaved changes. Discard them?', {
    title: 'Unsaved changes',
    kind: 'warning',
  });
}
