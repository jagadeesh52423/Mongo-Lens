import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionErrorDialog } from '../ConnectionErrorDialog';
import { parseStagedError } from '../../../../connection/staged-error';

describe('ConnectionErrorDialog', () => {
  it('renders the connection name as a subtitle', () => {
    render(
      <ConnectionErrorDialog
        connectionName="Prod Cluster"
        message="cannot reach host"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Failed to connect to/i)).toHaveTextContent('Prod Cluster');
  });

  it('renders legacy plain string message body', () => {
    render(
      <ConnectionErrorDialog
        connectionName="Local"
        message="boom: cannot reach host"
        onClose={vi.fn()}
      />,
    );
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
        connectionName="Prod Cluster"
        message={{ stage: 'tls', error: 'self-signed certificate' }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Failed to connect to/i)).toHaveTextContent('Prod Cluster');
    expect(screen.getByText(/TLS handshake failed/i)).toBeInTheDocument();
    expect(screen.getByText(/self-signed certificate/i)).toBeInTheDocument();
  });

  it('renders staged "Authentication failed" heading for stage=auth', () => {
    render(
      <ConnectionErrorDialog
        connectionName="Staging"
        message={{ stage: 'auth', error: 'bad password' }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Authentication failed/i)).toBeInTheDocument();
    expect(screen.getByText(/bad password/i)).toBeInTheDocument();
  });
});

// End-to-end contract round-trip: the backend emits a raw `"<stage>: <detail>"`
// string; that string must flow through `parseStagedError` and render the
// correct stage heading + detail in the dialog. The other tests above feed the
// dialog an already-parsed object, so this guards the seam between the parser
// and the component that the real connect path actually relies on.
describe('ConnectionErrorDialog ← parseStagedError contract round-trip', () => {
  // Headings are anchored (^...$) so they match only the <strong> heading and
  // never a substring inside the <pre> detail (e.g. "auth" detail text can
  // itself contain the word "authentication").
  const cases: Array<{ raw: string; heading: RegExp; detail: RegExp }> = [
    { raw: 'ping: server selection timed out', heading: /^Server ping failed$/i, detail: /server selection timed out/i },
    { raw: 'auth: SCRAM authentication failed', heading: /^Authentication failed$/i, detail: /SCRAM authentication failed/i },
    { raw: 'tls: self-signed certificate', heading: /^TLS handshake failed$/i, detail: /self-signed certificate/i },
    { raw: 'ssh: tunnel refused', heading: /^SSH tunnel failed$/i, detail: /tunnel refused/i },
  ];

  it.each(cases)('"$raw" → correct heading + detail', ({ raw, heading, detail }) => {
    render(
      <ConnectionErrorDialog
        connectionName="Prod Cluster"
        message={parseStagedError(raw)}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(heading)).toBeInTheDocument();
    expect(screen.getByText(detail)).toBeInTheDocument();
  });

  it('an unrecognized prefix round-trips as a plain body with no stage heading', () => {
    render(
      <ConnectionErrorDialog
        connectionName="Local"
        message={parseStagedError('database error: connection refused')}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/database error: connection refused/i)).toBeInTheDocument();
    expect(screen.queryByText(/Server ping failed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Authentication failed/i)).not.toBeInTheDocument();
  });
});
