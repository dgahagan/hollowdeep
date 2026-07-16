import type { AdventureModule } from '../schema';
import type { GameState, OutputEvent } from '../types';
import { isCarrying, itemLocation } from '../state';
import { evalConditions } from './events';

// Treasure carry/deposit points, milestones, and rank lookup (design plan
// §4.1's `Treasure`/`Milestone`/`Rank` schemas, FR-1.5;
// foundation-implementation-plan.md T20).
//
// This is the `scoring` stage of `worldTick`'s FIXED order (engine.ts):
// **events → creatures → light → scoring**. It runs LAST deliberately: every
// earlier stage can move an item (a stolen treasure, a corpse's scattered
// possessions) or set a flag (opening the grate), and scoring needs the
// turn's FINAL state, not a snapshot from partway through the tick.
//
// DEATH PENALTY IS DELIBERATELY NOT HERE. `engine.ts`'s `handleDeath` already
// applies `module.scoring.deathPenalty`, and it has to live there: it runs
// once per death regardless of cause, and darkness (light.ts) and creature
// kills (creatures.ts) both cause death WITHOUT ever going through an Effect,
// so there is no single event this file could hook to apply it exactly once.
// Duplicating it here would dock a player twice for one fall. This file only
// ever ADDS points.
//
// TWO THINGS HAPPEN HERE, IN THIS ORDER — milestones are the only one that
// CAN draw RNG, and only if content ever guards a `when` with `chance` (no
// milestone in test-cave does, so this stage draws nothing today):
//
//   1. **Treasure carry + deposit points** — no RNG. Every item with a
//      `treasure` field (schema/item.ts), checked in `module.items` array
//      order: carry points the first turn it is CARRIED, deposit points the
//      first turn it is AT `manifest.repositoryLocation`. Each is its own
//      once-only ledger (`scoredCarry`/`scoredDeposit`, state.ts/T11) — two
//      separate lists rather than one, because a thief can move a deposited
//      or carried treasure without either ledger being about to be re-checked
//      against a re-take: re-taking a treasure the player already scored the
//      carry points for (test-cave's walkthrough does exactly this, recovering
//      the shadow-packrat's haul) must not re-award, and depositing it a
//      second time after the thief moves it back out must not either.
//
//   2. **Milestones** — declarative `when: Condition[]` (schema/scoring.ts),
//      evaluated with `evalConditions` (systems/events.ts) so the exact same
//      AND/OR/`chance` composition rule content authors already learned from
//      events applies here too, rather than a second dialect. This
//      declarative shape is not a style choice: `effects.ts`'s own banner
//      warns that treasure/milestone points must never ALSO flow through an
//      `addScore` effect, because `checkConsistency` (T5) reconciles
//      `manifest.maxScore` against the sum of `treasure` points and
//      `milestone.points` read directly out of the content files — that sum
//      has to be derivable from data, and an event awarding milestone points
//      imperatively would make it un-auditable. Awarded once each, tracked in
//      `awardedMilestones`.
//
// Both stages read `module.items`/`module.scoring.milestones` in array order,
// so two milestones (or two treasures) satisfied on the same turn always
// report in the same order across runs — the RNG-order discipline this
// codebase applies everywhere something is "the same turn" is not just about
// dice.

/** The `score` OutputEvent for one award, in the same voice `addScore`
 * (systems/events.ts) already uses for its own score line — this is the
 * sanctioned mechanical exception (engine bookkeeping, not narrative prose),
 * not a hardcoded narrative string. */
function scoreEvent(points: number, total: number): OutputEvent {
  return {
    kind: 'score',
    text: `You score ${points}.`,
    points,
    total,
  };
}

/** Step 1: treasure carry + deposit points. No RNG. */
function scoreTreasures(module: AdventureModule, state: GameState): [GameState, OutputEvent[]] {
  let current = state;
  const output: OutputEvent[] = [];

  for (const item of module.items) {
    if (item.treasure === undefined) continue;

    if (isCarrying(current, item.id) && !current.scoredCarry.includes(item.id)) {
      const total = current.score + item.treasure.carryPoints;
      current = { ...current, score: total, scoredCarry: [...current.scoredCarry, item.id] };
      output.push(scoreEvent(item.treasure.carryPoints, total));
    }

    if (
      itemLocation(current, item.id) === module.manifest.repositoryLocation &&
      !current.scoredDeposit.includes(item.id)
    ) {
      const total = current.score + item.treasure.depositPoints;
      current = { ...current, score: total, scoredDeposit: [...current.scoredDeposit, item.id] };
      output.push(scoreEvent(item.treasure.depositPoints, total));
    }
  }

  return [current, output];
}

/** Step 2: milestones. The only place in this file that can draw RNG (see header). */
function scoreMilestones(module: AdventureModule, state: GameState): [GameState, OutputEvent[]] {
  let current = state;
  const output: OutputEvent[] = [];

  for (const milestone of module.scoring.milestones) {
    if (current.awardedMilestones.includes(milestone.id)) continue;

    const [passed, afterCond] = evalConditions(module, current, milestone.when);
    current = afterCond; // carries RNG advance only, per evalConditions' own contract
    if (!passed) continue;

    const total = current.score + milestone.points;
    current = {
      ...current,
      score: total,
      awardedMilestones: [...current.awardedMilestones, milestone.id],
    };
    output.push(scoreEvent(milestone.points, total));
  }

  return [current, output];
}

/**
 * The `scoring` stage of `worldTick` (engine.ts). Runs on every consumed
 * turn — `worldTick` itself is only ever called when one was.
 */
export function scoringTick(module: AdventureModule, state: GameState): [GameState, OutputEvent[]] {
  let current = state;
  const output: OutputEvent[] = [];

  const [afterTreasures, treasureEvents] = scoreTreasures(module, current);
  current = afterTreasures;
  output.push(...treasureEvents);

  const [afterMilestones, milestoneEvents] = scoreMilestones(module, current);
  current = afterMilestones;
  output.push(...milestoneEvents);

  return [current, output];
}

/**
 * The player's rank at game end (FR-1.5): the highest `minScore` reached or
 * exceeded, classic-adventure style.
 *
 * `zScoring`'s own `.refine` (schema/scoring.ts) forbids duplicate
 * `minScore`s and guarantees a `minScore <= 0` entry exists, but it does NOT
 * require the table be sorted — `ranks` is authored order, not rank order.
 * `best` therefore starts at `undefined`, not `ranks[0]`: seeding it with the
 * first entry regardless of whether that entry actually qualifies is exactly
 * the bug a best-first table (100, then 45, then 0) would expose — `ranks[0]`
 * would win outright for every score, including zero. Only a rank whose
 * `minScore <= score` is ever allowed to become `best`, and among those the
 * one with the highest `minScore` wins, so the result is the same regardless
 * of the table's array order.
 *
 * The `?? ''` fallback is only reachable from a hand-built test module with
 * an empty rank array — `noUncheckedIndexedAccess` sees `ranks[0]` as
 * possibly undefined even though the schema's `.min(1)` rules it out in
 * practice, and the `.refine` for a `minScore <= 0` floor rules out a real
 * score ever leaving `best` unset.
 */
export function rankFor(module: AdventureModule, score: number): string {
  let best: (typeof module.scoring.ranks)[number] | undefined;
  for (const rank of module.scoring.ranks) {
    if (rank.minScore <= score && (best === undefined || rank.minScore > best.minScore)) {
      best = rank;
    }
  }
  return best?.title ?? '';
}
