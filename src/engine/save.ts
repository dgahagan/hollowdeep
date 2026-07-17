import { z } from 'zod';
import type { AdventureModule } from './schema';
import type { GameState, ItemState } from './types';
import { ENGINE_VERSION } from './engine';

// ─────────────────────────────────────────────────────────────────────────────
// Versioned save/load with migrations (design plan §5.5, FR-5.3).
//
// The promise this file exists to keep (project brief §8): **a save made in an
// early build loads in the release build.** Everything here follows from that.
//
// A save is untrusted input. It comes from `localStorage`, which the player can
// edit, or from an imported file, which could be anything at all. So `loadGame`
// parses rather than casts, and every rejection is a typed error the UI can
// present — never a silent repair, and never a half-loaded game. FR-5.3's
// "never silent corruption" means a save that cannot be loaded correctly must
// FAIL, loudly, with a reason a person can act on.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The save FORMAT version — bumped whenever `GameState`'s shape changes, with
 * a matching entry in `MIGRATIONS`.
 *
 * Distinct from `engineVersion` (does the code know these rules?) and
 * `adventureVersion` (is this the same cave?). Those three answer different
 * questions and are stored separately for that reason.
 */
export const SAVE_VERSION = 2;

/**
 * A save file. Plain JSON, top to bottom — `GameState` is already constrained
 * to plain JSON (see types.ts) precisely so this is `JSON.stringify` and
 * nothing more.
 */
export interface SaveBlob {
  saveVersion: number;
  /** The engine that wrote it. Diagnostic only — see `loadGame`. */
  engineVersion: string;
  adventureId: string;
  /** The adventure version that wrote it. Diagnostic only — see `loadGame`. */
  adventureVersion: string;
  /** Unix ms. Supplied by the caller — engine code may not call `Date.now()`. */
  createdAt: number;
  state: GameState;
}

// ── typed errors ────────────────────────────────────────────────────────────

/**
 * Why a save could not be loaded. The UI switches on `code` to decide what to
 * say; it must never have to parse `message` to find out what happened.
 */
export type SaveErrorCode =
  /** Not a save blob at all, or a state that fails its schema. */
  | 'malformed'
  /** A save for a different adventure. */
  | 'adventure-mismatch'
  /** Written by a NEWER build than this one. */
  | 'future-version'
  /** Old enough that the chain of migrations to here is broken. */
  | 'no-migration-path';

export class SaveError extends Error {
  readonly code: SaveErrorCode;
  /** Machine-readable specifics, for a UI that wants to name names. */
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: SaveErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'SaveError';
    this.code = code;
    this.details = details;
  }
}

// ── the state schema ────────────────────────────────────────────────────────
//
// A runtime mirror of `GameState` (types.ts). It is worth the duplication:
// without it, a corrupted or hand-edited save is `JSON.parse`d straight into a
// `GameState`-shaped lie, and the game breaks several turns later somewhere
// that looks unrelated.
//
// The two shapes cannot silently drift apart — `toGameState` below rebuilds a
// `GameState` field by field from this schema's output, so a field added to
// `GameState` and not to this schema is a COMPILE error.

const zItemState = z.strictObject({
  open: z.boolean().optional(),
  locked: z.boolean().optional(),
  lit: z.boolean().optional(),
});

const zCreatureState = z.strictObject({
  locationId: z.string(),
  active: z.boolean(),
  encounterTurns: z.number().int(),
  activatedTurn: z.number().int().nullable(),
  hasStolen: z.boolean(),
});

const zPendingQuestion = z.strictObject({
  kind: z.enum(['disambiguation', 'confirm']),
  question: z.string(),
  options: z.array(z.string()),
  originalCommand: z.string(),
  phrase: z.string(),
});

const zEndState = z.strictObject({
  victory: z.boolean(),
  rank: z.string(),
});

const zGameState = z.strictObject({
  rng: z.number(),
  turn: z.number().int(),
  locationId: z.string(),
  previousLocationId: z.string(),

  itemLocations: z.record(z.string(), z.string()),
  itemState: z.record(z.string(), zItemState),
  lampFuel: z.number().int(),

  flags: z.record(z.string(), z.union([z.boolean(), z.number()])),
  visited: z.array(z.string()),
  firedEvents: z.array(z.string()),
  creatures: z.record(z.string(), zCreatureState),
  timers: z.record(z.string(), z.number().int()),

  score: z.number().int(),
  deaths: z.number().int(),
  hintsUsed: z.number().int().nonnegative(),
  hintsRevealed: z.record(z.string(), z.number().int().nonnegative()),
  achievements: z.array(z.string()),
  scoredCarry: z.array(z.string()),
  scoredDeposit: z.array(z.string()),
  awardedMilestones: z.array(z.string()),
  lampWarned: z.array(z.number().int()),

  verbose: z.boolean(),

  itRefers: z.string().optional(),
  lastCommand: z.string().optional(),
  pending: zPendingQuestion.optional(),
  ended: zEndState.optional(),
});

