import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PluginConfigForm } from '../plugins/ui/PluginConfigForm';
import type { ConfigurationContribution } from '../plugins/manifest';

const schema: ConfigurationContribution = {
  title: 'Datafleet',
  properties: {
    url:      { type: 'string', minLength: 1, title: 'URL' },
    password: { type: 'string', 'x-secret': true, title: 'Password' },
    timeout:  { type: 'integer', minimum: 0, maximum: 100, default: 30, title: 'Timeout' },
  },
  required: ['url'],
};

describe('PluginConfigForm — base', () => {
  it('renders one field per property using the registry', () => {
    render(<PluginConfigForm
      schema={schema} initialValues={{ url: 'http://x', timeout: 30 }}
      onSave={async () => {}} onCancel={() => {}}
    />);
    expect(screen.getByLabelText('URL')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.getByLabelText('Timeout')).toBeTruthy();
  });

  it('Save button disabled with no dirty keys', () => {
    render(<PluginConfigForm
      schema={schema} initialValues={{ url: 'http://x' }}
      onSave={async () => {}} onCancel={() => {}}
    />);
    expect((screen.getByRole('button', { name: /save/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Save enabled after a dirty edit; calls onSave with current values', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PluginConfigForm
      schema={schema} initialValues={{ url: 'http://x' }}
      onSave={onSave} onCancel={() => {}}
    />);
    const urlInput = screen.getByLabelText('URL') as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: 'http://new' } });
    fireEvent.blur(urlInput);
    const save = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ url: 'http://new' }))
    );
  });

  it('Save disabled when validation errors exist', () => {
    render(<PluginConfigForm
      schema={schema} initialValues={{ url: 'http://x' }}
      onSave={async () => {}} onCancel={() => {}}
    />);
    const urlInput = screen.getByLabelText('URL') as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: '' } });   // violates minLength:1
    fireEvent.blur(urlInput);
    expect((screen.getByRole('button', { name: /save/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows error banner when onSave rejects; banner clears on next successful save', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Keychain is locked'));
    render(<PluginConfigForm
      schema={schema} initialValues={{ url: 'http://x' }}
      onSave={onSave} onCancel={() => {}}
    />);
    const urlInput = screen.getByLabelText('URL') as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: 'http://new' } });
    fireEvent.blur(urlInput);
    await waitFor(() => expect((screen.getByRole('button', { name: /save/i }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Keychain is locked');
    // retry hint present because message contains "Keychain"
    expect(alert.textContent).toContain('Click Save again to retry');

    // Now let save succeed — banner should disappear
    onSave.mockResolvedValue(undefined);
    fireEvent.change(urlInput, { target: { value: 'http://other' } });
    fireEvent.blur(urlInput);
    await waitFor(() => expect((screen.getByRole('button', { name: /save/i }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('Cancel reverts to initial and calls onCancel', () => {
    const onCancel = vi.fn();
    render(<PluginConfigForm
      schema={schema} initialValues={{ url: 'http://x' }}
      onSave={async () => {}} onCancel={onCancel}
    />);
    const urlInput = screen.getByLabelText('URL') as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: 'changed' } });
    fireEvent.blur(urlInput);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
    expect((screen.getByLabelText('URL') as HTMLInputElement).value).toBe('http://x');
  });
});
