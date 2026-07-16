import { z } from 'zod';
import { zId } from './common';
import { zCondition } from './conditions';

/**
 * What makes a creature dangerous stop being dangerous (design plan §8).
 * Either carrying/holding one of `itemIds` (a lit lamp) or having used one of
 * `verbIds` against it (throwing a pebble) wards it off.
 */
export const zWardOff = z.strictObject({
  itemIds: z.array(zId).optional(),
  verbIds: z.array(zId).optional(),
});
export type WardOff = z.infer<typeof zWardOff>;

/** When a creature enters play. */
export const zSpawn = z.strictObject({
  /** Candidate locations. A stalker moves among these; a static creature sits at the first. */
  locations: z.array(zId).min(1),
  /** Not before this turn. */
  afterTurn: z.number().int().nonnegative().optional(),
  /** Guard; a list ORs together. The thief uses this ("player carries a treasure"). */
  if: z.array(zCondition).optional(),
});
export type Spawn = z.infer<typeof zSpawn>;

/**
 * A creature (FR-1.7). Behavior is **parameterized, never scripted** — the
 * engine implements three behaviors and content tunes them with the fields
 * below. There is no place to hang a script, deliberately: an adventure that
 * could script creature AI would be engine code wearing a JSON hat, and
 * "no engine changes to add an adventure" (FR-6.1) would quietly become false.
 *
 * The three behaviors:
 *   - `stalker` — wanders `spawn.locations` every `moveEvery` turns, attacks
 *     with probability `aggression` per encounter turn, defused by `wardOff`.
 *     **This is the only creature that consumes RNG.**
 *   - `thief` — activates via `spawn.if`/`afterTurn`, then steals ALL carried
 *     treasure exactly `stealAfterTurns` later and stashes it at
 *     `stashLocation`. Once per game.
 *   - `static` — stays put; exists to be examined or to gate an exit.
 *
 * THE THIEF IS DETERMINISTIC AND CONSUMES NO RNG (decided 2026-07-15, design
 * plan §8). Timing comes from `stealAfterTurns`, the target is all carried
 * treasure, the destination is `stashLocation` — no roll anywhere. This is not
 * a simplification of Woods' pirate but a faithful reading of it: in the 1977
 * game the theft was *guaranteed* (the pirate's chest only exists once he robs
 * you, and it is itself a treasure), and only the timing was random. Random
 * timing buys tension; it must never gate completability.
 *
 * The property this protects is T23's: the walkthrough must reach 100/100 at
 * every seed. Give the thief a chance roll and that test fails at a distance,
 * as a flaky seed, long after the change that caused it. Hence the schema
 * refuses `aggression` on a thief below rather than trusting a comment.
 */
export const zCreature = z
  .strictObject({
    id: zId,
    names: z.array(z.string().min(1)).min(1),
    description: z.string().min(1),
    artId: zId,
    behavior: z.enum(['stalker', 'thief', 'static']),
    spawn: zSpawn,
    /** Stalker: move every N turns. */
    moveEvery: z.number().int().positive().optional(),
    /** Stalker: attack probability 0..1 per encounter turn. The only creature RNG draw. */
    aggression: z.number().min(0).max(1).optional(),
    wardOff: zWardOff.optional(),
    /** Thief: whether it takes treasure. */
    stealsTreasure: z.boolean().optional(),
    /** Thief: where stolen goods end up, recoverable by the player. */
    stashLocation: zId.optional(),
    /** Thief: turns between activation and the theft. Deterministic — no roll. */
    stealAfterTurns: z.number().int().nonnegative().optional(),
    deathMessageId: zId.optional(),
  })
  .superRefine((c, ctx) => {
    if (c.behavior === 'stalker') {
      if (c.aggression === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['aggression'],
          message: 'a stalker needs an aggression chance, or it can never attack',
        });
      }
      if (c.moveEvery === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['moveEvery'],
          message: 'a stalker needs moveEvery, or it will never move',
        });
      }
    }

    if (c.behavior === 'thief') {
      if (c.stashLocation === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['stashLocation'],
          message: 'a thief needs a stashLocation, or stolen treasure is unrecoverable',
        });
      }
      if (c.stealAfterTurns === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['stealAfterTurns'],
          message: 'a thief needs stealAfterTurns — its timing is deterministic, not a roll',
        });
      }
      // The guard that keeps T23 honest. `aggression` is the RNG-consuming
      // field; a thief that rolls would break seed-independent completability
      // (design plan §8/§9) in a way that only shows up as a flaky seed.
      if (c.aggression !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['aggression'],
          message:
            'a thief must not have aggression: the thief is deterministic and consumes no RNG (design plan §8). Use a stalker for a creature that rolls.',
        });
      }
    }
  });
export type Creature = z.infer<typeof zCreature>;

export const zCreatures = z.array(zCreature);