// ── canonicalizing the parsed state ─────────────────────────────────────────
//
// Zod's `.optional()` accepts a key that is PRESENT and `undefined`, and hands
// it back that way (verified, not assumed: `z.strictObject({x:
// z.boolean().optional()}).parse({x: undefined})` returns an object where
// `'x' in result` is true). `GameState` says something stricter under
// `exactOptionalPropertyTypes`: an optional key is absent, or it holds a real
// value. There is no third state.
//
// Rebuilding rather than casting is not ceremony to satisfy the compiler —
// `{itRefers: undefined}` and `{}` are different objects to `toEqual` and to
// `JSON.stringify`, so a state carrying explicit undefineds would fail the
// round-trip property and produce saves that differ byte-wise from an
// identical game. Making the value true is the fix; asserting it were true
// would just move the lie.
//
// (JSON itself cannot encode `undefined`, so `deserializeSave` could never
// produce one. `loadGame` is also called with in-memory blobs — by the round
// trip in the tests, and by any caller that skips the string — and those can.)

function toItemState(raw: z.infer<typeof zItemState>): ItemState {
  return {
    ...(raw.open !== undefined ? { open: raw.open } : {}),
    ...(raw.locked !== undefined ? { locked: raw.locked } : {}),
    ...(raw.lit !== undefined ? { lit: raw.lit } : {}),
  };
}

/**
 * Parsed state → canonical `GameState`.
 *
 * Every required field is listed explicitly. That is the point: adding a field
 * to `GameState` breaks this function, at compile time, in the one file that
 * owes the new field a `SAVE_VERSION` bump and a migration. The type checker
 * asks the question at the only moment anyone can answer it — which a `as
 * GameState` would have silently skipped.
 */
function toGameState(raw: z.infer<typeof zGameState>): GameState {
  const itemState: Record<string, ItemState> = {};
  for (const [id, value] of Object.entries(raw.itemState)) itemState[id] = toItemState(value);

  return {
    rng: raw.rng,
    turn: raw.turn,
    locationId: raw.locationId,
    previousLocationId: raw.previousLocationId,

    itemLocations: raw.itemLocations,
    itemState,
    lampFuel: raw.lampFuel,

    flags: raw.flags,
    visited: raw.visited,
    firedEvents: raw.firedEvents,
    creatures: raw.creatures,
    timers: raw.timers,

    score: raw.score,
    deaths: raw.deaths,
    hintsUsed: raw.hintsUsed,
    hintsRevealed: raw.hintsRevealed,
    achievements: raw.achievements,
    scoredCarry: raw.scoredCarry,
    scoredDeposit: raw.scoredDeposit,
    awardedMilestones: raw.awardedMilestones,
    lampWarned: raw.lampWarned,

    verbose: raw.verbose,

    ...(raw.itRefers !== undefined ? { itRefers: raw.itRefers } : {}),
    ...(raw.lastCommand !== undefined ? { lastCommand: raw.lastCommand } : {}),
    ...(raw.pending !== undefined ? { pending: raw.pending } : {}),
    ...(raw.ended !== undefined ? { ended: raw.ended } : {}),
  };
}

/** The envelope. `state` stays `unknown` here — migrations run before it is parsed. */
const zEnvelope = z.strictObject({
  saveVersion: z.number().int().nonnegative(),
  engineVersion: z.string(),
  adventureId: z.string(),
  adventureVersion: z.string(),
  createdAt: z.number(),
  state: z.unknown(),
});

// ── migrations ──────────────────────────────────────────────────────────────

/**
 * `MIGRATIONS[n]` upgrades a **version-n** save's `state` to version `n+1`.
 * `loadGame` applies them in sequence, so a v0 save reaching a v3 engine runs
 * 0→1, 1→2, 2→3. Each step only has to know about its own neighbours, which is
 * the only reason this stays tractable as versions accumulate.
 *
 * Input is `unknown` on purpose: a v0 state is NOT a `GameState`, and typing it
 * as one would be the lie the whole file exists to prevent. Migrations do their
 * own narrowing. Output is `unknown` too — only the final `zGameState.parse` in
 * `loadGame` decides whether the chain produced something real, so a migration
 * with a bug is caught by the schema rather than trusted.
 */
export const MIGRATIONS: Record<number, (state: unknown) => unknown> = {
  /**
   * 0 → 1: add `lampWarned`.
   *
   * **v0 was never released.** This project shipped at SAVE_VERSION 1, so no
   * v0 save exists in the wild and this migration will never run for a real
   * player. It is here because a migration registry that has never once been
   * exercised end-to-end is a registry that does not work, and the first real
   * migration is the worst possible time to discover that — it would be found
   * by players, on saves that cannot be re-made. The plan asks for exactly this
   * (T21: "a fabricated v0 blob exercises one real migration"): fabricated
   * blob, real migration, real code path.
   *
   * The shape it models is a true one: `lampWarned` was added with the fuel
   * warnings in T18, and a state predating it is a state with the key missing.
   * Defaulting to `[]` means an ancient save re-warns at thresholds it already
   * passed — the honest choice, since nothing in a v0 save records which had
   * fired. A cosmetic repeat beats inventing history.
   */
  0: (state) => {
    if (typeof state !== 'object' || state === null) return state;
    return { lampWarned: [], ...(state as Record<string, unknown>) };
  },

  /**
   * 1 → 2: add `timers`, `hintsUsed`, `hintsRevealed` (hints-timers plan §6).
   *
   * The first migration written for saves that could genuinely exist — v1 is
   * what the foundation build shipped. The defaults are honest, not guesses:
   * a v1 save predates relative timers and the hint system entirely, so "no
   * timers running, no hints ever taken" is the truth of that game, and a
   * migrated save keeps its shot at the no-hints achievement.
   */
  1: (state) => {
    if (typeof state !== 'object' || state === null) return state;
    return { timers: {}, hintsUsed: 0, hintsRevealed: {}, ...(state as Record<string, unknown>) };
  },
};

