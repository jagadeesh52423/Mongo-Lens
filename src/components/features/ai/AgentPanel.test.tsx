import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentPanel } from './AgentPanel';
import { useAgentStore } from '../../../store/agent';

vi.mock('../../../services/ai/activeTarget', () => ({
  getActiveTarget: () => ({ connectionId: 'c', database: 'd', collection: null }),
}));
vi.mock('../../../services/ai/agentRunner', () => ({ startAgentRun: vi.fn() }));
import { startAgentRun } from '../../../services/ai/agentRunner';

beforeEach(() => useAgentStore.setState({ byTab: {} }));

describe('AgentPanel', () => {
  it('renders transcript entries', () => {
    useAgentStore.getState().append('t1', { kind: 'tool-call', id: 'x', statement: 'db.u.find()' });
    render(<AgentPanel tabId="t1" />);
    expect(screen.getByText(/db\.u\.find/)).toBeInTheDocument();
  });

  it('starts a run on submit', () => {
    render(<AgentPanel tabId="t1" />);
    fireEvent.change(screen.getByPlaceholderText(/ask the agent/i), {
      target: { value: 'find active users' },
    });
    fireEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(startAgentRun).toHaveBeenCalledWith('t1', 'find active users', {
      connectionId: 'c',
      database: 'd',
    });
  });
});
