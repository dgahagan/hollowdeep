import { z } from 'zod';
import { zId } from './common';

/**
 * A guard evaluated against game state (design plan §4.1).
 *
 * Composition rule, and it is the whole grammar:
 *   - **fields within one Condition AND together** — `{flag: 'x', hasItem: 'y'}`
 *     means "flag x is set AND the player carries y";
 *   - **a `Condition[]` ORs together** — `[{flag:'a'}, {flag:'b'}]` means
 *     "a or b";
 *   - **`all` ANDs together** — `{all: [{flag:'a'}, {flag:'b'}]}` means
 *     "a and b".
 *
 * `all` exists because the first two rules alone are not enough, and an earlier
 * version of this comment claimed otherwise. Each field appears **once** per
 * condition, so "flag a AND flag b" had no expression at all: `{flag:'a',
 * flag:'b'}` is not valid JSON, and `[{flag:'a'},{flag:'b'}]` ORs. Any puzzle
 * gated on two flags — or two `itemAt`s, which is how you ask whether both
 * treasures are home — was simply unsayable. test-cave routed around it by
 * letting a trigger supply half the test (`on: drop silver-chalice` +
 * `if: [{itemAt: jade-idol}]`), which works only because a trigger names one
 * entity, and does not generalize.
 *
 * This is still not a general boolean tree, and deliberately so. There is no
 * `not` (the one negation that came up in practice is `notFlag`), no `any`
 * (the array already ORs), and `all` holds leaves only — it does not nest.
 * `all` is the single combinator needed to make the rule above true, and
 * `[{all: [...]}, {all: [...]}]` is disjunctive normal form, which expresses
 * ANY boolean formula. Complete at one level, so it stops at one level.
 *
 * `chance` is the only field that consumes RNG, which is why evaluation
 * returns new state (see `evalCondition`, T12). Two consequences inside `all`:
 * evaluation **short-circuits at the first false**, so a `chance` after a
 * failed sibling does not draw; and `all` is evaluated **before** the outer
 * `chance`, so the "chance is drawn last, only if everything else passed" rule
 * still holds. Both are observable through seeded tests.
 */
/**
 * The leaf tests — every field except `all`.
 *
 * Split out so `all` can hold conditions without recursing. `all` inside `all`
 * is not expressible, and that is a feature, not a limit: `{all: [{all: [a,
 * b]}, c]}` only ever means `{all: [a, b, c]}`, so nesting adds no power and
 * one extra level of tree for a reader to hold. `[{all:[...]}, {all:[...]}]`
 * is already disjunctive normal form, which can express ANY boolean formula.
 * So this grammar is complete at exactly one level, which is why it stops
 * there.
 */
const LEAF_FIELDS = {
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
} as const;

// An empty condition would be vacuously true and is always a typo — most
// likely a misspelled field name that `.strict()` would have caught had it not
// been the only key. Reject it so `if: [{}]` never silently means "always".
const nonEmpty = (c: object): boolean => Object.values(c).some((v) => v !== undefined);
const EMPTY_MESSAGE = { message: 'condition must test at least one thing (an empty condition is always true)' };

/** A condition with no `all` — what `all` itself holds. */
export const zLeafCondition = z.strictObject(LEAF_FIELDS).refine(nonEmpty, EMPTY_MESSAGE);
export type LeafCondition = z.infer<typeof zLeafCondition>;

export const zCondition = z
  .strictObject({
    ...LEAF_FIELDS,
    /**
     * Every listed condition must hold — the AND that a `Condition[]`'s OR
     * cannot express (see the note above). Holds leaves only, by design.
     */
    all: z.array(zLeafCondition).min(1).optional(),
  })
  .refine(nonEmpty, EMPTY_MESSAGE);

export type Condition = z.infer<typeof zCondition>;

/** A list of conditions ORs together; see `zCondition` for the full rule. */
export const zConditions = z.array(zCondition);
