import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionErrorDialog } from '../ConnectionErrorDialog';

describe('ConnectionErrorDialog', () => {
  it('renders legacy plain string message body', () => {
    render(<ConnectionErrorDialog message="boom: cannot reach host" onClose={vi.fn()} />);
    expect(screen.getByText(/boom: cannot reach host/i)).toBeInTheDocument();
    // No staged heading should appear for the legacy shape.
    expect(screen.queryByText(/SSH tunnel failed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/TLS handshake failed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Authentication failed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Server ping failed/i)).not.toBeInTheDocument();
  });

  it('renders staged "TLS handshake failed" heading + error body', () => {
    render(
      <ConnectionErrorDialog
        message={{ stage: 'tls', error: 'self-signed certificate' }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/TLS handshake failed/i)).toBeInTheDocument();
    expect(screen.getByText(/self-signed certificate/i)).toBeInTheDocument();
  });

  it('renders staged "Authentication failed" heading for stage=auth', () => {
    render(
      <ConnectionErrorDialog
        message={{ stage: 'auth', error: 'bad password' }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Authentication failed/i)).toBeInTheDocument();
    expect(screen.getByText(/bad password/i)).toBeInTheDocument();
  });
});
