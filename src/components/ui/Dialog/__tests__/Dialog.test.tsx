import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Dialog } from '../Dialog';

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    render(
      <Dialog open={false} onClose={() => {}} ariaLabel="My dialog">
        <Dialog.Body>hidden</Dialog.Body>
      </Dialog>
    );
    expect(screen.queryByText('hidden')).not.toBeInTheDocument();
  });

  it('renders body/footer when open', () => {
    render(
      <Dialog open onClose={() => {}} ariaLabel="My dialog">
        <Dialog.Header title="Title" />
        <Dialog.Body>body</Dialog.Body>
        <Dialog.Footer>footer</Dialog.Footer>
      </Dialog>
    );
    expect(screen.getByRole('dialog', { name: 'My dialog' })).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
    expect(screen.getByText('footer')).toBeInTheDocument();
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} ariaLabel="d">
        <Dialog.Body>x</Dialog.Body>
      </Dialog>
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose on backdrop click', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} ariaLabel="d">
        <Dialog.Body>x</Dialog.Body>
      </Dialog>
    );
    const dlg = screen.getByRole('dialog', { name: 'd' });
    const backdrop = dlg.parentElement!;
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('header close button triggers onClose', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} ariaLabel="d">
        <Dialog.Header title="t" onClose={onClose} />
      </Dialog>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onClose).toHaveBeenCalled();
  });
});
