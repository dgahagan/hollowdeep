import type { AdventureModule, Creature, Item, Location } from './schema';
import {
  ITEM_INVENTORY,
  ITEM_NOWHERE,
  type CreatureState,
  type GameState,
  type ItemState,
} from './types';

// Pure read/write helpers over GameState (design plan §5.2), plus createGame.
//
// This file exists mostly because of `noUncheckedIndexedAccess`. GameState is
// Record-heavy — itemLocations, itemState, flags, creatures — and under that
// flag every lookup is `T | undefined`. The temptation downstream is to reach
// for `!` or `as`, which throws away exactly the safety the flag buys. So the
// narrowing happens ONCE, here, behind accessors that return honest types, and
// the twenty call sites in actions/ and systems/ never have to think about it.
//
// Every writer returns a NEW state. Nothing mutates its argument.

// ─── module lookups ──────────────────────────────────────────────────────────

export function findLocation(module: AdventureModule, id: string): Location | undefined {
  return module.locations.find((l) => l.id === id);
}

export function findItem(module: AdventureModule, id: string): Item | undefined {
  return module.items.find((i) => i.id === id);
}

export function findCreature(module: AdventureModule, id: string): Creature | undefined {
  return module.creatures.find((c) => c.id === id);
}

/**
 * The player's current location.
 *
 * Throws if it does not resolve — and that is right. Consistency checking
 * (T5) proves `startLocation` and every exit `to` exist before a game can
 * start, so an unresolvable current location is not bad content, it is an
 * engine bug. Returning `undefined` here would push a `| undefined` into
 * every caller to model a state that cannot happen.
 */
export function currentLocation(module: AdventureModule, state: GameState): Location {
  const location = findLocation(module, state.locationId);
  if (location === undefined) {
    throw new Error(`engine invariant: no location "${state.locationId}"`);
  }
  return location;
}

// ─── items ───────────────────────────────────────────────────────────────────

/** Where an item is, or `nowhere` if the state has no record of it. */
export function itemLocation(state: GameState, itemId: string): string {
  return state.itemLocations[itemId] ?? ITEM_NOWHERE;
}

export function isCarrying(state: GameState, itemId: string): boolean {
  return itemLocation(state, itemId) === ITEM_INVENTORY;
}

export function setItemLocation(state: GameState, itemId: string, to: string): GameState {
  return { ...state, itemLocations: { ...state.itemLocations, [itemId]: to } };
}

/** Items directly at a location — not inside containers there. */
export function itemsAt(module: AdventureModule, state: GameState, locationId: string): Item[] {
  return module.items.filter((item) => itemLocation(state, item.id) === locationId);
}

export function carriedItems(module: AdventureModule, state: GameState): Item[] {
  return itemsAt(module, state, ITEM_INVENTORY);
}

export function carriedCount(module: AdventureModule, state: GameState): number {
  return carriedItems(module, state).length;
}

/** Items inside a container item. */
export function itemsIn(module: AdventureModule, state: GameState, containerId: string): Item[] {
  return itemsAt(module, state, containerId);
}

export function getItemState(state: GameState, itemId: string): ItemState {
  return state.itemState[itemId] ?? {};
}

export function setItemState(
  state: GameState,
  itemId: string,
  patch: Partial<ItemState>,
): GameState {
  return {
    ...state,
    itemState: { ...state.itemState, [itemId]: { ...getItemState(state, itemId), ...patch } },
  };
}

/**
 * Whether the player has light: any carried item that is a light source and
 * is lit. (The lamp is the only one in test-cave, but nothing here assumes
 * that — an adventure may ship a candle.)
 */
export function hasLight(module: AdventureModule, state: GameState): boolean {
  return module.items.some(
    (item) => item.lightSource && isCarrying(state, item.id) && getItemState(state, item.id).lit === true,
  );
}

/** Whether the player can see: the location is lit, or they brought light. */
export function canSee(module: AdventureModule, state: GameState): boolean {
  const location = currentLocation(module, state);
  return location.light === 'lit' || hasLight(module, state);
}

// ─── flags ───────────────────────────────────────────────────────────────────

export function getFlag(state: GameState, flag: string): boolean | number | undefined {
  return state.flags[flag];
}

/** Flags are truthy-tested: an unset flag and a `false`/`0` flag both fail. */
export function isFlagSet(state: GameState, flag: string): boolean {
  const value = state.flags[flag];
  return value !== undefined && value !== false && value !== 0;
}

export function setFlag(state: GameState, flag: string, value: boolean | number): GameState {
  return { ...state, flags: { ...state.flags, [flag]: value } };
}

