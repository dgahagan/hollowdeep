import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ModuleLoadError } from '../loader';

// Catches a failed adventure load and renders `ModuleLoadError`'s details
// legibly instead of a blank page (T24's acceptance criterion).
//
// `loadAdventure` is async, and React error boundaries only catch errors
// thrown DURING RENDER — not from a rejected promise off in a `useEffect`.
// So the loader in App.tsx stores a caught rejection in state and then
// re-throws it on the next render (`if (status === 'error') throw error`),
// which is the standard bridge from an async failure to a synchronous one an
// error boundary can see. This file is the boundary; App.tsx is the bridge.

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | undefined;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: undefined };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The one place this app logs — there is no telemetry backend
    // (static-only delivery, no backend, per CLAUDE.md).
    console.error('Adventure failed to load:', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === undefined) return this.props.children;

    if (error instanceof ModuleLoadError) {
      return (
        <main>
          <h1>The adventure could not be loaded</h1>
          <p>{error.message}</p>
          <ul>
            {error.errors.map((e) => (
              <li key={`${e.document}:${e.id}:${e.field}`}>
                <code>{e.document}</code> → <code>{e.id}</code> → <code>{e.field}</code>: {e.message}
              </li>
            ))}
          </ul>
        </main>
      );
    }

    return (
      <main>
        <h1>Something went wrong</h1>
        <p>{error.message}</p>
      </main>
    );
  }
}
