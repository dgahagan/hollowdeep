import { z } from 'zod';
import { zManifest } from './manifest';
import { zLocations } from './location';
import { zItems } from './item';
import { zCreatures } from './creature';
import { zVocabulary } from './vocabulary';
import { zEvents } from './event';
import { zScoring } from './scoring';
import { zAchievements } from './achievement';
import { zStrings } from './strings';
import { zWalkthrough } from './walkthrough';

// The engine↔content contract (FR-6.1). Zod is the single source of truth:
// these schemas are both the runtime validator and, via `z.infer`, the types
// the engine codes against. There are deliberately no hand-written interfaces
// mirroring them — a duplicate type declaration is a second source of truth
// that drifts.
//
// Every object schema is strict, so an unknown key is an error rather than a
// silent no-op. In content data a stray key is nearly always a typo
// (`decsription`), and the failure mode without strictness is the worst kind:
// the adventure loads, the field is ignored, and the bug surfaces as missing
// prose much later.

export * from './common';
export * from './conditions';
export * from './effects';
export * from './manifest';
export * from './location';
export * from './item';
export * from './creature';
export * from './vocabulary';
export * from './event';
export * from './scoring';
export * from './achievement';
export * from './strings';
export * from './walkthrough';

/**
 * A whole adventure, assembled from its documents.
 *
 * The keys map 1:1 to the files under `adventures/<id>/` — `manifest.json`,
 * `locations.json`, and so on (design plan §4). The loader (T6) reads each
 * file, parses it with the matching schema, then cross-checks references
 * between them (T5).
 */
export const zAdventureModule = z.strictObject({
  manifest: zManifest,
  locations: zLocations,
  items: zItems,
  creatures: zCreatures,
  vocabulary: zVocabulary,
  events: zEvents,
  scoring: zScoring,
  achievements: zAchievements,
  strings: zStrings,
  walkthrough: zWalkthrough,
});

export type AdventureModule = z.infer<typeof zAdventureModule>;

/**
 * Filename → schema, for the loader and the CLI validator. Keeping the mapping
 * here means "what documents exist" is stated once.
 */
export const MODULE_DOCUMENTS = {
  'manifest.json': zManifest,
  'locations.json': zLocations,
  'items.json': zItems,
  'creatures.json': zCreatures,
  'vocabulary.json': zVocabulary,
  'events.json': zEvents,
  'scoring.json': zScoring,
  'achievements.json': zAchievements,
  'strings.json': zStrings,
  'walkthrough.json': zWalkthrough,
} as const;

export type ModuleDocumentName = keyof typeof MODULE_DOCUMENTS;
