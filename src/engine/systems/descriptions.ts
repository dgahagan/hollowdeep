import type { AdventureModule, Item, Location } from '../schema';
import type { GameState } from '../types';
import { evalConditions } from './events';

// State-dependent description resolution (the conditional-descriptions
// feature, 2026-07-18). One rule, three surfaces: an item's `examine` text,
// a location's `full`, and a location's `brief` each pick the FIRST variant
// whose `if` conditions hold, falling back to the static text when none do
// (or none exist — every pre-feature adventure is a module with no variants,
// unchanged).
//
// PURITY IS THE CONTRACT HERE. These are read-side helpers — `describeScene`
// may call them any number of times per render — so the GameState that
// `evalConditions` threads back (it exists for `chance`'s RNG draw) is
// deliberately DISCARDED. That is only sound because `checkConsistency`
// refuses any variant whose conditions contain `chance`, recursively; the
// validator owns that gate so this module can stay a pure function of
// (module, state).

/** The item's `examine` text: first matching variant, else `description`. */
export function itemDescription(module: AdventureModule, state: GameState, item: Item): string {
  for (const variant of item.descriptionVariants ?? []) {
    const [holds] = evalConditions(module, state, variant.if);
    if (holds) return variant.text;
  }
  return item.description;
}

function matchingLocationVariant(module: AdventureModule, state: GameState, location: Location) {
  for (const variant of location.variants ?? []) {
    const [holds] = evalConditions(module, state, variant.if);
    if (holds) return variant;
  }
  return undefined;
}

/** The location's full description: first matching variant, else `full`. */
export function locationFull(module: AdventureModule, state: GameState, location: Location): string {
  return matchingLocationVariant(module, state, location)?.full ?? location.full;
}

/** The location's brief: a matching variant's `brief` if it declares one, else the static `brief`. */
export function locationBrief(module: AdventureModule, state: GameState, location: Location): string {
  return matchingLocationVariant(module, state, location)?.brief ?? location.brief;
}