// ── save ────────────────────────────────────────────────────────────────────

/**
 * Wrap a state as a save blob.
 *
 * `createdAt` is a parameter rather than a `Date.now()` call because engine
 * code may not read the clock — lint blocks it (design plan §5.3, and the
 * determinism rule the whole seeded test suite rests on). The caller owns the
 * clock; the engine owns the rules.
 */
export function saveGame(module: AdventureModule, state: GameState, createdAt: number): SaveBlob {
  return {
    saveVersion: SAVE_VERSION,
    engineVersion: ENGINE_VERSION,
    adventureId: module.manifest.id,
    adventureVersion: module.manifest.version,
    createdAt,
    state,
  };
}

/** Serialize a save for `localStorage` or a file (FR-5.4). */
export function serializeSave(blob: SaveBlob): string {
  return JSON.stringify(blob);
}

// ── load ────────────────────────────────────────────────────────────────────

/**
 * Load a save against a module, or throw a typed `SaveError`.
 *
 * Rejection order is deliberate — each check assumes the ones above it passed,
 * and each reports the most useful thing it can:
 *
 *   1. **malformed envelope** — not a save at all. Nothing else is knowable.
 *   2. **adventure mismatch** — a save for a different cave. Checked before
 *      version, because "that's a Hollowdeep save" is a better thing to tell
 *      someone than "that save is too old", and both can be true at once.
 *   3. **future version** — written by a newer build. We refuse rather than
 *      guess: a forward migration cannot be written by code that predates the
 *      change it would migrate. Guessing here is how a save gets silently
 *      truncated by an old build the player then keeps playing on.
 *   4. **migration chain** — a gap means we cannot honestly get from there to
 *      here.
 *   5. **state schema** — the last word, and it runs AFTER migrations, so a
 *      buggy migration is caught rather than trusted.
 *
 * `engineVersion` and `adventureVersion` are recorded but deliberately NOT
 * enforced. `engineVersion` is the loader's business — `loadAdventure` already
 * checks `manifest.engineVersion` against the engine before a module exists to
 * load a save into, and re-litigating it here would refuse saves the format
 * says are fine. `adventureVersion` is a genuine judgement call and it is
 * documented in the execution notes: content can change under a save in ways
 * no version number can adjudicate, so an equality check would refuse working
 * saves after a typo fix, while a permissive read allows a save that references
 * a location a later version deleted. We take the permissive side because
 * `saveVersion` guards the shape, which is what corrupts silently; missing
 * content fails loudly on its own.
 */
export function loadGame(module: AdventureModule, blob: unknown): GameState {
  const envelope = zEnvelope.safeParse(blob);
  if (!envelope.success) {
    throw new SaveError('malformed', 'This does not look like a save file.', {
      issues: envelope.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    });
  }

  const { saveVersion, adventureId } = envelope.data;

  if (adventureId !== module.manifest.id) {
    throw new SaveError(
      'adventure-mismatch',
      `This save is for "${adventureId}", but "${module.manifest.id}" is loaded.`,
      { saveAdventureId: adventureId, loadedAdventureId: module.manifest.id },
    );
  }

  if (saveVersion > SAVE_VERSION) {
    throw new SaveError(
      'future-version',
      `This save was made by a newer version of the game (save format ${saveVersion}; this build reads ${SAVE_VERSION}).`,
      { saveVersion, supportedVersion: SAVE_VERSION },
    );
  }

  let migrated: unknown = envelope.data.state;
  for (let version = saveVersion; version < SAVE_VERSION; version++) {
    const migrate = MIGRATIONS[version];
    if (migrate === undefined) {
      throw new SaveError(
        'no-migration-path',
        `This save is too old to load (save format ${saveVersion}; no migration from ${version}).`,
        { saveVersion, missingMigrationFrom: version, supportedVersion: SAVE_VERSION },
      );
    }
    migrated = migrate(migrated);
  }

  const state = zGameState.safeParse(migrated);
  if (!state.success) {
    throw new SaveError('malformed', 'This save is damaged and cannot be loaded.', {
      issues: state.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    });
  }

  return toGameState(state.data);
}

/** Parse a serialized save (`localStorage`, an imported file) and load it. */
export function deserializeSave(module: AdventureModule, text: string): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SaveError('malformed', 'This file is not readable as a save.');
  }
  return loadGame(module, parsed);
}
