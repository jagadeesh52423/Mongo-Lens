import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ErrorBoundary } from '../ErrorBoundary';

function Boom({ message = 'boom' }: { message?: string }): JSX.Element {
  throw new Error(message);
}

/** Reads a mutable external flag so retry (which remounts) can recover. */
function Flaky({ shouldThrow }: { shouldThrow: { current: boolean } }): JSX.Element {
  if (shouldThrow.current) throw new Error('flaky');
  return <div>recovered</div>;
}

describe('ErrorBoundary', () => {
  // React logs caught render errors to console.error; silence to keep test output clean.
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>healthy</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('healthy')).toBeInTheDocument();
  });

  it('renders the default fallback with label and message on error', () => {
    render(
      <ErrorBoundary fallbackLabel="Editor failed">
        <Boom message="monaco exploded" />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Editor failed')).toBeInTheDocument();
    expect(screen.getByText('monaco exploded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('invokes onError with the error and component stack', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <Boom message="logged" />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    const [error, info] = onError.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('logged');
    expect(info).toHaveProperty('componentStack');
  });

  it('remounts children and calls onRetry when Retry is clicked', () => {
    const onRetry = vi.fn();
    const shouldThrow = { current: true };
    render(
      <ErrorBoundary onRetry={onRetry}>
        <Flaky shouldThrow={shouldThrow} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Underlying condition clears, then the user retries.
    shouldThrow.current = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText('recovered')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders a custom fallback when provided', () => {
    render(
      <ErrorBoundary
        fallback={(error, reset) => (
          <button onClick={reset}>custom: {error.message}</button>
        )}
      >
        <Boom message="x" />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: 'custom: x' })).toBeInTheDocument();
  });
});
