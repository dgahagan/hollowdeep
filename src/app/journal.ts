import type { AdventureModule } from '../engine/schema';
import type { GameState } from '../engine/types';

// The Journal's Log tab (T7, ui-plan §6 "Journal (FR-3.6)") — pure
// derivation, no React import (standing rule #2: logic that can be headless,
// is).
//
// GameState carries no per-event turn stamps (design plan §5.2's sketch never
// needed one — see `engine/types.ts`'s own header), so there is no "when did
// this happen" to reconstruct. What the engine DOES keep is a set of ledgers
// that only ever grow: `awardedMilestones`, `scoredCarry`/`scoredDeposit`,
// `achievements`, `hintsRevealed`, `deaths`. Reading those against the module
// is a CURRENT-STATE SUMMARY — "what is true of this save" rather than "what
// happened and when" — and that is deliberate: it is honestly rebuildable
// from ANY loaded save (a five-minute-old autosave or a two-week-old export),
// because it never depends on anything but the state in front of it. Faking
// timestamps from turn numbers or array order would look like history and
// would not be; this file refuses to pretend.
//
// Every section below reads its own module document in DOCUMENT ORDER, not
// in the order the ledger array happened to record awards — two players (or
// two replays of the same save) who reached the identical GameState by
// different routes must see an identical Log. Document order is also already
// the convention `systems/scoring.ts` and `hint`'s selection use for exactly
// this "same turn, same order, every time" property; this file just applies
// it to a summary instead of a turn.

/** `office-lock` -> "Office Lock" (ui-plan §6: "ids were named for this"). */
export function prettifyId(id: string): string {
  return id
    .split('-')
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** One milestone the player has reached. `label` is the milestone's own author-facing `description` (the only prose it carries) — prettified id if a milestone is ever authored without one. */
export interface JournalMilestoneEntry {
  id: string;
  label: string;
  points: number;
}

/** One treasure the player has scored, either leg or both. */
export interface JournalTreasureEntry {
  id: string;
  /** The item's canonical name — `names[0]` (schema/item.ts: "the first is the canonical name"). */
  label: string;
  carried: boolean;
  deposited: boolean;
  carryPoints: number;
  depositPoints: number;
}

/** One achievement the player has earned. Always safe to show in full: `state.achievements` only ever contains EARNED ids, so a `hidden` achievement's description is no longer a spoiler here — it already happened. */
export interface JournalAchievementEntry {
  id: string;
  name: string;
  description: string;
}

/**
 * One hint ladder with at least one revealed rung, in reveal order.
 *
 * Shared with `HintsPanel.tsx` via `revealedHintLadders` below — the Log's
 * "hints taken" section and the Hints panel's "what you already know" view
 * are the SAME derivation rendered two ways, not two implementations that
 * could drift. Nothing unrevealed is ever in this list; availability
 * (whether a NEXT rung exists) lives entirely engine-side in `hintHandler`
 * (`engine/actions/meta.ts`) and is deliberately not reimplemented here.
 */
export interface JournalHintLadder {
  id: string;
  /** Prettified from the hint id, e.g. `office-lock` -> "Office Lock". */
  title: string;
  /** Revealed rungs, mildest first, exactly as authored in `hints.json`. */
  rungs: string[];
  revealed: number;
  /** The ladder's full length — informational (rung 2 of 3), not a spoiler: it says nothing about what a later rung will say. */
  total: number;
}

/** The deaths summary: a count and the points it has cost, never a per-death list (GameState keeps no per-death detail — see file header). */
export interface JournalDeaths {
  count: number;
  penaltyTotal: number;
}

export interface JournalLog {
  milestones: JournalMilestoneEntry[];
  treasures: JournalTreasureEntry[];
  achievements: JournalAchievementEntry[];
  hints: JournalHintLadder[];
  deaths: JournalDeaths;
}

/**
 * Hint ladders with at least one revealed rung, grouped and titled — the
 * piece `HintsPanel.tsx` also needs, hence its own export rather than being
 * folded silently into `deriveJournal`.
 */
export function revealedHintLadders(module: AdventureModule, state: GameState): JournalHintLadder[] {
  const ladders: JournalHintLadder[] = [];
  for (const entry of module.hints.hints) {
    const revealed = state.hintsRevealed[entry.id] ?? 0;
    if (revealed <= 0) continue;
    ladders.push({
      id: entry.id,
      title: prettifyId(entry.id),
      rungs: entry.ladder.slice(0, revealed),
      revealed,
      total: entry.ladder.length,
    });
  }
  return ladders;
}

/**
 * Build the Log from `state` alone. Pure and total: every array can be
 * empty (a fresh game derives an almost-empty Log), and calling this twice
 * against the identical `state` object must produce deep-equal output
 * (`tests/app/journal.test.ts` pins exactly that — the whole point of a
 * rebuildable Log is that rebuilding it twice never drifts).
 */
export function deriveJournal(module: AdventureModule, state: GameState): JournalLog {
  const milestones: JournalMilestoneEntry[] = module.scoring.milestones
    .filter((milestone) => state.awardedMilestones.includes(milestone.id))
    .map((milestone) => ({
      id: milestone.id,
      label: milestone.description ?? prettifyId(milestone.id),
      points: milestone.points,
    }));

  const treasures: JournalTreasureEntry[] = module.items
    .filter((item) => item.treasure !== undefined)
    .filter((item) => state.scoredCarry.includes(item.id) || state.scoredDeposit.includes(item.id))
    .map((item) => ({
      id: item.id,
      label: item.names[0] ?? item.id,
      carried: state.scoredCarry.includes(item.id),
      deposited: state.scoredDeposit.includes(item.id),
      // Non-null: filtered to `item.treasure !== undefined` above.
      carryPoints: item.treasure?.carryPoints ?? 0,
      depositPoints: item.treasure?.depositPoints ?? 0,
    }));

  const achievements: JournalAchievementEntry[] = module.achievements
    .filter((achievement) => state.achievements.includes(achievement.id))
    .map((achievement) => ({
      id: achievement.id,
      name: achievement.name,
      description: achievement.description,
    }));

  const deaths: JournalDeaths = {
    count: state.deaths,
    penaltyTotal: state.deaths * module.scoring.deathPenalty,
  };

  return {
    milestones,
    treasures,
    achievements,
    hints: revealedHintLadders(module, state),
    deaths,
  };
}
