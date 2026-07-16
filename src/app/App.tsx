import { useEffect, useState } from 'react';
import type { AdventureModule } from '../engine/schema';
import { loadAdventure } from '../loader';
import { fetchReader } from './fetchReader';
import { ErrorBoundary } from './ErrorBoundary';
import { useGame } from './useGame';
import { ScenePanel } from './ScenePanel';
import { TranscriptPanel } from './TranscriptPanel';
import { CommandInput } from './CommandInput';
import { ActionBar } from './ActionBar';
import { InventoryPanel } from './InventoryPanel';
import { StatusBar } from './StatusBar';
import './app.css';

// The app shell (design plan §6, T24/T25): load an adventure behind an error
// boundary, then hand it to `useGame` and the game panels. Deliberately
// plain — Phase 3 replaces this layout wholesale; what has to survive is the
// wiring pattern this file demonstrates: ONE `submit(input)` call is the
// entire write path, whether the input came from typing (CommandInput) or
// clicking (ActionBar/InventoryPanel) — FR-2.7's "clicking IS typing".

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
  const { state, scene, actions, transcript, submit } = useGame(module);

  return (
    <main className="game">
      <header className="game__header">
        <h1>{module.manifest.title}</h1>
        <StatusBar module={module} state={state} scene={scene} />
      </header>

      <div className="game__body">
        <div className="game__main">
          <ScenePanel module={module} scene={scene} />
          <TranscriptPanel entries={transcript} />
          <CommandInput onSubmit={submit} />
        </div>

        <aside className="game__sidebar">
          <ActionBar actions={actions} onAction={submit} />
          <InventoryPanel actions={actions} onAction={submit} />
        </aside>
      </div>

      {state.ended && (
        <p className="game__ended">
          {state.ended.victory ? 'Victory!' : 'Game over.'} Final rank: {state.ended.rank}
        </p>
      )}
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
