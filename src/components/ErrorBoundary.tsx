import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null }

/**
 * Catches render-time errors (a throw from Stage/SceneView/three.js, say) so one bad
 * frame shows a recoverable message instead of a blank page. React only supports error
 * boundaries as classes - there is no hook equivalent - so this is deliberately the one
 * class-based component in src/components.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled error in the app:', error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h2>Something went wrong</h2>
        <p>The simulator hit an unexpected error and stopped. Your sketch and settings are saved, so reloading should get you back to where you were.</p>
        <p className="muted small">{error.message}</p>
        <button className="btn primary" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
