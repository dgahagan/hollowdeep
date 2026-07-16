import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdventureModule } from '../engine/schema';
import type { GameState, SceneView, UIAction } from '../engine/types';
import { createGame, step } from '../engine/engine';
import { describeScene, availableActions } from '../engine/view';
import { saveGame, serializeSave } from '../engine/save';
import { writeAutosave } from './storage';

// The engine wiring pattern (design plan §6, T24). This is the one piece of
// this task meant to survive Phase 3's UI rewrite wholesale — everything else
// here is throwaway markup.
//
// Deliberately thin, and deliberately left UNTESTED (design plan §9): there
// is no jsdom/@testing-library in this project, and a hook this size is not
// worth inventing one for. If it ever grows a rule worth testing, that rule
// belongs in a plain function this hook merely calls — the engine already
// has `step`/`describeScene`/`availableActions`, all covered by real tests.
// This file's only job is gluing React state to them.

export interface UseGameResult {
  state: GameState;
  scene: SceneView;
  actions: UIAction[];
  submit: (input: string) => void;
}

/**
 * Holds one game's state and exposes the engine's read side plus the single
 * write operation, `submit`. Clicking and typing both end up calling
 * `submit` with a command string (FR-2.7) — there is no second path here for
 * clicks to take.
 *
 * `seed` defaults to `Date.now()` — legitimate at this boundary (unlike in
 * `src/engine/**`, which lint blocks from reading the clock at all) because a
 * fresh playthrough's randomness has to come from somewhere, and the engine
 * takes it as a constructor argument rather than reading it itself. Read
 * inside the `useState` lazy initializer, not as a default parameter value —
 * a default parameter is evaluated on every render, which is exactly the
 * "impure call during render" the purity rule (react-hooks v7) rejects; the
 * initializer callback runs exactly once, on mount.
 */
export function useGame(module: AdventureModule, seed?: number): UseGameResult {
  const [state, setState] = useState<GameState>(() => createGame(module, seed ?? Date.now()));

  // The `setState` updater is PURE — `step` and nothing else. React may
  // invoke an updater more than once (StrictMode does this on every mount,
  // deliberately, to surface exactly this class of bug) or invoke one and
  // then discard the result entirely (an interrupted or replayed render).
  // Autosaving from inside the updater would write for renders that never
  // actually happen — and a save is the one thing here that outlives the
  // session, so that is the wrong direction to be wrong in. The write moved
  // to the effect below, which only runs for state that ACTUALLY COMMITTED.
  const submit = useCallback(
    (input: string) => {
      setState((previous) => step(module, previous, input).state);
    },
    [module],
  );

  // Autosave every CONSUMED turn (FR-5.2), as a side effect of committed
  // state rather than a side effect of computing it.
  //
  // `savedTurn` guards against re-firing for a re-render that changed
  // `state`'s object identity without consuming a turn — e.g. a fresh (but
  // still refused) command clears a pending disambiguation, which produces a
  // new `GameState` object with the same `turn`. Comparing turn numbers is
  // the same rule `step` itself uses to decide "did anything happen?"
  // (design plan §5.3), not a second guess at it. `turn === 0` is
  // `createGame`'s initial state, before the player has done anything.
  const savedTurn = useRef<number | null>(null);
  useEffect(() => {
    if (savedTurn.current === state.turn) return;
    savedTurn.current = state.turn;
    if (state.turn === 0) return;

    const blob = saveGame(module, state, Date.now());
    // A write failure (quota exceeded, private browsing) must not take the
    // game down with it — storage.ts swallows the error and reports
    // success/failure. A dropped autosave costs recoverability for this one
    // turn, not the turn itself.
    writeAutosave(module.manifest.id, state.turn, serializeSave(blob));
  }, [module, state]);

  return {
    state,
    scene: describeScene(module, state),
    actions: availableActions(module, state),
    submit,
  };
}