/**
 * Clear a flag by deleting the key, not by setting `false`.
 *
 * Both read as falsy through `isFlagSet`, but deletion keeps saves from
 * accumulating tombstones of every flag an adventure ever touched.
 */
export function clearFlag(state: GameState, flag: string): GameState {
  const { [flag]: _removed, ...rest } = state.flags;
  return { ...state, flags: rest };
}

// ─── visited / events ────────────────────────────────────────────────────────

export function hasVisited(state: GameState, locationId: string): boolean {
  return state.visited.includes(locationId);
}

export function markVisited(state: GameState, locationId: string): GameState {
  if (state.visited.includes(locationId)) return state;
  return { ...state, visited: [...state.visited, locationId] };
}

export function hasFired(state: GameState, eventId: string): boolean {
  return state.firedEvents.includes(eventId);
}

export function markFired(state: GameState, eventId: string): GameState {
  if (state.firedEvents.includes(eventId)) return state;
  return { ...state, firedEvents: [...state.firedEvents, eventId] };
}

// ─── creatures ───────────────────────────────────────────────────────────────

export function getCreatureState(state: GameState, creatureId: string): CreatureState | undefined {
  return state.creatures[creatureId];
}

export function setCreatureState(
  state: GameState,
  creatureId: string,
  patch: Partial<CreatureState>,
): GameState {
  const existing = state.creatures[creatureId];
  if (existing === undefined) return state;
  return { ...state, creatures: { ...state.creatures, [creatureId]: { ...existing, ...patch } } };
}

/** Active creatures sharing the player's location. */
export function creaturesHere(module: AdventureModule, state: GameState): Creature[] {
  return module.creatures.filter((creature) => {
    const cs = state.creatures[creature.id];
    return cs !== undefined && cs.active && cs.locationId === state.locationId;
  });
}

// ─── achievements ────────────────────────────────────────────────────────────

export function hasAchievement(state: GameState, achievementId: string): boolean {
  return state.achievements.includes(achievementId);
}

export function addAchievement(state: GameState, achievementId: string): GameState {
  if (state.achievements.includes(achievementId)) return state;
  return { ...state, achievements: [...state.achievements, achievementId] };
}

// ─── createGame ──────────────────────────────────────────────────────────────

/**
 * A creature is active from turn 0 only if nothing gates it. `afterTurn` and
 * `if` are both gates; either one means "not yet". A `static` creature with a
 * bare `spawn.locations` (test-cave's newt) is simply always there.
 */
function initialCreatureState(creature: Creature): CreatureState {
  const gated = creature.spawn.afterTurn !== undefined || creature.spawn.if !== undefined;
  const home = creature.spawn.locations[0];
  return {
    // `locations` is `.min(1)` in the schema, so [0] exists; the fallback
    // satisfies noUncheckedIndexedAccess without an assertion.
    locationId: home ?? ITEM_NOWHERE,
    active: !gated,
    encounterTurns: 0,
    activatedTurn: gated ? null : 0,
    hasStolen: false,
  };
}

/**
 * Build the starting state for an adventure (design plan §5.1).
 *
 * Deterministic: same module + same seed ⇒ byte-identical state. It draws no
 * RNG at all — the seed is simply stored — so nothing about the opening
 * position varies between runs.
 */
export function createGame(module: AdventureModule, seed: number): GameState {
  const itemLocations: Record<string, string> = {};
  const itemState: Record<string, ItemState> = {};

  for (const item of module.items) {
    itemLocations[item.id] = item.initialLocation;

    const state: ItemState = {};
    if (item.container !== undefined) {
      state.open = item.container.open;
      state.locked = item.container.locked;
    }
    if (item.lightSource) {
      state.lit = false;
    }
    if (Object.keys(state).length > 0) {
      itemState[item.id] = state;
    }
  }

  const creatures: Record<string, CreatureState> = {};
  for (const creature of module.creatures) {
    creatures[creature.id] = initialCreatureState(creature);
  }

  return {
    // `| 0` keeps the RNG in int32 from the very first draw, so a caller
    // passing a float or a huge seed still gets the documented sequence.
    rng: seed | 0,
    turn: 0,
    locationId: module.manifest.startLocation,
    previousLocationId: module.manifest.startLocation,
    itemLocations,
    itemState,
    lampFuel: module.manifest.lamp.startFuel,
    flags: {},
    visited: [module.manifest.startLocation],
    firedEvents: [],
    creatures,
    timers: {},
    score: 0,
    deaths: 0,
    hintsUsed: 0,
    hintsRevealed: {},
    achievements: [],
    scoredCarry: [],
    scoredDeposit: [],
    awardedMilestones: [],
    lampWarned: [],
    verbose: false,
  };
}
