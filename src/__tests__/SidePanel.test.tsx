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

  it('preserves the prior render (does not dispose) when switching items', () => {
    const dispose = vi.fn();
    const renderFn = vi.fn((c: HTMLElement) => { c.textContent = 'first'; return { dispose }; });
    const itemA: ActivityItem = { id: 'a', title: 'A', icon: 'A', render: renderFn };
    const { rerender } = render(<SidePanel item={itemA} />);
    expect(renderFn).toHaveBeenCalledTimes(1);

    rerender(<SidePanel item={makeItem('b', 'second')} />);
    expect(dispose).not.toHaveBeenCalled();
    expect(screen.getByText('second')).toBeInTheDocument();

    rerender(<SidePanel item={itemA} />);
    expect(renderFn).toHaveBeenCalledTimes(1);
    expect(screen.getByText('first')).toBeInTheDocument();
  });

  it('disposes all cached renders when SidePanel unmounts', () => {
    const disposeA = vi.fn();
    const disposeB = vi.fn();
    const a: ActivityItem = { id: 'a', title: 'A', icon: 'A', render: (c) => { c.textContent = 'a'; return { dispose: disposeA }; } };
    const b: ActivityItem = { id: 'b', title: 'B', icon: 'B', render: (c) => { c.textContent = 'b'; return { dispose: disposeB }; } };
    const { rerender, unmount } = render(<SidePanel item={a} />);
    rerender(<SidePanel item={b} />);
    unmount();
    expect(disposeA).toHaveBeenCalledTimes(1);
    expect(disposeB).toHaveBeenCalledTimes(1);
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
