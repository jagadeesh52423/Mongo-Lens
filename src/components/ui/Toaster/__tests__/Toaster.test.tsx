import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Toaster } from '../Toaster';
import { useNotificationsStore } from '../../../../store/notifications';

beforeEach(() => {
  useNotificationsStore.setState({ notifications: [] });
});

describe('Toaster', () => {
  it('renders nothing when the queue is empty', () => {
    const { container } = render(<Toaster />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a notification message and detail', () => {
    useNotificationsStore.getState().notify({
      level: 'error',
      message: 'Settings could not be saved',
      detail: 'disk full',
    });
    render(<Toaster />);
    expect(screen.getByText('Settings could not be saved')).toBeInTheDocument();
    expect(screen.getByText('disk full')).toBeInTheDocument();
  });

  it('dismisses a notification when the close button is clicked', () => {
    useNotificationsStore.getState().notify({ level: 'error', message: 'sticky error' });
    render(<Toaster />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText('sticky error')).toBeNull();
    expect(useNotificationsStore.getState().notifications).toHaveLength(0);
  });

  it('auto-dismisses a notification after its duration elapses', () => {
    vi.useFakeTimers();
    try {
      useNotificationsStore.getState().notify({
        level: 'success',
        message: 'saved',
        durationMs: 4000,
      });
      render(<Toaster />);
      expect(screen.getByText('saved')).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(useNotificationsStore.getState().notifications).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not auto-dismiss a sticky (durationMs 0) notification', () => {
    vi.useFakeTimers();
    try {
      useNotificationsStore.getState().notify({ level: 'error', message: 'persist failed' });
      render(<Toaster />);
      act(() => {
        vi.advanceTimersByTime(60000);
      });
      expect(useNotificationsStore.getState().notifications).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
