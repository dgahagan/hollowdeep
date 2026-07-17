import type { Direction } from './schema';

// The engine's public data shapes (design plan §5.1, §5.2).
//
// EVERYTHING IN `GameState` IS PLAIN JSON. No class instances, no `Map`, no
// `Set`, no `Date` — none of them survive `JSON.stringify`, and the whole
// save system (T21) is "serialize this object". `visited` and `firedEvents`
// are arrays rather than Sets for exactly that reason: a `Set` would round-trip
// to `{}` and lose the game silently, which is the worst way to find out.
//
// The state shape is also the thing `save.ts` versions and migrates forever.
// Adding a field later costs a migration; getting it right now costs nothing.

/** Where an item is: a location id, a container item id, or one of these. */
export const ITEM_INVENTORY = 'inventory';
export const ITEM_NOWHERE = 'nowhere';

/** Mutable per-item state. Absent keys mean "not applicable to this item". */
export interface ItemState {
  open?: boolean;
  locked?: boolean;
  lit?: boolean;
}

/**
 * Per-creature runtime state.
 *
 * `activatedTurn` and `hasStolen` are not in §5.2's sketch; the thief cannot
 * work without them. Its theft fires `stealAfterTurns` after it activates, so
 * something must remember *when* it activated, and it fires once per game, so
 * something must remember that it has. Both are plain JSON.
 *
 * `activatedTurn` also gives the stalker its movement clock —
 * `(turn - activatedTurn) % moveEvery` — so no separate lastMoved field is
 * needed.
 */
export interface CreatureState {
  locationId: string;
  active: boolean;
  /** Consecutive turns the creature has shared a location with the player. */
  encounterTurns: number;
  /** Turn it became active, or null while inactive. */
  activatedTurn: number | null;
  /** Thief only: whether its once-per-game theft has happened. */
  hasStolen: boolean;
}

/** A question the engine is waiting on (design plan §5.2, §5.3.1). */
export interface PendingQuestion {
  kind: 'disambiguation' | 'confirm';
  /** What the player is asked, e.g. "Which cup, the tin cup or the silver chalice?" */
  question: string;
  /** The choices, as command fragments the player can pick by name or number. */
  options: string[];
  /** The raw input that triggered the question, replayed once resolved. */
  originalCommand: string;
  /**
   * The ambiguous phrase within `originalCommand`, e.g. "cup".
   *
   * Needed to rewrite the command once answered ("take cup" + "tin cup" →
   * "take tin cup"); without it there is no way to know which word the answer
   * replaces.
   */
  phrase: string;
}

/** How the game ended. */
export interface EndState {
  victory: boolean;
  rank: string;
}

/**
 * The entire game. One serializable object; no hidden state anywhere else.
 *
 * Fields beyond §5.2's sketch, each because a required feature could not work
 * without it:
 *   - `scoredCarry`/`scoredDeposit`/`awardedMilestones` — points must award
 *     once, never on re-take (T20). Content flags are the adventure's
 *     namespace, so the engine keeps its own ledger.
 *   - `lampWarned` — each `warnAt` threshold fires exactly once (FR-1.4).
 *   - `lastCommand` — `again`/`g` replays the last *consumed* command (FR-2.3).
 *   - `verbose` — the verbose/brief description toggle (FR-2.3).
 *
 * Added at SAVE_VERSION 2 (hints-timers plan §4.3, §5.3):
 *   - `timers` — timer id → the turn its expiry fires. The thief's
 *     elapsed-turn arithmetic, generalized; an entry is removed when it fires.
 *   - `hintsUsed` — total hint rungs revealed, ever. Read by the penalty math
 *     and `Condition.hintsAtMost` (which exists for the same reason
 *     `deathsAtMost` does).
 *   - `hintsRevealed` — hint id → rungs revealed. What lets selection skip
 *     exhausted ladders, and what the Phase 3 hints panel will redisplay.
 */
export interface GameState {
  /** mulberry32 state. Advances on every draw; see rng.ts. */
  rng: number;
  turn: number;
  locationId: string;
  previousLocationId: string;

