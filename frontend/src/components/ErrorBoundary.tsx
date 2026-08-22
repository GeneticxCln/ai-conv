import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught React error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '2rem',
          textAlign: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#f9fafb',
          color: '#1f2937',
        }}>
          <h1 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>
            Something went wrong
          </h1>
          <p style={{ marginBottom: '1.5rem', color: '#6b7280', maxWidth: '400px' }}>
            The application encountered an unexpected error. Please refresh the page.
          </p>
          <details style={{ textAlign: 'left', maxWidth: '600px', margin: '0 auto' }}>
            <summary style={{ cursor: 'pointer', color: '#374151', marginBottom: '0.5rem' }}>
              Error details
            </summary>
            <pre style={{
              background: '#1f2937',
              color: '#e5e7eb',
              padding: '1rem',
              borderRadius: '0.5rem',
              overflow: 'auto',
              fontSize: '0.875rem',
            }}>
              {this.state.error?.message}
              <br />
              {this.state.error?.stack}
            </pre>
          </details>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '1.5rem',
              padding: '0.75rem 1.5rem',
              background: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '0.375rem',
              fontSize: '1rem',
              cursor: 'pointer',
            }}
          >
            Refresh Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}