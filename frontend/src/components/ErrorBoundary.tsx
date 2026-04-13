/**
 * components/ErrorBoundary.tsx
 * ─────────────────────────────
 * Class-based error boundary — the only place class components are warranted
 * in React 19 (no hook equivalent yet for componentDidCatch).
 *
 * Used to wrap the Suspense-driven TechGrid so that API errors show a
 * graceful fallback instead of unmounting the entire page.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Optional: category label shown in the error message */
  context?: string;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // In production, pipe to your error reporting service here
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.error) {
      const msg = this.state.error.message;
      return (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <span className="material-symbols-outlined text-5xl text-tertiary mb-4">
            cloud_off
          </span>
          <p className="font-headline text-xl font-bold text-on-surface mb-2">
            Failed to load{this.props.context ? ` ${this.props.context}` : " data"}
          </p>
          <p className="text-on-surface-variant text-sm max-w-sm mb-6 leading-relaxed">
            {msg.includes("API error")
              ? "The API returned an error. Check that the backend is running and reachable."
              : "A network error occurred. Verify your connection and that the backend is running."}
          </p>
          <details className="text-xs text-outline max-w-md text-left mb-6">
            <summary className="cursor-pointer font-bold">Error details</summary>
            <pre className="mt-2 bg-surface-container-low p-3 rounded overflow-auto">
              {msg}
            </pre>
          </details>
          <button
            onClick={() => this.setState({ error: null })}
            className="technical-gradient text-on-primary px-6 py-2.5 text-sm font-bold rounded
                       shadow-lg shadow-primary/20 hover:opacity-90 transition-opacity"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