  /** itemId → location id | container item id | 'inventory' | 'nowhere'. */
  itemLocations: Record<string, string>;
  itemState: Record<string, ItemState>;
  lampFuel: number;

  /** Content-defined flags. `boolean | number` per §4.1's setFlag. */
  flags: Record<string, boolean | number>;
  visited: string[];
  firedEvents: string[];
  creatures: Record<string, CreatureState>;
  /** timer id → expiry turn. See the SAVE_VERSION 2 note above. */
  timers: Record<string, number>;

  score: number;
  deaths: number;
  /** Total hint rungs revealed. See the SAVE_VERSION 2 note above. */
  hintsUsed: number;
  /** hint id → rungs revealed (0..ladder.length). See the SAVE_VERSION 2 note above. */
  hintsRevealed: Record<string, number>;
  achievements: string[];
  scoredCarry: string[];
  scoredDeposit: string[];
  awardedMilestones: string[];
  lampWarned: number[];

  verbose: boolean;

  /** Pronoun target for `it` (FR-2.5). */
  itRefers?: string;
  lastCommand?: string;
  pending?: PendingQuestion;
  ended?: EndState;
}

/**
 * One line of output. A discriminated union so the UI can style a death
 * differently from a score notice without parsing prose (design plan §5.1).
 */
export type OutputEvent =
  | { kind: 'text'; text: string }
  /** The command that produced this turn — typed, or echoed from a click (FR-2.7). */
  | { kind: 'command-echo'; text: string }
  | { kind: 'death'; text: string }
  | { kind: 'score'; text: string; points: number; total: number }
  | { kind: 'achievement'; text: string; achievementId: string }
  | { kind: 'question'; text: string; options: string[] }
  | { kind: 'game-over'; text: string; victory: boolean; score: number; rank: string }
  /**
   * A hint rung revealed by the `hint` verb (hints-timers plan §5.3).
   * `rung` is 1-based — the Nth rung of `hintId`'s ladder just shown. Additive;
   * not save state, and the UI can style it distinctly once Phase 3 wants to.
   */
  | { kind: 'hint'; text: string; hintId: string; rung: number };

/** What `step` returns: a NEW state plus the turn's output. Never mutates. */
export interface StepResult {
  state: GameState;
  events: OutputEvent[];
}

/** An exit as the player may see it. Hidden/unmet exits never appear here. */
export interface SceneExit {
  dir: Direction;
  /** Present only once the player has been there — otherwise it spoils the map. */
  toName?: string;
}

export interface SceneItem {
  id: string;
  brief: string;
}

export interface SceneCreature {
  id: string;
  description: string;
}

/**
 * The current location as the UI should draw it (design plan §5.1).
 *
 * Visible-only is a spoiler boundary, not a cosmetic filter: hidden exits and
 * unmet-condition exits must not leak here (T22).
 */
export interface SceneView {
  locationId: string;
  name: string;
  /**
   * The location's illustration — **absent when `dark`**.
   *
   * A picture of the room is the one thing a player in the dark most plainly
   * cannot see, so the engine does not hand it over. It is optional rather than
   * always-present for that reason alone: a UI cannot render what it was not
   * given, which is the point (view.ts's `describeScene`).
   */
  artId?: string;
  /** Brief, or full in verbose mode. The darkness warning when `dark`. */
  description: string;
  /** Dark and unlit: the player sees nothing, and `items`/`creatures`/`exits`/`artId` are all empty. */
  dark: boolean;
  items: SceneItem[];
  creatures: SceneCreature[];
  exits: SceneExit[];
}

/**
 * A clickable action. `command` is the FR-2.7 mechanism: the UI renders these
 * as buttons, and clicking one calls `step` with this exact string — so
 * clicking and typing are one code path, and the echo teaches the parser.
 */
export interface UIAction {
  /** Button text, e.g. "Take lamp". */
  label: string;
  /** The command it performs, e.g. "take lamp". Echoed into the transcript. */
  command: string;
  group: 'exit' | 'item' | 'inventory';
  /** The entity this acts on, for grouping in the UI. */
  targetId?: string;
}
