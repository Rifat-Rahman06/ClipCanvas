import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last-resort guard so a rendering failure shows a recoverable message instead
 * of leaving the side panel blank. Notes are already persisted locally, so a
 * reload never loses work that reached IndexedDB.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ClipCanvas failed to render.', error, info);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        style={{
          display: 'flex',
          height: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: 'var(--bg-app, #f6f4ef)',
          color: 'var(--ink-900, #1f251f)',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: 320 }}>
          <h1
            style={{
              margin: '0 0 8px',
              fontFamily: 'var(--font-serif, Georgia, serif)',
              fontSize: 20,
            }}
          >
            ClipCanvas hit an unexpected error
          </h1>
          <p
            style={{
              margin: '0 0 16px',
              color: 'var(--ink-400, #667066)',
              fontSize: 12.5,
              lineHeight: 1.5,
            }}
          >
            Your notes are saved on this device. Reload to keep working.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              padding: '8px 14px',
              border: '1px solid var(--line, #ddd8cc)',
              borderRadius: 8,
              background: 'var(--accent, #256d5b)',
              color: '#fff',
              fontSize: 12.5,
              cursor: 'pointer',
            }}
          >
            Reload ClipCanvas
          </button>
        </div>
      </div>
    );
  }
}
