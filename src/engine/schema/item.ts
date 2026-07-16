import { z } from 'zod';
import { zId } from './common';

/**
 * Treasure points (FR-1.5). Two separate awards, both once each:
 * `carryPoints` when the player first picks it up, `depositPoints` when it
 * reaches `manifest.repositoryLocation`. Finding is worth something; banking
 * it is worth more — that split is the classic scoring shape and the reason
 * a thief who steals your haul costs points rather than progress.
 *
 * Both feed `maxScore`, which T5 reconciles against the declared total.
 */
export const zTreasure = z.strictObject({
  carryPoints: z.number().int().nonnegative(),
  depositPoints: z.number().int().nonnegative(),
});
export type Treasure = z.infer<typeof zTreasure>;

/** An item that holds other items (FR-1.10). */
export const zContainer = z
  .strictObject({
    open: z.boolean(),
    locked: z.boolean().default(false),
    /** Item id that locks/unlocks this. Required when `locked` is true. */
    keyId: zId.optional(),
    /**
     * Maximum number of items held.
     *
     * `0` is legal and meaningful: `container` is where open/closed/locked
     * state lives, so it is also how a *door* is modelled — §8's grate is
     * openable, lockable, and holds nothing. Relaxed from positive to
     * nonnegative during T9 (2026-07-16) when that turned out to be the only
     * way to express the grate.
     */
    capacity: z.number().int().nonnegative(),
  })
  // A locked container with no key is unopenable — always an authoring bug,
  // and one that presents as an unwinnable game rather than an error.
  .refine((c) => !c.locked || c.keyId !== undefined, {
    message: 'a locked container needs a keyId, or nothing can ever open it',
    path: ['keyId'],
  });
export type Container = z.infer<typeof zContainer>;

export const zItem = z
  .strictObject({
    id: zId,
    /** Nouns matching this item; the first is the canonical name. */
    names: z.array(z.string().min(1)).min(1),
    /** Words that narrow an ambiguous noun, e.g. `iron` in "iron key". */
    adjectives: z.array(z.string().min(1)).optional(),
    /** One line shown when the item is listed in a room. */
    brief: z.string().min(1),
    /** Shown on `examine`. */
    description: z.string().min(1),
    artId: zId,
    portable: z.boolean(),
    /** A location id, a container id, `inventory`, or `nowhere` (not yet in play). */
    initialLocation: zId,
    treasure: zTreasure.optional(),
    container: zContainer.optional(),
    /**
     * Whether this item can light dark rooms. Fuel is NOT here — it lives in
     * `manifest.lamp` (design plan §4.1), because GameState tracks a single
     * `lampFuel` number rather than per-item fuel.
     */
    lightSource: z.boolean().default(false),
    /** If present, `read <name>` works. */
    readText: z.string().min(1).optional(),
  })
  // Points for an item nobody can pick up are points nobody can score, which
  // would make `maxScore` unreachable — T5 would flag the arithmetic, but the
  // real error is here.
  .refine((i) => i.treasure === undefined || i.portable, {
    message: 'a treasure must be portable, or its carry/deposit points are unattainable',
    path: ['portable'],
  });
export type Item = z.infer<typeof zItem>;

export const zItems = z.array(zItem);
