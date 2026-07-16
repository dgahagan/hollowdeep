import { useEffect, useState, type FormEvent } from 'react';
import type { AdventureModule } from '../engine/schema';
import { loadAdventure } from '../loader';
import { fetchReader } from './fetchReader';
import { ErrorBoundary } from './ErrorBoundary';
import { useGame } from './useGame';

// The app shell (design plan §6, T24): load an adventure behind an error
// boundary, then hand it to `useGame`. Deliberately plain — Phase 3 (T25/T26)
// replaces this layout with real panels; what has to survive is the wiring
// pattern this file demonstrates: ONE `submit(input)` call is the entire
// write path, whether the input came from typing or (once T25 adds buttons)
// a click.

const ADVENTURE_BASE_DIR = 'adventures/test-cave';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; module: AdventureModule }
  | { status: 'error'; error: Error };

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Loads the adventure on mount. `loadAdventure` is async, so a failure
 * arrives via a rejected promise in `useEffect` — that alone can't reach an
 * error boundary, which only catches things thrown during render. Storing
 * the rejection in state and re-throwing it from `AdventureGate`'s render
 * body is the bridge.
 */
function useAdventure(baseDir: string): LoadState {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    loadAdventure(fetchReader, baseDir)
      .then((module) => {
        if (!cancelled) setState({ status: 'ready', module });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: 'error', error: toError(err) });
      });

    return () => {
      cancelled = true;
    };
  }, [baseDir]);

  return state;
}

function AdventureGate({ baseDir }: { baseDir: string }) {
  const adventure = useAdventure(baseDir);

  if (adventure.status === 'error') {
    // Re-thrown during render so the surrounding `ErrorBoundary` (which only
    // sees synchronous render-time throws) can catch it.
    throw adventure.error;
  }

  if (adventure.status === 'loading') {
    return (
      <main>
        <p>Loading the cave…</p>
      </main>
    );
  }

  return <Game module={adventure.module} />;
}

function Game({ module }: { module: AdventureModule }) {
  const { state, scene, submit } = useGame(module);
  const [input, setInput] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const command = input.trim();
    if (command === '') return;
    submit(command);
    setInput('');
  }

  return (
    <main>
      <h1>{module.manifest.title}</h1>
      <h2>{scene.name}</h2>
      <p>{scene.description}</p>
      <p>
        Turn {state.turn} · Score {state.score}
      </p>
      <form onSubmit={handleSubmit}>
        <label>
          Command
          <input value={input} onChange={(event) => setInput(event.target.value)} autoFocus />
        </label>
        <button type="submit">Go</button>
      </form>
    </main>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AdventureGate baseDir={ADVENTURE_BASE_DIR} />
    </ErrorBoundary>
  );
}
