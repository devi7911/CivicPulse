import { Component, type ReactNode } from 'react';
import { reportError } from '../lib/errors';

// Shows a friendly screen instead of a blank page when something crashes.
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: unknown) { reportError(error); }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mx-auto max-w-md p-6 pt-20 text-center">
        <h1 className="text-xl font-bold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">The problem has been reported. Please reload the page. Anything you already submitted is safe.</p>
        <button type="button" className="btn btn-primary mt-4" onClick={() => window.location.assign('/')}>Reload CivicPulse</button>
        <p className="mt-6 text-xs text-muted">In an emergency, call <a href="tel:112" className="font-bold text-brick underline">112</a>.</p>
      </div>
    );
  }
}
