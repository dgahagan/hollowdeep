import { z } from 'zod';
import { zId, zDirection } from './common';
import { zCondition } from './conditions';

/**
 * An exit from one location toward another (design plan §4.1).
 *
 * The three optional modifiers are independent and combine freely:
 *   - `if` — conditional: the exit only works when the guard passes
 *     (`blockedMessage` is what the player is told when it doesn't);
 *   - `hidden` — not listed in the scene description until a `revealExit`
 *     effect fires. Note `hidden` is about *description*, not traversal: a
 *     hidden exit still works if the player guesses the direction, which is
 *     the classic behavior;
 *   - `oneWay` — no reciprocal exit is implied. Purely documentation for the
 *     author and the consistency checker; the engine never auto-creates
 *     reverse exits regardless.
 */
export const zExit = z.strictObject({
  to: zId,
  /** Guard; a list ORs together (see `zCondition`). */
  if: z.array(zCondition).optional(),
  /** Shown when `if` fails. Without it the engine uses a generic refusal. */
  blockedMessage: z.string().min(1).optional(),
  hidden: z.boolean().default(false),
  oneWay: z.boolean().default(false),
});
export type Exit = z.infer<typeof zExit>;

/**
 * Non-portable set dressing the player can `examine`/`read` but never take.
 *
 * Scenery is deliberately not an Item: it has no id, no location tracking, and
 * no state. It exists so `examine carving` answers instead of shrugging —
 * the FR-2.4 "forgiving failures" bar. Anything that needs to move or change
 * is an Item.
 */
export const zScenery = z.strictObject({
  /** Nouns that match this scenery, e.g. `["carving", "wall"]`. */
  names: z.array(z.string().min(1)).min(1),
  description: z.string().min(1),
  /** If present, `read <name>` works and prints this. */
  readText: z.string().min(1).optional(),
});
export type Scenery = z.infer<typeof zScenery>;

export const zLocation = z.strictObject({
  id: zId,
  /** Short title for the status bar / map, e.g. "Hollow Tree". */
  name: z.string().min(1),
  /** One-line description shown on revisit in brief mode. Doubles as art alt text (NFR-5). */
  brief: z.string().min(1),
  /** Full description shown on first visit and on `look`. */
  full: z.string().min(1),
  artId: zId,
  /** `dark` locations need a light source to see (or survive) — FR-1.4. */
  light: z.enum(['lit', 'dark']),
  /**
   * Exits by direction. Partial: most locations use two or three.
   *
   * `z.partialRecord` matters — Zod 4's `z.record(enum, …)` requires EVERY
   * enum key to be present, which would demand all twelve directions on every
   * location.
   */
  exits: z.partialRecord(zDirection, zExit),
  scenery: z.array(zScenery).optional(),
  /**
   * State-dependent overrides for `full` (and optionally `brief`) — the
   * room reads differently once the world has changed (a door oiled, a
   * flood drained). First variant whose `if` holds wins; none matching
   * falls back to the static texts. Same no-`chance` rule as item
   * description variants (schema/item.ts), enforced by checkConsistency:
   * the read side resolves these freely and must never draw RNG.
   */
  variants: z
    .array(
      z.strictObject({
        if: z.array(zCondition).min(1),
        full: z.string().min(1),
        brief: z.string().min(1).optional(),
      }),
    )
    .optional(),
});
export type Location = z.infer<typeof zLocation>;
export type LocationVariant = NonNullable<Location['variants']>[number];

export const zLocations = z.array(zLocation).min(1);
