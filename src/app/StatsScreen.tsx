import { useEffect, useRef, useState } from 'react';
import type { AdventureModule } from '../engine/schema';
import type { GameState } from '../engine/types';

// The post-game stats screen (T10, ui-plan §6 "Post-game stats (FR-7.3)"):
// shown on `game-over`, after the epilogue clears. Its own native `<dialog>`,
// NOT an `Overlays.tsx`-managed overlay — same reasoning as `DeathModal.tsx`
// (T6): this is not something any shortcut (`m`, `j`, `?`) should be able to
// replace or that replaces IT, and it must appear on its own the instant the
// game ends rather than waiting for a manager `open()` call that nothing in
// this task's file list is allowed to make (App.tsx wires the mount; this
// file decides its OWN visibility from `state.ended`, exactly like
// `DeathModal` decides its own visibility from `death`).
//
// Always mounted (App.tsx renders it unconditionally, alongside
// DeathModal/MapOverlay/JournalPanel/HintsPanel); `open` is derived from
// `state.ended !== undefined`, so there is nothing for the parent to gate.

/**
 * Hollowdeep's ending-A tag (ui-plan §12.4, decision 4: "the ending tease
 * stays... one hidden-achievement-shaped line"). This is UI COPY ABOUT
 * CONTENT — exactly the same category as `AdventureSelect.tsx`'s blurbs — a
 * hollowdeep-specific tease naming a hollowdeep-specific achievement id,
 * kept here rather than as an engine/schema field because "there is another
 * ending" is presentation commentary, not a game rule the engine needs to
 * know. Hollowdeep's two endings each award their own achievement —
 * `the-full-ledger` for ending A, `kept-the-seal` for ending B (both
 * victories; see `adventures/hollowdeep/events.json`) — so earning THIS one
 * specifically is what "finished via the ending the tease is FOR" means.
 * `test-cave` (and any future adventure) simply never defines this id, so
 * `showEndingATease` below is unconditionally `false` for them — no special
 * casing required, the module lookup alone is the guard.
 */
export const ENDING_A_ACHIEVEMENT_ID = 'the-full-ledger';

/**
 * Whether to print the tease line. All three conditions matter:
 *   1. The game actually ended in victory — a loss or an unfinished run
 *      shows no tease.
 *   2. The MODULE defines the achievement at all — guards every non-
 *      hollowdeep adventure with no special-casing by id.
 *   3. The achievement is in `state.achievements` — the player earned
 *      ending A specifically, not ending B's `kept-the-seal`.
 */
export function showEndingATease(module: AdventureModule, state: GameState): boolean {
  if (state.ended === undefined || !state.ended.victory) return false;
  if (!module.achievements.some((achievement) => achievement.id === ENDING_A_ACHIEVEMENT_ID)) return false;
  return state.achievements.includes(ENDING_A_ACHIEVEMENT_ID);
}

/** Everything the screen shows, derived from `module`+`state` alone — pure and total, like `journal.ts`'s `deriveJournal`. */
export interface GameStats {
  turns: number;
  score: number;
  /** `null` while unfinished — `StatsScreen` never renders in that state, but the type stays honest either way. */
  rank: string | null;
  victory: boolean;
  deaths: number;
  hintsUsed: number;
  treasuresBanked: number;
  treasuresTotal: number;
  mapVisited: number;
  mapTotal: number;
  achievementsEarned: number;
  achievementsTotal: number;
  showEndingATease: boolean;
}

/**
 * Map coverage is computed directly from `state.visited.length` /
 * `module.locations.length` rather than by calling `mapLayout.ts`'s
 * `computeMapLayout` — that function ALSO exposes exactly these two counts
 * (`visitedCount`/`totalCount`) as fields on its `MapLayout`, by the same
 * definition, so the numbers are guaranteed identical; running the full BFS
 * layout here just to read two integers off the result would be pure waste.
 */
export function deriveStats(module: AdventureModule, state: GameState): GameStats {
  const treasuresTotal = module.items.filter((item) => item.treasure !== undefined).length;

  return {
    turns: state.turn,
    score: state.score,
    rank: state.ended?.rank ?? null,
    victory: state.ended?.victory ?? false,
    deaths: state.deaths,
    hintsUsed: state.hintsUsed,
    treasuresBanked: state.scoredDeposit.length,
    treasuresTotal,
    mapVisited: state.visited.length,
    mapTotal: module.locations.length,
    achievementsEarned: state.achievements.length,
    achievementsTotal: module.achievements.length,
    showEndingATease: showEndingATease(module, state),
  };
}

