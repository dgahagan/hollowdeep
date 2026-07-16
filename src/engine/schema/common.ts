import { z } from 'zod';

// Primitives shared by every document schema. This file sits at the bottom of
// the schema import graph — it must not import from any sibling schema.

/**
 * A stable identifier: lower-kebab-case (`road`, `iron-key`, `twisty-1`).
 *
 * The regex is deliberate. Ids are cross-referenced by every other document
 * (an exit's `to`, an effect's `item`, a condition's `flag`), so a typo that
 * differs only in case or separator would otherwise resolve to "no such id"
 * far from where it was written. Constraining the shape here means
 * consistency checking (T5) reports a dangling *reference* rather than a
 * mystery.
 *
 * The reserved item locations `inventory` and `nowhere` are valid ids by this
 * rule, which is intentional — `itemLocations` holds either a real id or one
 * of those two words.
 */
export const zId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lower-kebab-case, e.g. "hollow-tree"');
export type Id = z.infer<typeof zId>;

/** The twelve directions an exit can point (design plan §4.1). */
export const DIRECTIONS = [
  'n',
  's',
  'e',
  'w',
  'ne',
  'nw',
  'se',
  'sw',
  'up',
  'down',
  'in',
  'out',
] as const;

export const zDirection = z.enum(DIRECTIONS);
export type Direction = z.infer<typeof zDirection>;

/**
 * An exact semver version (`1.0.0`) — used for module and adventure versions.
 * The canonical semver.org regex, minus the build-metadata group we have no
 * use for.
 */
export const zSemver = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
    'must be an exact semver version, e.g. "1.0.0"',
  );

/**
 * A semver *range* (`^1.0.0`, `>=1.2 <2`) — used for `manifest.engineVersion`.
 *
 * Only shape is checked here: ranges have a large grammar, and the range is
 * not merely data — it is half of the engine/adventure handshake. The loader
 * (T6) is what actually resolves it against `ENGINE_VERSION` and rejects a
 * mismatch, so that is where a malformed range is caught with a useful
 * message rather than a regex shrug.
 */
export const zSemverRange = z.string().min(1);
