import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AIChatPanel } from './AIChatPanel';
import { useAIStore } from '../../../store/ai';

// Render only the shell concerns: stub the heavy children so this test stays
// focused on tab switching.
vi.mock('./AIChatMessageList', () => ({ AIChatMessageList: () => <div data-testid="msg-list" /> }));
vi.mock('./AIChatInput', () => ({
  AIChatInput: () => <div data-testid="chat-input" />,
}));
vi.mock('./AIChatHeader', () => ({ AIChatHeader: () => <div data-testid="chat-header" /> }));
vi.mock('./AgentPanel', () => ({ AgentPanel: () => <div data-testid="agent-panel" /> }));

describe('AIChatPanel tabs', () => {
  beforeEach(() => {
    useAIStore.setState({ panelOpen: true } as never);
  });

  it('shows Chat content by default and switches to the Agent panel', () => {
    render(<AIChatPanel onSendMessage={() => {}} />);
    expect(screen.getByRole('tab', { name: /chat/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /agent/i })).toBeInTheDocument();
    expect(screen.getByTestId('msg-list')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /agent/i }));
    expect(screen.queryByTestId('msg-list')).not.toBeInTheDocument();
    expect(screen.getByTestId('agent-panel')).toBeInTheDocument();
  });
});
