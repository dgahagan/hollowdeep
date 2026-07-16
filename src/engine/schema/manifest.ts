import { z } from 'zod';
import { zId, zSemver, zSemverRange } from './common';

/**
 * Lamp/fuel configuration (FR-1.4).
 *
 * This lives on the manifest rather than on the lamp item because GameState
 * tracks a single `lampFuel` number (design plan §5.2) — there is one lamp per
 * adventure by construction, and `itemId` says which item it is. An adventure
 * wanting two fuel-burning lamps would need a state-shape change, i.e. a save
 * migration, which is precisely the kind of decision that should not be
 * reachable by editing a content file.
 */
export const zLampConfig = z
  .strictObject({
    /** The lamp item. Must be an item with `lightSource: true`. */
    itemId: zId,
    /** Fuel at game start, in turns of burn. */
    startFuel: z.number().int().nonnegative(),
    /** Fuel levels that trigger a warning, each firing once. FR-1.4. */
    warnAt: z.array(z.number().int().nonnegative()).default([]),
    /** The refuel mechanic (FR-1.4). Omit for an adventure without one. */
    refuel: z
      .strictObject({
        /** The fuel source, e.g. an oil flask. */
        itemId: zId,
        /** Fuel added per use. */
        amount: z.number().int().positive(),
        /** Whether the source is consumed (moved to `nowhere`). */
        consumesItem: z.boolean().default(true),
      })
      .optional(),
  })
  // Duplicate thresholds would fire two warnings at one fuel level; an
  // unsorted list is fine (the engine matches on value, not order), but
  // duplicates are always a mistake.
  .refine((l) => new Set(l.warnAt).size === l.warnAt.length, {
    message: 'warnAt has duplicate thresholds',
    path: ['warnAt'],
  });
export type LampConfig = z.infer<typeof zLampConfig>;

/** What happens to a player wandering a `dark` location unlit (FR-1.4). */
export const zDarknessConfig = z.strictObject({
  /** Death probability per turn in the dark, 0..1. Drawn from the seeded RNG. */
  deathChance: z.number().min(0).max(1),
  /** `strings.json` id: shown on entering/being in the dark. */
  warningMessageId: zId,
  /** `strings.json` id: shown when the dark kills. */
  deathMessageId: zId,
});
export type DarknessConfig = z.infer<typeof zDarknessConfig>;

export const zManifest = z.strictObject({
  /** Stable adventure id; namespaces saves (`cave.<id>.slot.<n>`). */
  id: zId,
  title: z.string().min(1),
  /** This adventure's version. Recorded in saves; a bump can require migration. */
  version: zSemver,
  /**
   * Semver RANGE of engine versions this adventure runs on. Half of the
   * version handshake — the loader (T6) checks it against `ENGINE_VERSION`
   * and refuses a mismatch rather than failing mysteriously mid-game.
   */
  engineVersion: zSemverRange,
  startLocation: zId,
  /** Where treasures must be deposited to score `depositPoints`. */
  repositoryLocation: zId,
  /** Sum of all attainable points. T5 reconciles this against the content. */
  maxScore: z.number().int().nonnegative(),
  /** Maximum items carried at once (FR-1.2). */
  carryLimit: z.number().int().positive(),
  lamp: zLampConfig,
  darkness: zDarknessConfig,
});
export type Manifest = z.infer<typeof zManifest>;
