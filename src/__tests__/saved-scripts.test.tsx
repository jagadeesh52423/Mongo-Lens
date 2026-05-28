import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { SavedScriptsPanel } from '../components/features/saved-scripts/SavedScriptsPanel';
import { useEditorStore } from '../store/editor';

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  invokeMock.mockReset();
  useEditorStore.setState({ tabs: [], activeTabId: null });
});

describe('SavedScriptsPanel', () => {
  it('loads and opens a script into a tab', async () => {
    invokeMock.mockResolvedValueOnce([
      { id: 's1', name: 'find users', content: 'db.users.find({})', tags: ['users'], createdAt: 't' },
    ]);
    const user = userEvent.setup();
    render(<SavedScriptsPanel />);
    await waitFor(() => expect(screen.getByText('find users')).toBeInTheDocument());
    await user.click(screen.getByText('find users'));
    expect(useEditorStore.getState().tabs[0].content).toBe('db.users.find({})');
  });

  it('should set savedScriptId and savedScriptTags when opening a script', async () => {
    invokeMock.mockResolvedValueOnce([
      { id: 'script-1', name: 'Test Script', content: 'db.test.find({})', tags: ['test'], createdAt: 't' },
    ]);
    const user = userEvent.setup();
    render(<SavedScriptsPanel />);
    await waitFor(() => expect(screen.getByText('Test Script')).toBeInTheDocument());

    await user.click(screen.getByText('Test Script'));

    const tabs = useEditorStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].savedScriptId).toBe('script-1');
    expect(tabs[0].savedScriptTags).toEqual(['test']);
    expect(tabs[0].isDirty).toBe(false);
  });

  it('filters by search query', async () => {
    invokeMock.mockResolvedValueOnce([
      { id: '1', name: 'alpha', content: '', tags: [], createdAt: 't' },
      { id: '2', name: 'beta', content: '', tags: [], createdAt: 't' },
    ]);
    const user = userEvent.setup();
    render(<SavedScriptsPanel />);
    await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Search…'), 'bet');
    expect(screen.queryByText('alpha')).not.toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
  });

  it('renders each tag as its own chip', async () => {
    invokeMock.mockResolvedValueOnce([
      { id: '1', name: 'q', content: '', tags: ['prod', 'auth'], createdAt: 't' },
    ]);
    render(<SavedScriptsPanel />);
    await waitFor(() => expect(screen.getByText('q')).toBeInTheDocument());
    expect(screen.getByText('prod')).toBeInTheDocument();
    expect(screen.getByText('auth')).toBeInTheDocument();
  });

  it('clicking a tag chip filters list by that tag', async () => {
    invokeMock.mockResolvedValueOnce([
      { id: '1', name: 'rowA', content: '', tags: ['prod'], createdAt: 't' },
      { id: '2', name: 'rowB', content: '', tags: ['auth'], createdAt: 't' },
    ]);
    const user = userEvent.setup();
    render(<SavedScriptsPanel />);
    await waitFor(() => expect(screen.getByText('rowA')).toBeInTheDocument());
    expect(screen.getByText('rowB')).toBeInTheDocument();

    await user.click(screen.getByText('prod'));

    expect(screen.getByText('rowA')).toBeInTheDocument();
    expect(screen.queryByText('rowB')).not.toBeInTheDocument();
    expect(screen.getByText(/Filter:/i)).toBeInTheDocument();
  });

  it('clear-filter button removes the filter', async () => {
    invokeMock.mockResolvedValueOnce([
      { id: '1', name: 'rowA', content: '', tags: ['prod'], createdAt: 't' },
      { id: '2', name: 'rowB', content: '', tags: ['auth'], createdAt: 't' },
    ]);
    const user = userEvent.setup();
    render(<SavedScriptsPanel />);
    await waitFor(() => expect(screen.getByText('rowA')).toBeInTheDocument());

    await user.click(screen.getByText('prod'));
    expect(screen.queryByText('rowB')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Remove tag prod'));

    expect(screen.getByText('rowA')).toBeInTheDocument();
    expect(screen.getByText('rowB')).toBeInTheDocument();
  });

  it('Manage tags dialog lists tags with counts and renames a tag', async () => {
    invokeMock.mockResolvedValueOnce([
      { id: '1', name: 'A', content: '', tags: ['prod', 'auth'], createdAt: 't' },
      { id: '2', name: 'B', content: '', tags: ['prod'], createdAt: 't' },
    ]);
    // rename_tag returns count
    invokeMock.mockResolvedValueOnce(2);
    // reload
    invokeMock.mockResolvedValueOnce([
      { id: '1', name: 'A', content: '', tags: ['production', 'auth'], createdAt: 't' },
      { id: '2', name: 'B', content: '', tags: ['production'], createdAt: 't' },
    ]);
    const user = userEvent.setup();
    render(<SavedScriptsPanel />);
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Manage tags/i }));
    const dialog = await screen.findByRole('dialog', { name: /Manage tags/i });
    const inDialog = within(dialog);

    // Two distinct tags shown: prod (2), auth (1)
    expect(inDialog.getByText('prod')).toBeInTheDocument();
    expect(inDialog.getByText('auth')).toBeInTheDocument();

    await user.click(inDialog.getByLabelText('Rename tag prod'));
    const renameInput = inDialog.getByDisplayValue('prod');
    await user.clear(renameInput);
    await user.type(renameInput, 'production');
    await user.click(inDialog.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => {
      const call = invokeMock.mock.calls.find((c) => c[0] === 'rename_tag');
      expect(call).toBeTruthy();
      expect(call![1]).toEqual({ old: 'prod', new: 'production' });
    });
  });

  it('Manage tags dialog deletes a tag with inline confirmation', async () => {
    invokeMock.mockResolvedValueOnce([
      { id: '1', name: 'A', content: '', tags: ['auth'], createdAt: 't' },
    ]);
    // delete_tag returns count
    invokeMock.mockResolvedValueOnce(1);
    // reload after delete
    invokeMock.mockResolvedValueOnce([
      { id: '1', name: 'A', content: '', tags: [], createdAt: 't' },
    ]);
    const user = userEvent.setup();
    render(<SavedScriptsPanel />);
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Manage tags/i }));
    const dialog = await screen.findByRole('dialog', { name: /Manage tags/i });
    const inDialog = within(dialog);

    await user.click(inDialog.getByLabelText('Delete tag auth'));
    // Inline confirm appears with a second "Delete" button (the confirm action).
    const deleteButtons = inDialog.getAllByRole('button', { name: /^Delete$/i });
    await user.click(deleteButtons[deleteButtons.length - 1]);

    await waitFor(() => {
      const call = invokeMock.mock.calls.find((c) => c[0] === 'delete_tag');
      expect(call).toBeTruthy();
      expect(call![1]).toEqual({ tag: 'auth' });
    });
  });

  it('"Edit tags" action opens popover; saving updates tags via updateScript', async () => {
    invokeMock.mockResolvedValueOnce([
      { id: '1', name: 'rowA', content: 'db.x.find({})', tags: ['prod'], createdAt: 't' },
    ]);
    // updateScript call
    invokeMock.mockResolvedValueOnce({
      id: '1', name: 'rowA', content: 'db.x.find({})', tags: ['prod', 'newtag'], createdAt: 't',
    });
    // reload after save
    invokeMock.mockResolvedValueOnce([
      { id: '1', name: 'rowA', content: 'db.x.find({})', tags: ['prod', 'newtag'], createdAt: 't' },
    ]);
    const user = userEvent.setup();
    render(<SavedScriptsPanel />);
    await waitFor(() => expect(screen.getByText('rowA')).toBeInTheDocument());

    await user.click(screen.getByLabelText('Edit tags for rowA'));

    const popover = await screen.findByRole('dialog', { name: /Edit tags/i });
    const input = popover.querySelector('input') as HTMLInputElement;
    await user.type(input, 'newtag');
    await user.keyboard('{Enter}');

    await user.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => {
      const updateCall = invokeMock.mock.calls.find((c) => c[0] === 'update_script');
      expect(updateCall).toBeTruthy();
      expect(updateCall![1].tags).toEqual(['prod', 'newtag']);
    });
  });

  it('Edit-tags popover flushes pending input on Save without requiring Enter', async () => {
    invokeMock.mockResolvedValueOnce([
      { id: '1', name: 'rowA', content: 'db.x.find({})', tags: ['prod'], createdAt: 't' },
    ]);
    // updateScript call
    invokeMock.mockResolvedValueOnce({
      id: '1', name: 'rowA', content: 'db.x.find({})', tags: ['prod', 'pending'], createdAt: 't',
    });
    // reload after save
    invokeMock.mockResolvedValueOnce([
      { id: '1', name: 'rowA', content: 'db.x.find({})', tags: ['prod', 'pending'], createdAt: 't' },
    ]);
    const user = userEvent.setup();
    render(<SavedScriptsPanel />);
    await waitFor(() => expect(screen.getByText('rowA')).toBeInTheDocument());

    await user.click(screen.getByLabelText('Edit tags for rowA'));
    const popover = await screen.findByRole('dialog', { name: /Edit tags/i });
    const input = popover.querySelector('input') as HTMLInputElement;

    // Type a tag but do NOT press Enter — go straight to Save.
    await user.type(input, 'pending');
    await user.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => {
      const updateCall = invokeMock.mock.calls.find((c) => c[0] === 'update_script');
      expect(updateCall).toBeTruthy();
      expect(updateCall![1].tags).toEqual(['prod', 'pending']);
    });
  });
});
