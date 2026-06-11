/**
 * ErrorBoundary — generic React error boundary for isolating a render subtree.
 *
 * Wrap any pane that can throw during render (e.g. Monaco/EditorArea) so a
 * failure degrades to a recoverable fallback instead of taking down the window.
 *
 * To customize: pass `fallbackLabel` for the default fallback's heading, or
 * `fallback` to fully replace the fallback UI (it receives the error + a
 * `reset` thunk). Use `onError` for logging/metrics only — never for recovery.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../Button';
import styles from './ErrorBoundary.module.css';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Heading shown in the default fallback. */
  fallbackLabel?: string;
  /** Replaces the default fallback entirely. Receives the error and a reset thunk. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Side-effect only (logging/metrics). Must not attempt recovery. */
  onError?: (error: Error, info: ErrorInfo) => void;
  /** Invoked when the user clicks Retry, before the boundary remounts children. */
  onRetry?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

const DEFAULT_FALLBACK_LABEL = 'Something went wrong';

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  private reset = (): void => {
    this.props.onRetry?.();
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className={styles.fallback} role="alert">
        <p className={styles.label}>{this.props.fallbackLabel ?? DEFAULT_FALLBACK_LABEL}</p>
        {error.message && <p className={styles.detail}>{error.message}</p>}
        <Button variant="secondary" size="sm" onClick={this.reset}>
          Retry
        </Button>
      </div>
    );
  }
}
