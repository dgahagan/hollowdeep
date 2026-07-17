import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdventureModule } from '../engine/schema';
import type { GameState, OutputEvent, SceneView, UIAction } from '../engine/types';
import { createGame, step } from '../engine/engine';
import { describeScene, availableActions } from '../engine/view';
import { saveGame, serializeSave } from '../engine/save';
import { writeAutosave } from './storage';

// The engine wiring pattern (design plan §6, T24/T25; T6 adds undo, death
// interception, and hardcore gating). This is the one piece of the Phase 1
// UI meant to survive Phase 3 wholesale — the rule it demonstrates still
// holds: ONE `submit(input)` call is the entire write path.
//
// T6's additions follow the standing rule that logic which can be headless,
// is: the undo/death decisions live in the exported pure functions below
// (`isUndoInput`, `undoRefusal`, `retainedUndo`, `detectDeathText`), covered
// by tests/app/undo.test.ts, and the hook merely calls them.

// ─────────────────────────────────────────────────────────────────────────────
// Pure undo/death logic (T6, ui-plan §5 + §12.3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Is this input the `undo` keyword? Intercepted ABOVE `step()` — undo is a
 * UI affordance, never a parser verb (ui-plan §12.3): it does not reach the
 * engine, is not echoed as a command, and can never appear in a walkthrough.
 */
export function isUndoInput(input: string): boolean {
  return input.trim().toLowerCase() === 'undo';
}

export type UndoRefusalReason = 'hardcore' | 'game-over' | 'nothing';

/**
 * The wry UI-side refusal lines (they are the UI's voice, not the
 * adventure's — undo never reaches the engine, so no module string exists
 * for it and none should).
 */
export const UNDO_REFUSAL_LINES: Record<UndoRefusalReason, string> = {
  hardcore: 'Hardcore means what it says. The cave does not repeat itself for you.',
  'game-over': 'It is finished. Whatever you would take back, the cave has already kept.',
  nothing: 'There is nothing to take back yet, which is either reassuring or ominous.',
};

/**
 * The gating matrix (ui-plan §5): hardcore always refuses; a finished game
 * refuses; no retained state (turn 0, a fresh load, or an undo already
 * spent) refuses. Order matters only for which excuse the player reads —
 * hardcore's identity outranks circumstance.
 */
export function undoRefusal(args: {
  hardcore: boolean;
  ended: boolean;
  hasUndo: boolean;
}): UndoRefusalReason | null {
  if (args.hardcore) return 'hardcore';
  if (args.ended) return 'game-over';
  if (!args.hasUndo) return 'nothing';
  return null;
}

/**
 * What the retained undo state becomes after a `step`: a CONSUMED turn
 * (turn advanced) retains the state it left behind; a refused command or
 * disambiguation exchange (turn unchanged) keeps whatever was already
 * retained — a parse error must not eat the player's one step back.
 * Exactly one prior state is ever held (FR-1.11: single-step).
 */
export function retainedUndo(
  previousState: GameState,
  previousUndo: GameState | null,
  nextState: GameState,
): GameState | null {
  return nextState.turn > previousState.turn ? previousState : previousUndo;
}

/** The death event's text from a turn's output, or null if nobody died. */
export function detectDeathText(events: OutputEvent[]): string | null {
  const death = events.find((event) => event.kind === 'death');
  return death?.text ?? null;
}

/** What the death modal needs to know about the death that just happened. */
export interface PendingDeath {
  /** The death event's prose — DeathModal reverse-maps it to a messageId for the vignette. */
  text: string;
  /** The turn the death was consumed on; "before the fall" means an autosave with turn < this. */
  deathTurn: number;
}

export interface UseGameOptions {
  seed?: number;
  /**
   * Hardcore (ui-plan §5): set at new-game and locked (T9 owns the setting;
   * this hook only obeys it). No death modal, no undo; autosaves still
   * written — resume-after-tab-close is not a rescue — but the load UI
   * hides them mid-run (SaveDialog's concern, not this hook's).
   */
  hardcore?: boolean;
}

export interface UseGameResult {
  state: GameState;
  scene: SceneView;
  actions: UIAction[];
  /** Every `OutputEvent` from every CONSUMED turn, oldest first (T25). */
  transcript: OutputEvent[];
  submit: (input: string) => void;
  /** Adopt a `GameState` loaded from a save (T26). See `load`'s own comment. */
  load: (state: GameState) => void;
  /** Non-null while the death modal should be up (never in hardcore). */
  pendingDeath: PendingDeath | null;
  /** "Accept reincarnation": the engine already did it — just drop the modal. */
  dismissDeath: () => void;
}

