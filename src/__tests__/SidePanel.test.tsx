import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SidePanel } from '../components/layout/SidePanel';
import type { ActivityItem } from '../layout/activityBar';

function makeItem(id: string, body: string): ActivityItem {
  return {
    id, title: id.toUpperCase(), icon: id[0]!.toUpperCase(),
    render: (container) => {
      container.textContent = body;
      return { dispose() { container.textContent = ''; } };
    },
  };
}

describe('SidePanel', () => {
  it('renders the item title', () => {
    render(<SidePanel item={makeItem('a', 'body-a')} />);
    expect(screen.getByTestId('side-panel-title')).toHaveTextContent('A');
  });

  it('calls item.render into the body container', () => {
    render(<SidePanel item={makeItem('a', 'body-a')} />);
    expect(screen.getByText('body-a')).toBeInTheDocument();
  });

  it('disposes the prior render when item changes', () => {
    const dispose = vi.fn();
    const item: ActivityItem = {
      id: 'a', title: 'A', icon: 'A',
      render: (c) => { c.textContent = 'first'; return { dispose }; },
    };
    const { rerender } = render(<SidePanel item={item} />);
    expect(dispose).not.toHaveBeenCalled();
    rerender(<SidePanel item={makeItem('b', 'second')} />);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(screen.getByText('second')).toBeInTheDocument();
  });

  it('renders a placeholder when item is null', () => {
    render(<SidePanel item={null} />);
    expect(screen.getByTestId('side-panel-empty')).toBeInTheDocument();
  });

  it('shows an error fallback when render throws', () => {
    const throwing: ActivityItem = {
      id: 'x', title: 'X', icon: 'X',
      render: () => { throw new Error('boom'); },
    };
    render(<SidePanel item={throwing} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/boom/);
  });
});
