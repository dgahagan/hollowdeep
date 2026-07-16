import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdventureModule } from '../engine/schema';
import type { GameState, OutputEvent, SceneView, UIAction } from '../engine/types';
import { createGame, step } from '../engine/engine';
import { describeScene, availableActions } from '../engine/view';
import { saveGame, serializeSave } from '../engine/save';
import { writeAutosave } from './storage';

// The engine wiring pattern (design plan §6, T24/T25). This is the one piece
// of this task meant to survive Phase 3's UI rewrite wholesale — everything
// else here is throwaway markup.
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
  /** Every `OutputEvent` from every CONSUMED turn, oldest first (T25). */
  transcript: OutputEvent[];
  submit: (input: string) => void;
  /** Adopt a `GameState` loaded from a save (T26). See `load`'s own comment. */
  load: (state: GameState) => void;
}

/**
 * `step` returns `{state, events}`, and T24's hook discarded `events` — there
 * was no transcript to put them in yet. T25 adds one, and the interesting
 * part is where it lives.
 *
 * `state` and `transcript` are ONE React state value, not two `useState`
 * calls, and that is load-bearing, not a style choice. T24's comment above
 * `submit` already establishes the rule this has to keep: the `setState`
 * updater must be PURE — React may invoke it more than once (StrictMode does
 * this on every mount on purpose) or invoke it and then discard the result
 * entirely, so nothing inside the updater may have a side effect, and the
 * updater must be a deterministic function of its previous value and the
 * input. Bundling `transcript` into the same object the updater returns
 * keeps both properties: appending `result.events` to `previous.transcript`
 * is exactly as pure as computing `result.state` was, because it depends on
 * nothing but the two arguments already in scope. A second, independent
 * `useState` for the transcript would break this the moment its setter was
 * called from inside `submit` alongside the state setter — two updates that
 * must commit together would be two updates that COULD be observed apart
 * (an interrupted render sees new state with a stale or missing transcript
 * entry), and "committed but only partially" is precisely the bug T24's
 * autosave discipline exists to rule out. One object, one updater, one
 * commit.
 */
interface Session {
  state: GameState;
  transcript: OutputEvent[];
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
  const [session, setSession] = useState<Session>(() => ({
    state: createGame(module, seed ?? Date.now()),
    transcript: [],
  }));

  // The `setState` updater is PURE — `step` plus a pure array append, and
  // nothing else. See the `Session` comment above for why the transcript
  // rides along in the same object rather than a sibling `useState`.
  const submit = useCallback(
    (input: string) => {
      setSession((previous) => {
        const result = step(module, previous.state, input);
        return { state: result.state, transcript: [...previous.transcript, ...result.events] };
      });
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
    if (savedTurn.current === session.state.turn) return;
    savedTurn.current = session.state.turn;
    if (session.state.turn === 0) return;

    const blob = saveGame(module, session.state, Date.now());
    // A write failure (quota exceeded, private browsing) must not take the
    // game down with it — storage.ts swallows the error and reports
    // success/failure. A dropped autosave costs recoverability for this one
    // turn, not the turn itself.
    writeAutosave(module.manifest.id, session.state.turn, serializeSave(blob));
  }, [module, session.state]);

  // Adopt a `GameState` loaded from a save slot (T26 — SaveDialog's "Load").
  //
  // This does NOT go through `step` — loading isn't a turn, it's a swap of
  // the whole session. Called from a click handler (not from inside the
  // `setSession` updater), so it is free to have the side effect `submit`'s
  // updater is forbidden from having: it stamps `savedTurn` BEFORE handing
  // React the new state, so the autosave effect above sees its guard already
  // satisfied on the next render and does not immediately re-write the ring
  // with the state it was just read from (turn N loaded → turn N re-saved →
  // no new information, just a chance to clobber a different turn that
  // happens to share `N % AUTOSAVE_SLOTS`).
  //
  // `state` and `transcript` still commit together (Session's own comment
  // above explains why that has to hold) — this just supplies both fields of
  // a fresh `Session` directly instead of deriving them from the previous
  // one.
  //
  // What goes in `transcript`: `GameState` carries no transcript field and
  // must not gain one — the save shape is versioned and migrated forever
  // (save.ts), and the transcript is disposable UI history, not game state.
  // So a load cannot "restore" the prior session's scrollback; there isn't
  // one to restore from a save blob that never held it. The alternative to
  // starting empty — silently reusing whatever happened to be on screen
  // before the click — would glue two different sessions' output together
  // with nothing marking the seam, which reads as a bug the moment the
  // player scrolls up. A single acknowledgement line marks the seam honestly
  // instead: the player did something (loaded a save), and the transcript
  // says so, the same way a command-echo says a command happened.
  const load = useCallback((state: GameState) => {
    savedTurn.current = state.turn;
    setSession({ state, transcript: [{ kind: 'text', text: 'Game loaded.' }] });
  }, []);

  return {
    state: session.state,
    scene: describeScene(module, session.state),
    actions: availableActions(module, session.state),
    transcript: session.transcript,
    submit,
    load,
  };
}