/**
 * How long the epilogue's final transcript line gets to sit on screen,
 * uncovered, before this dialog takes over — "after the epilogue clears"
 * (ui-plan §6), given as a fixed beat rather than a real "typewriter
 * finished revealing" signal: `TranscriptPanel.tsx` exposes no such
 * callback today, and wiring one through would touch `App.tsx`/`useGame.ts`,
 * both outside this task's file list. With the default `typewriterSpeed`
 * ('instant'), the epilogue is already fully visible the instant `state`
 * updates, so this delay is purely a courtesy pause, not a race against an
 * animation — a future task that threads a real reveal-complete signal
 * through `App.tsx` can replace this constant outright.
 */
const REVEAL_DELAY_MS = 900;

export interface StatsScreenProps {
  module: AdventureModule;
  state: GameState;
  /** Start a fresh run of the SAME adventure. */
  onReplay: () => void;
  /** Return to the adventure-select screen. */
  onSelect: () => void;
}

export function StatsScreen({ module, state, onReplay, onSelect }: StatsScreenProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const ended = state.ended !== undefined;

  // The courtesy delay (see REVEAL_DELAY_MS above): `shouldShow` flips true
  // `REVEAL_DELAY_MS` after `ended` first becomes true — via `setTimeout`,
  // never a synchronous `setState` inside the effect body itself (the
  // react-hooks `set-state-in-effect` rule flags exactly that as a
  // cascading-render hazard). `prefers-reduced-motion` collapses the delay
  // to 0ms rather than skipping the timeout altogether — still async, so the
  // same rule stays satisfied, and 0ms is imperceptible without being a
  // literal synchronous update. `shouldShow` never needs to reset to
  // `false`: `state.ended` is set once, terminally, for a given playthrough,
  // and `Game`'s `key={id}` (App.tsx) remounts this component fresh — with a
  // fresh `false` — on every new adventure/replay, which is the only way
  // `ended` could otherwise go back to being unset.
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    if (!ended) return undefined;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const id = window.setTimeout(
      () => {
        setShouldShow(true);
      },
      reducedMotion ? 0 : REVEAL_DELAY_MS,
    );
    return () => window.clearTimeout(id);
  }, [ended]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (shouldShow && !dialog.open) dialog.showModal();
    else if (!shouldShow && dialog.open) dialog.close();
  }, [shouldShow]);

  // Esc (or any native close) has no "resume play" to fall back to — the
  // game already ended — so it lands on the same place the "Select" button
  // does: the adventure-select screen. That is the least surprising choice
  // of the two callbacks (it never silently starts a new run).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return undefined;
    const handleClose = () => {
      if (state.ended !== undefined) onSelect();
    };
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [state.ended, onSelect]);

  const stats = deriveStats(module, state);

  return (
    <dialog ref={dialogRef} className="stats-screen" aria-labelledby="stats-screen-title">
      {state.ended !== undefined && (
        <>
          <h2 id="stats-screen-title" className="stats-screen__title">
            {stats.victory ? 'Victory' : 'Game over'} — rank: {stats.rank}
          </h2>

          <dl className="stats-screen__grid">
            <div className="stats-screen__stat">
              <dt>Turns</dt>
              <dd>{stats.turns}</dd>
            </div>
            <div className="stats-screen__stat">
              <dt>Score</dt>
              <dd>{stats.score}</dd>
            </div>
            <div className="stats-screen__stat">
              <dt>Deaths</dt>
              <dd>{stats.deaths}</dd>
            </div>
            <div className="stats-screen__stat">
              <dt>Hints used</dt>
              <dd>{stats.hintsUsed}</dd>
            </div>
            <div className="stats-screen__stat">
              <dt>Treasures banked</dt>
              <dd>
                {stats.treasuresBanked} / {stats.treasuresTotal}
              </dd>
            </div>
            <div className="stats-screen__stat">
              <dt>Map coverage</dt>
              <dd>
                {stats.mapVisited} / {stats.mapTotal}
              </dd>
            </div>
            <div className="stats-screen__stat">
              <dt>Achievements</dt>
              <dd>
                {stats.achievementsEarned} / {stats.achievementsTotal}
              </dd>
            </div>
          </dl>

          {stats.showEndingATease && (
            <p className="stats-screen__tease">There is another way out.</p>
          )}

          <div className="stats-screen__actions">
            <button type="button" onClick={onReplay}>
              Replay
            </button>
            <button type="button" onClick={onSelect}>
              Select an adventure
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
