import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PluginConfigForm } from '../plugins/ui/PluginConfigForm';
import type { ConfigurationContribution } from '../plugins/manifest';

const schema: ConfigurationContribution = {
  title: 'X',
  properties: {
    a: { type: 'string', title: 'A' },
    b: { type: 'string', title: 'B' },
  },
};

function undo(el: HTMLElement) {
  fireEvent.keyDown(el, { key: 'z', metaKey: true });
}
function redo(el: HTMLElement) {
  fireEvent.keyDown(el, { key: 'z', metaKey: true, shiftKey: true });
}

describe('PluginConfigForm — undo/redo', () => {
  it('Cmd-Z walks back through commits across fields regardless of focus', () => {
    render(<PluginConfigForm
      schema={schema} initialValues={{ a: '', b: '' }}
      onSave={async () => {}} onCancel={() => {}}
    />);
    const a = screen.getByLabelText('A') as HTMLInputElement;
    const b = screen.getByLabelText('B') as HTMLInputElement;
    const form = a.closest('form')!;

    fireEvent.change(a, { target: { value: 'a1' } }); fireEvent.blur(a);
    fireEvent.change(b, { target: { value: 'b1' } }); fireEvent.blur(b);
    fireEvent.change(a, { target: { value: 'a2' } }); fireEvent.blur(a);

    undo(form); // a back to a1
    expect((screen.getByLabelText('A') as HTMLInputElement).value).toBe('a1');
    undo(form); // b back to ''
    expect((screen.getByLabelText('B') as HTMLInputElement).value).toBe('');
    undo(form); // a back to ''
    expect((screen.getByLabelText('A') as HTMLInputElement).value).toBe('');
  });

  it('Cmd-Shift-Z redoes', () => {
    render(<PluginConfigForm
      schema={schema} initialValues={{ a: '', b: '' }}
      onSave={async () => {}} onCancel={() => {}}
    />);
    const a = screen.getByLabelText('A') as HTMLInputElement;
    const form = a.closest('form')!;
    fireEvent.change(a, { target: { value: 'a1' } }); fireEvent.blur(a);
    undo(form);
    expect((screen.getByLabelText('A') as HTMLInputElement).value).toBe('');
    redo(form);
    expect((screen.getByLabelText('A') as HTMLInputElement).value).toBe('a1');
  });

  it('Save clears both stacks', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PluginConfigForm
      schema={schema} initialValues={{ a: '', b: '' }}
      onSave={onSave} onCancel={() => {}}
    />);
    const a = screen.getByLabelText('A') as HTMLInputElement;
    const form = a.closest('form')!;
    fireEvent.change(a, { target: { value: 'a1' } }); fireEvent.blur(a);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    // Wait for the async save to complete before testing undo state.
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    // After save completes, undo should be a no-op.
    undo(form);
    expect((screen.getByLabelText('A') as HTMLInputElement).value).toBe('a1');
  });

  it('undo stack survives a failed save — history is preserved so the user can undo', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('keychain locked'));
    render(<PluginConfigForm
      schema={schema} initialValues={{ a: '', b: '' }}
      onSave={onSave} onCancel={() => {}}
    />);
    const a = screen.getByLabelText('A') as HTMLInputElement;
    const form = a.closest('form')!;

    fireEvent.change(a, { target: { value: 'a1' } }); fireEvent.blur(a);
    // dirtyKeys.size > 0 now, so Save is enabled
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    // Wait for the save attempt to reject
    await waitFor(() => expect(onSave).toHaveBeenCalled());

    // Undo stack must still be intact after the failed save
    undo(form);
    expect((screen.getByLabelText('A') as HTMLInputElement).value).toBe('');
  });

  it('caps undo stack at 50; oldest dropped on 51st commit', () => {
    render(<PluginConfigForm
      schema={schema} initialValues={{ a: '', b: '' }}
      onSave={async () => {}} onCancel={() => {}}
    />);
    const a = screen.getByLabelText('A') as HTMLInputElement;
    const form = a.closest('form')!;
    for (let i = 1; i <= 51; i++) {
      fireEvent.change(a, { target: { value: `v${i}` } });
      fireEvent.blur(a);
    }
    // Undo 50 times — should reach v1 but not the original ''.
    for (let i = 0; i < 50; i++) undo(form);
    expect((screen.getByLabelText('A') as HTMLInputElement).value).toBe('v1');
    // One more undo is a no-op since stack is empty.
    undo(form);
    expect((screen.getByLabelText('A') as HTMLInputElement).value).toBe('v1');
  });
});