/**
 * `state` and `transcript` are ONE React state value, not two `useState`
 * calls, and that is load-bearing, not a style choice: the `setState`
 * updater must be PURE — React may invoke it more than once (StrictMode
 * does, on purpose) or discard the result — so appending events and
 * computing state happen in one deterministic updater, and the pieces can
 * never be observed committed apart. T6 widens the object with `undoState`
 * and `pendingDeath` for the same reason: the state that "one step back"
 * restores and the death the modal shows must travel in the same commit as
 * the state/transcript they belong to.
 */
interface Session {
  state: GameState;
  transcript: OutputEvent[];
  /** The single retained prior state (ui-plan §5) — null at turn 0, after a load, or once spent. */
  undoState: GameState | null;
  pendingDeath: PendingDeath | null;
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
export function useGame(module: AdventureModule, options?: UseGameOptions): UseGameResult {
  const hardcore = options?.hardcore ?? false;
  const seed = options?.seed;

  const [session, setSession] = useState<Session>(() => ({
    state: createGame(module, seed ?? Date.now()),
    transcript: [],
    undoState: null,
    pendingDeath: null,
  }));

  // A commit-synced mirror of `session`, for the imperative paths (`undo`
  // interception, below) that need to consult current state from inside an
  // event handler without making the setState updater impure. Written from
  // an effect, not during render (react-hooks v7's refs rule): effects run
  // at commit, and event handlers only ever fire after a commit, so the
  // mirror is always fresh by the time anything reads it.
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Autosave bookkeeping — declared before `submit` because undo has to
  // stamp it. See the autosave effect further down for the full discipline.
  const savedTurn = useRef<number | null>(null);

  // The `setState` updater is PURE — `step` plus pure derivations
  // (`retainedUndo`, `detectDeathText`), and nothing else.
  const submit = useCallback(
    (input: string) => {
      // ── The undo interception (T6, ui-plan §12.3) ─────────────────────────
      // Handled ABOVE `step()`, imperatively (an event handler may have side
      // effects; the updater may not). Neither branch echoes `undo` as a
      // command — it is not one.
      if (isUndoInput(input)) {
        const current = sessionRef.current;
        const refusal = undoRefusal({
          hardcore,
          ended: current.state.ended !== undefined,
          hasUndo: current.undoState !== null,
        });

        if (refusal !== null) {
          const line: OutputEvent = { kind: 'text', text: UNDO_REFUSAL_LINES[refusal] };
          setSession((previous) => ({ ...previous, transcript: [...previous.transcript, line] }));
          return;
        }

        // **Undo does not touch storage** (cross-task note 3): the autosave
        // ring keeps every turn it already wrote — history is not rewritten.
        // Stamping `savedTurn` with the restored turn stops the autosave
        // effect from firing on this commit; the NEXT consumed turn advances
        // `turn` again and autosaves as normal (over the same ring slot its
        // undone predecessor used — same `turn % AUTOSAVE_SLOTS`).
        const restored = current.undoState;
        if (restored !== null) savedTurn.current = restored.turn;
        setSession((previous) => {
          const undo = previous.undoState;
          if (undo === null) return previous; // double-invoke safety; refusal already handled above
          return {
            state: undo,
            transcript: [
              ...previous.transcript,
              { kind: 'text', text: 'One step back. The cave agrees to pretend that did not happen.' },
            ],
            undoState: null, // single-step: spent until the next consumed turn
            pendingDeath: null,
          };
        });
        return;
      }

      setSession((previous) => {
        const result = step(module, previous.state, input);
        const deathText = detectDeathText(result.events);
        return {
          state: result.state,
          transcript: [...previous.transcript, ...result.events],
          undoState: retainedUndo(previous.state, previous.undoState, result.state),
          // Hardcore shows no modal (ui-plan §5): reincarnation is what you
          // get, and the engine already handed it out.
          pendingDeath:
            !hardcore && deathText !== null
              ? { text: deathText, deathTurn: result.state.turn }
              : previous.pendingDeath,
        };
      });
    },
    [module, hardcore],
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
  // `createGame`'s initial state, before the player has done anything. Undo
  // pre-stamps this guard (see `submit`) so a restore never writes.
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

  // Adopt a `GameState` loaded from a save slot (T26 — SaveDialog's "Load",
  // and T6 — the death modal's "resume from before the fall", which IS a
  // load, not a mechanic).
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
  // `undoState` starts null: "one step back" across a load boundary would
  // step into a different session's history. `pendingDeath` clears for the
  // same reason — and because resuming-before-the-fall must drop the modal.
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
    setSession({
      state,
      transcript: [{ kind: 'text', text: 'Game loaded.' }],
      undoState: null,
      pendingDeath: null,
    });
  }, []);

  const dismissDeath = useCallback(() => {
    setSession((previous) =>
      previous.pendingDeath === null ? previous : { ...previous, pendingDeath: null },
    );
  }, []);

  return {
    state: session.state,
    scene: describeScene(module, session.state),
    actions: availableActions(module, session.state),
    transcript: session.transcript,
    submit,
    load,
    pendingDeath: session.pendingDeath,
    dismissDeath,
  };
}
