import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContextBar } from '../components/editor/ContextBar';
import { useConnectionsStore } from '../store/connections';

vi.mock('../ipc', () => ({
  listDatabases: vi.fn().mockResolvedValue(['testdb']),
}));

describe('ContextBar Save/Save As buttons', () => {
  const mockProps = {
    tabId: 'tab-1',
    connectionId: 'conn-1',
    database: 'testdb',
    onConnectionChange: vi.fn(),
    onDatabaseChange: vi.fn(),
    modes: [],
    onExecute: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    isRunning: false,
  };

  beforeEach(() => {
    useConnectionsStore.setState({
      connections: [{ id: 'conn-1', name: 'Test', createdAt: '2026-01-01' }],
      connectedIds: new Set(['conn-1']),
    });
  });

  it('should show both Save and Save As when hasSavedScript is true', () => {
    render(<ContextBar {...mockProps} hasSavedScript={true} />);

    expect(screen.getByRole('button', { name: /^Save$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save As/i })).toBeInTheDocument();
  });

  it('should show only Save As when hasSavedScript is false', () => {
    render(<ContextBar {...mockProps} hasSavedScript={false} />);

    expect(screen.queryByRole('button', { name: /^Save$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save As/i })).toBeInTheDocument();
  });
});
