// Top-level error boundary so a single route crash does not white-screen
// the launcher. React 18 still requires a class component for this; keep
// the surface tiny and consistent with the design tokens.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import styles from './ErrorBoundary.module.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

const formatError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return 'Unexpected error';
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(formatError(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to dev console; production logger arrives with ctrl-cloud.
    // eslint-disable-next-line no-console
    console.error('[ctrl/web] route crash', error, info.componentStack);
  }

  handleReset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className={styles.shell} role="alert">
        <div className={styles.card}>
          <p className={styles.label}>CTRL · runtime error</p>
          <p className={styles.message}>{this.state.error.message}</p>
          <button type="button" onClick={this.handleReset} className={styles.button}>
            Reload route
          </button>
        </div>
      </div>
    );
  }
}
