import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorArea } from '../../components/editor/EditorArea';
import * as ipc from '../../ipc';
import { useEditorStore } from '../../store/editor';
import { useConnectionsStore } from '../../store/connections';
import { useResultsStore } from '../../store/results';

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v?: string) => void }) => (
    <textarea
      data-testid="mock-monaco"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

vi.mock('../../ipc', () => ({
  runScript: vi.fn().mockResolvedValue(undefined),
  cancelScript: vi.fn().mockResolvedValue(undefined),
  listCollections: vi.fn().mockResolvedValue([]),
  listDatabases: vi.fn().mockResolvedValue(['testdb']),
  createScript: vi.fn().mockResolvedValue({ id: 'new-id', name: 'test', content: '', tags: '', createdAt: '' }),
  updateScript: vi.fn().mockResolvedValue({ id: 'id', name: 'test', content: '', tags: '', createdAt: '' }),
}));

const mockConn = { id: 'conn-1', name: 'Test Connection', createdAt: '2026-01-01' };

function setupConnection() {
  useConnectionsStore.setState({
    connections: [mockConn],
    activeConnectionId: 'conn-1',
    activeDatabase: 'testdb',
    connectedIds: new Set(['conn-1']),
  });
}

beforeEach(() => {
  useEditorStore.setState({ tabs: [], activeTabId: null, savedScriptsVersion: 0 });
  useResultsStore.setState({ byTab: {} });
  useConnectionsStore.setState({
    connections: [],
    activeConnectionId: null,
    activeDatabase: null,
    connectedIds: new Set(),
  });
  vi.mocked(ipc.createScript).mockClear();
  vi.mocked(ipc.updateScript).mockClear();
  vi.mocked(ipc.listDatabases).mockResolvedValue(['testdb']);
});

describe('Save/Save As integration flow', () => {
  it('should open saved script, edit, save, then save as new', async () => {
    const user = userEvent.setup();
    setupConnection();

    // Step 1: Open a tab that represents a previously-saved script
    useEditorStore.getState().openTab({
      id: 'tab-1',
      title: 'My Query',
      content: 'db.users.find({})',
      isDirty: false,
      type: 'script',
      connectionId: 'conn-1',
      database: 'testdb',
      savedScriptId: 'script-100',
      savedScriptTags: 'users,query',
    });

    render(<EditorArea />);

    // Verify the saved script metadata is set
    const tab1 = useEditorStore.getState().tabs[0];
    expect(tab1.savedScriptId).toBe('script-100');
    expect(tab1.savedScriptTags).toBe('users,query');

    // Both Save and Save As buttons should be visible (since savedScriptId exists)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Save$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Save As/i })).toBeInTheDocument();
    });

    // Step 2: Edit the content — type into the Monaco mock
    const editor = screen.getByTestId('mock-monaco');
    await user.clear(editor);
    await user.type(editor, 'db.users.find({{} active: true })');

    // Tab should now be dirty
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);

    // Step 3: Save via the Save button (calls updateScript)
    vi.mocked(ipc.updateScript).mockResolvedValueOnce({
      id: 'script-100',
      name: 'My Query',
      content: 'db.users.find({ active: true })',
      tags: 'users,query',
      connectionId: 'conn-1',
      createdAt: '2026-01-01T00:00:00Z',
    });

    await user.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => {
      expect(ipc.updateScript).toHaveBeenCalledWith(
        'script-100',
        'My Query',
        expect.any(String),
        'users,query',
        'conn-1',
      );
    });

    // Tab should be clean after save
    await waitFor(() => {
      expect(useEditorStore.getState().tabs[0].isDirty).toBe(false);
    });

    // Step 4: Edit again and use Save As to create a new script
    await user.clear(editor);
    await user.type(editor, 'db.users.find({{} role: "admin" })');
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);

    vi.mocked(ipc.createScript).mockResolvedValueOnce({
      id: 'script-201',
      name: 'Admin Users Query',
      content: 'db.users.find({ role: "admin" })',
      tags: 'admin',
      connectionId: 'conn-1',
      createdAt: '2026-04-27T00:00:00Z',
    });

    // Click Save As — opens the dialog
    await user.click(screen.getByRole('button', { name: /Save As/i }));
    await waitFor(() => screen.getByRole('dialog'));

    // Fill in the dialog
    const inputs = screen.getAllByRole('textbox');
    const nameInput = inputs[0];
    const tagsInput = inputs[1];
    await user.clear(nameInput);
    await user.type(nameInput, 'Admin Users Query');
    await user.clear(tagsInput);
    await user.type(tagsInput, 'admin');

    // Click the Save button inside the dialog
    const dialogSaveBtn = screen.getByRole('dialog').querySelector('button:last-child')!;
    await user.click(dialogSaveBtn);

    await waitFor(() => {
      expect(ipc.createScript).toHaveBeenCalledWith(
        'Admin Users Query',
        expect.any(String),
        'admin',
        'conn-1',
      );
    });

    // Tab should now reference the new script
    await waitFor(() => {
      const updatedTab = useEditorStore.getState().tabs[0];
      expect(updatedTab.savedScriptId).toBe('script-201');
      expect(updatedTab.title).toBe('Admin Users Query');
      expect(updatedTab.isDirty).toBe(false);
    });
  });

  it('should open from collection, save as, then save updates the created script', async () => {
    const user = userEvent.setup();
    setupConnection();

    // Step 1: Open a tab with NO savedScriptId (as if opened from collection tree)
    useEditorStore.getState().openTab({
      id: 'tab-2',
      title: 'orders',
      content: 'db.orders.find({})',
      isDirty: false,
      type: 'script',
      connectionId: 'conn-1',
      database: 'testdb',
      collection: 'orders',
      // No savedScriptId — this is a collection-opened tab
    });

    render(<EditorArea />);

    // Verify no savedScriptId
    expect(useEditorStore.getState().tabs[0].savedScriptId).toBeUndefined();

    // Only Save As should be visible (no Save button since no savedScriptId)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Save As/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /^Save$/i })).not.toBeInTheDocument();

    // Step 2: Save As — creates a new saved script
    vi.mocked(ipc.createScript).mockResolvedValueOnce({
      id: 'script-300',
      name: 'Orders Query',
      content: 'db.orders.find({})',
      tags: 'orders',
      connectionId: 'conn-1',
      createdAt: '2026-04-27T00:00:00Z',
    });

    await user.click(screen.getByRole('button', { name: /Save As/i }));
    await waitFor(() => screen.getByRole('dialog'));

    const inputs = screen.getAllByRole('textbox');
    await user.clear(inputs[0]);
    await user.type(inputs[0], 'Orders Query');
    await user.clear(inputs[1]);
    await user.type(inputs[1], 'orders');

    const dialogSaveBtn = screen.getByRole('dialog').querySelector('button:last-child')!;
    await user.click(dialogSaveBtn);

    await waitFor(() => {
      expect(ipc.createScript).toHaveBeenCalledWith(
        'Orders Query',
        'db.orders.find({})',
        'orders',
        'conn-1',
      );
    });

    // Tab should now have a savedScriptId
    await waitFor(() => {
      const tab = useEditorStore.getState().tabs[0];
      expect(tab.savedScriptId).toBe('script-300');
      expect(tab.title).toBe('Orders Query');
      expect(tab.isDirty).toBe(false);
    });

    // Step 3: Now the Save button should appear (since savedScriptId is set)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Save$/i })).toBeInTheDocument();
    });

    // Step 4: Edit and then Save (should call updateScript, not createScript)
    const editor = screen.getByTestId('mock-monaco');
    await user.clear(editor);
    await user.type(editor, 'db.orders.find({{} status: "shipped" })');

    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);

    vi.mocked(ipc.updateScript).mockResolvedValueOnce({
      id: 'script-300',
      name: 'Orders Query',
      content: 'db.orders.find({ status: "shipped" })',
      tags: 'orders',
      connectionId: 'conn-1',
      createdAt: '2026-04-27T00:00:00Z',
    });

    await user.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => {
      expect(ipc.updateScript).toHaveBeenCalledWith(
        'script-300',
        'Orders Query',
        expect.any(String),
        'orders',
        'conn-1',
      );
    });

    // Tab should be clean again
    await waitFor(() => {
      expect(useEditorStore.getState().tabs[0].isDirty).toBe(false);
    });
  });
});
