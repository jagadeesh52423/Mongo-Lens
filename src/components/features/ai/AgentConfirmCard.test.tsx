import { it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentConfirmCard } from './AgentConfirmCard';
import { useAgentStore } from '../../../store/agent';

beforeEach(() => useAgentStore.setState({ byTab: {} }));

it('approve resolves the confirm', () => {
  const spy = vi.spyOn(useAgentStore.getState(), 'resolveConfirm');
  render(<AgentConfirmCard tabId="t1" id="x" statement="db.u.drop()" category="maintenance" collection="u" />);
  fireEvent.click(screen.getByRole('button', { name: /approve/i }));
  expect(spy).toHaveBeenCalledWith('t1', 'x', 'approved');
});

it('shows resolved state instead of buttons', () => {
  render(<AgentConfirmCard tabId="t1" id="x" statement="db.u.drop()" category="maintenance" collection="u" resolved="denied" />);
  expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
  expect(screen.getByText('denied')).toBeInTheDocument();
});
