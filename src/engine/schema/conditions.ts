import { z } from 'zod';
import { zId } from './common';

/**
 * A guard evaluated against game state (design plan §4.1).
 *
 * Composition rule, and it is the whole grammar:
 *   - **fields within one Condition AND together** — `{flag: 'x', hasItem: 'y'}`
 *     means "flag x is set AND the player carries y";
 *   - **a `Condition[]` ORs together** — `[{flag:'a'}, {flag:'b'}]` means
 *     "a or b".
 *
 * So AND-of-ORs is expressible and OR-of-ANDs is expressible, which covers
 * every guard test-cave and Hollowdeep need. There is deliberately no `not`
 * combinator or nesting: `notFlag` covers the one negation that came up in
 * practice, and a general boolean tree in JSON is a language, not a schema —
 * it would need its own evaluator, its own tests, and its own error messages.
 *
 * `chance` is the only field that consumes RNG, which is why evaluation
 * returns new state (see `evalCondition`, T12).
 */
export const zCondition = z
  .strictObject({
    /** Flag id that must be truthy. */
    flag: zId.optional(),
    /** Flag id that must be falsy/unset. */
    notFlag: zId.optional(),
    /** Item id the player must be carrying. */
    hasItem: zId.optional(),
    /**
     * Location the player must currently be in.
     *
     * Added during T9 (2026-07-16): §4.1's sketch has `itemAt` and
     * `creatureAt` but no way to ask where the *player* is, and §8's own
     * content cannot be expressed without it — `zeeble` teleports
     * road↔entry-hall, which is one word whose effect depends entirely on
     * which end you say it from. `visited` is not a substitute (it stays true
     * forever once true).
     */
    atLocation: zId.optional(),
    /** Item must be at this location (or `inventory`/`nowhere`/a container id). */
    itemAt: z.strictObject({ item: zId, location: zId }).optional(),
    /** Creature must be at this location. */
    creatureAt: z.strictObject({ creature: zId, location: zId }).optional(),
    /** Location the player must have visited. */
    visited: zId.optional(),
    /**
     * Player must have died no more than this many times.
     *
     * Added during T9 (2026-07-16). §8 requires a `no-deaths` achievement
     * awarded at victory, and nothing else could express it: `deaths` lives in
     * GameState where content cannot see it, and the alternative — having the
     * engine hardcode "award the achievement called `no-deaths`" — would make
     * engine code reference one specific adventure's content, which the
     * playbook forbids outright. Setting a flag from the `die` effect does not
     * work either: darkness and creature kills are engine-driven and never
     * touch content effects, so a player eaten by the rat would still collect
     * the achievement.
     *
     * `0` means "never died". Generalized to a count so an adventure can offer
     * "finish with at most two deaths" without another schema change.
     */
    deathsAtMost: z.number().int().nonnegative().optional(),
    /** Probability 0..1, drawn from the seeded RNG in GameState. */
    chance: z.number().min(0).max(1).optional(),
  })
  // An empty condition would be vacuously true and is always a typo — most
  // likely a misspelled field name that `.strict()` would have caught had it
  // not been the only key. Reject it here so `if: [{}]` never silently means
  // "always".
  .refine((c) => Object.values(c).some((v) => v !== undefined), {
    message: 'condition must test at least one thing (an empty condition is always true)',
  });

export type Condition = z.infer<typeof zCondition>;

/** A list of conditions ORs together; see `zCondition` for the full rule. */
export const zConditions = z.array(zCondition);
