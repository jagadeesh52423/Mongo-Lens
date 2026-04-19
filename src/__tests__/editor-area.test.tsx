import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorArea } from '../components/editor/EditorArea';
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
    const runBtn = screen.getByRole('button', { name: /run/i });
    expect(runBtn).not.toBeDisabled();
  });

  it('Run button is disabled when isRunning', () => {
    openScriptTab();
    useResultsStore.getState().startRun('t1', 'run-1');
    render(<EditorArea />);
    const runBtn = screen.getByRole('button', { name: /run/i });
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
    await user.click(screen.getByRole('button', { name: /run/i }));
    // Wait for the rejected promise to settle
    await new Promise((r) => setTimeout(r, 0));
    const state = useResultsStore.getState().byTab['t1'];
    expect(state?.lastError).toBeUndefined();
  });
});
