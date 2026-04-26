import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorArea } from '../components/editor/EditorArea';
import * as ipc from '../ipc';
import { useEditorStore } from '../store/editor';
import { useConnectionsStore } from '../store/connections';
import { useResultsStore } from '../store/results';

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v?: string) => void }) => (
    <textarea
      data-testid="mock-monaco"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

vi.mock('../ipc', () => ({
  runScript: vi.fn().mockResolvedValue(undefined),
  cancelScript: vi.fn().mockResolvedValue(undefined),
  listCollections: vi.fn().mockResolvedValue([]),
  listDatabases: vi.fn().mockResolvedValue(['mydb']),
  createScript: vi.fn().mockResolvedValue({ id: 'new-id', name: 'test', content: '', tags: '', createdAt: '' }),
  updateScript: vi.fn().mockResolvedValue({ id: 'id', name: 'test', content: '', tags: '', createdAt: '' }),
}));

const mockConn = { id: 'conn1', name: 'Test Connection', createdAt: new Date().toISOString() };

function openScriptTab() {
  useConnectionsStore.setState({
    connections: [mockConn],
    activeConnectionId: 'conn1',
    activeDatabase: 'mydb',
    connectedIds: new Set(['conn1']),
  });
  useEditorStore.getState().openTab({
    id: 't1', title: 'a.js', content: 'db.users.find({})', isDirty: false, type: 'script',
  });
}

beforeEach(() => {
  useEditorStore.setState({ tabs: [], activeTabId: null });
  useResultsStore.setState({ byTab: {} });
  useConnectionsStore.setState({
    connections: [], activeConnectionId: null, activeDatabase: null, connectedIds: new Set(),
  });
});

describe('EditorArea', () => {
  it('renders placeholder with no tabs', () => {
    render(<EditorArea />);
    expect(screen.getByText(/No editor tab/i)).toBeInTheDocument();
  });

  it('renders a script tab and updates content', async () => {
    useEditorStore.getState().openTab({
      id: 't1', title: 'a.js', content: 'db.users.find({})', isDirty: false, type: 'script',
    });
    const user = userEvent.setup();
    render(<EditorArea />);
    const ta = screen.getByTestId('mock-monaco') as HTMLTextAreaElement;
    await user.clear(ta);
    await user.type(ta, 'x');
    expect(useEditorStore.getState().tabs[0].content).toBe('x');
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
  });

  it('Run button is enabled when not running', () => {
    openScriptTab();
    render(<EditorArea />);
    const runBtn = screen.getByRole('button', { name: /^▶ Run$/ });
    expect(runBtn).not.toBeDisabled();
  });

  it('Run button is disabled when isRunning', () => {
    openScriptTab();
    useResultsStore.getState().startRun('t1', 'run-1');
    render(<EditorArea />);
    const runBtn = screen.getByRole('button', { name: /^▶ Run$/ });
    expect(runBtn).toBeDisabled();
  });

  it('Cancel button appears only when isRunning', () => {
    openScriptTab();
    render(<EditorArea />);
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();

    cleanup();
    useResultsStore.getState().startRun('t1', 'run-1');
    render(<EditorArea />);
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('Cancel button calls cancelScript and finishRun', async () => {
    const { cancelScript } = await import('../ipc');
    openScriptTab();
    useResultsStore.getState().startRun('t1', 'run-1');
    const user = userEvent.setup();
    render(<EditorArea />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(cancelScript).toHaveBeenCalledWith('t1');
    expect(useResultsStore.getState().byTab['t1'].isRunning).toBe(false);
  });

  it('swallows cancelled error when runScript rejects with cancel message', async () => {
    const { runScript } = await import('../ipc');
    vi.mocked(runScript).mockRejectedValueOnce(new Error('cancelled'));
    openScriptTab();
    const user = userEvent.setup();
    render(<EditorArea />);
    await user.click(screen.getByRole('button', { name: /^▶ Run$/ }));
    // Wait for the rejected promise to settle
    await new Promise((r) => setTimeout(r, 0));
    const state = useResultsStore.getState().byTab['t1'];
    expect(state?.lastError).toBeUndefined();
  });
});

describe('EditorArea Save/Save As handlers', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: [], activeTabId: null, savedScriptsVersion: 0 });
    useConnectionsStore.setState({
      connections: [{ id: 'conn-1', name: 'Test', createdAt: '2026-01-01' }],
      connectedIds: new Set(['conn-1']),
      activeConnectionId: 'conn-1',
      activeDatabase: 'testdb',
    });
    vi.mocked(ipc.listDatabases).mockResolvedValue(['testdb']);
  });

  it('handleSave should call updateScript with existing metadata', async () => {
    const updateScriptMock = vi.mocked(ipc.updateScript).mockResolvedValue({
      id: 'script-1',
      name: 'Existing Script',
      content: 'db.test.find({updated: true})',
      tags: 'original,tags',
      connectionId: 'conn-1',
      createdAt: '2026-04-27T00:00:00Z',
    });

    useEditorStore.setState({
      tabs: [{
        id: 'tab-1',
        title: 'Existing Script',
        content: 'db.test.find({updated: true})',
        isDirty: true,
        type: 'script',
        connectionId: 'conn-1',
        database: 'testdb',
        savedScriptId: 'script-1',
        savedScriptTags: 'original,tags',
      }],
      activeTabId: 'tab-1',
    });

    render(<EditorArea />);
    await waitFor(() => screen.getByText(/Existing Script/));

    const saveButton = screen.getByRole('button', { name: /^Save$/i });
    await userEvent.click(saveButton);

    expect(updateScriptMock).toHaveBeenCalledWith(
      'script-1',
      'Existing Script',
      'db.test.find({updated: true})',
      'original,tags',
      'conn-1'
    );

    const tab = useEditorStore.getState().tabs[0];
    expect(tab.isDirty).toBe(false);
  });

  it('handleSaveAs should prompt, create script, and update tab', async () => {
    vi.mocked(ipc.createScript).mockResolvedValue({
      id: 'new-script-id',
      name: 'New Script Name',
      content: 'db.test.find({})',
      tags: '',
      connectionId: 'conn-1',
      createdAt: '2026-04-27T01:00:00Z',
    });

    useEditorStore.setState({
      tabs: [{
        id: 'tab-2',
        title: 'Untitled',
        content: 'db.test.find({})',
        isDirty: true,
        type: 'script',
        connectionId: 'conn-1',
        database: 'testdb',
      }],
      activeTabId: 'tab-2',
    });

    render(<EditorArea />);
    await waitFor(() => screen.getByText(/Untitled/));

    const saveAsButton = screen.getByRole('button', { name: /Save As/i });
    await userEvent.click(saveAsButton);

    // Dialog should appear
    await waitFor(() => screen.getByRole('dialog'));

    const inputs = screen.getAllByRole('textbox');
    const nameInput = inputs[0];
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'New Script Name');

    const saveDialogButton = screen.getByRole('button', { name: /^Save$/i });
    await userEvent.click(saveDialogButton);

    await waitFor(() => {
      expect(vi.mocked(ipc.createScript)).toHaveBeenCalledWith(
        'New Script Name',
        'db.test.find({})',
        '',
        'conn-1'
      );
    });

    const tab = useEditorStore.getState().tabs[0];
    expect(tab.savedScriptId).toBe('new-script-id');
    expect(tab.title).toBe('New Script Name');
    expect(tab.isDirty).toBe(false);
  });
});
