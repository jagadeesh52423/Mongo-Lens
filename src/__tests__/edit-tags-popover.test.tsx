import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditTagsPopover } from '../components/features/saved-scripts/EditTagsPopover';

describe('EditTagsPopover', () => {
  it('clicking a suggestion adds it as a chip', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <EditTagsPopover
        initial={[]}
        allTags={['prod', 'auth', 'db']}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    expect(screen.queryByLabelText(/Remove tag prod/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'prod' }));
    await waitFor(() => {
      expect(screen.getByLabelText(/Remove tag prod/i)).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /^Save$/i }));
    expect(onSave).toHaveBeenCalledWith(['prod']);
  });

  it('Escape commits pending changes via onSave (not onCancel)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <EditTagsPopover
        initial={['prod']}
        allTags={['prod', 'auth']}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    const input = screen.getByPlaceholderText(/Add tag/);
    await user.type(input, 'auth');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(['prod', 'auth']);
    });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('shows Suggestions header and empty-state when all known tags are already added', () => {
    render(
      <EditTagsPopover
        initial={['prod', 'auth']}
        allTags={['prod', 'auth']}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/Suggestions/i)).toBeInTheDocument();
    expect(screen.getByText(/All known tags are already on this script/i)).toBeInTheDocument();
  });

  it('omits Suggestions section entirely when no tags exist anywhere', () => {
    render(
      <EditTagsPopover
        initial={[]}
        allTags={[]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Suggestions/i)).not.toBeInTheDocument();
  });
});
