import type { AdventureModule, Creature } from '../schema';
import type { GameState, OutputEvent } from '../types';
import { rollChance } from '../rng';
import {
  findItem,
  getCreatureState,
  getItemState,
  isCarrying,
  isFlagSet,
  setCreatureState,
  setItemLocation,
} from '../state';
import { applyEffects, DIED_THIS_TURN, evalConditions } from './events';

// The three data-driven creature behaviors (design plan §4.1, §8; FR-1.7).
// foundation-implementation-plan.md T19.
//
// This is the `creatures` stage of `worldTick`'s FIXED order (engine.ts):
// **events → creatures → light → scoring**. Do not reorder anything around it.
//
// RNG CONSUMPTION ORDER — a public contract the moment a seeded test picks a
// seed (design plan §10; rng.ts). Within this stage:
//
//   Creatures are processed in `module.creatures` ARRAY ORDER, one at a time,
//   fully, before moving to the next. For each creature:
//
//     1. **Spawn gating** (`evalSpawnGate`), only while `!active`:
//        `afterTurn` is checked first and SHORT-CIRCUITS — if the turn gate
//        fails, `spawn.if` is never evaluated and draws no RNG even if
//        content puts a `chance` condition in it. Only once the turn gate
//        passes (or is absent) does `spawn.if` run through `evalConditions`
//        (systems/events.ts), which draws RNG ONLY if a condition uses
//        `chance` — no shipped creature does. This is the only point where a
//        THIEF's activation could theoretically consume RNG, and it doesn't
//        in test-cave (the packrat's gate is a bare flag check).
//
//     2. **Behavior tick**, only while `active` (freshly activated this same
//        tick counts — `activatedTurn` is stamped with the CURRENT turn, so
//        "turns since activation" is 0 and nothing scheduled for turn > 0
//        fires yet):
//
//        - **stalker** — (2a) movement: deterministic, NO RNG (a fixed
//          schedule cycling `spawn.locations`). (2b) encounter bookkeeping:
//          NO RNG. (2c) aggression roll: THE ONLY RNG DRAW IN THIS ENTIRE
//          SYSTEM, and only when — after movement — the creature shares the
//          player's location, the player hasn't already died this turn, and
//          the player is not warded off (`wardOff.itemIds`, checked with NO
//          roll at all: a warded encounter never touches the RNG stream).
//
//        - **thief** — fully deterministic. Timing is `stealAfterTurns` turns
//          past `activatedTurn`, the target is every carried item with a
//          `treasure` field, the destination is `stashLocation`. NO RNG
//          ANYWHERE in this path — see schema/creature.ts for why (T23's
//          seed-independent walkthrough depends on it).
//
//        - **static** — no movement, no attack, no RNG. Exists to be seen.
//
// With today's test-cave content (one stalker, one thief, one static, none of
// them sharing a `chance`-guarded `spawn.if`), the cave rat's aggression roll
// is the ONLY RNG draw this entire stage ever makes, and it is the first
// creature in `creatures.json` — so a test that sets `state.rng` directly and
// puts the player in the rat's room is testing exactly that one draw, with
// nothing upstream of it in this stage to perturb the sequence.

/**
 * Is the player currently warding this creature off via a held item —
 * `wardOff.itemIds` (schema/creature.ts) — evaluated the same way
 * `actions/combat.ts`'s `isHeldWard` does: carried, and if it is a light
 * source, additionally LIT. Duplicated rather than imported: `actions/` sits
 * above `systems/` in the dependency direction (actions call into systems,
 * not the reverse), so the code can't be shared, but the MEANING has to agree
 * — see combat.ts's own execution notes on this exact hazard.
 *
 * `wardOff.verbIds` has no equivalent here on purpose. It wards off one
 * PLAYER-INITIATED verb for the duration of that single command (combat.ts);
 * there is no verb being executed in the ambient world tick, so it has
 * nothing to match against.
 */
function isWardedByHeldItem(module: AdventureModule, state: GameState, creature: Creature): boolean {
  const itemIds = creature.wardOff?.itemIds ?? [];
  return itemIds.some((id) => {
    const item = findItem(module, id);
    if (item === undefined || !isCarrying(state, id)) return false;
    if (item.lightSource) return getItemState(state, id).lit === true;
    return true;
  });
}

/**
 * Should a not-yet-active creature activate now? AND semantics between the
 * two gates, with `afterTurn` checked first and short-circuiting — see the
 * file header on why order here matters for RNG.
 */
function evalSpawnGate(
  module: AdventureModule,
  state: GameState,
  creature: Creature,
): [boolean, GameState] {
  if (creature.spawn.afterTurn !== undefined && state.turn < creature.spawn.afterTurn) {
    return [false, state];
  }
  return evalConditions(module, state, creature.spawn.if);
}

/**
 * Stalker tick: movement, then — only in an encounter — the one aggression
 * roll. See the file header for the exact order and why it's fixed.
 */
function stalkerTick(module: AdventureModule, state: GameState, creature: Creature): [GameState, OutputEvent[]] {
  const cs = getCreatureState(state, creature.id);
  if (cs === undefined) return [state, []];

  const activatedTurn = cs.activatedTurn ?? state.turn;
  let creatureLocationId = cs.locationId;

  // (2a) Movement — deterministic, no RNG. Cycles through `spawn.locations`
  // every `moveEvery` turns since activation; `turnsSince > 0` means the
  // activation turn itself never counts as a move (0 % anything is 0, but we
  // exclude it explicitly so a creature doesn't visibly teleport the instant
  // it spawns).
  if (creature.moveEvery !== undefined) {
    const turnsSince = state.turn - activatedTurn;
    if (turnsSince > 0 && turnsSince % creature.moveEvery === 0) {
      const locations = creature.spawn.locations;
      const currentIndex = locations.indexOf(creatureLocationId);
      const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % locations.length : 0;
      creatureLocationId = locations[nextIndex] ?? creatureLocationId;
    }
  }

  // (2b) Encounter bookkeeping — no RNG. `encounterTurns` counts consecutive
  // turns sharing the player's location; it resets the instant that stops
  // being true.
  const sharing = creatureLocationId === state.locationId;
  let current = setCreatureState(state, creature.id, {
    locationId: creatureLocationId,
    encounterTurns: sharing ? cs.encounterTurns + 1 : 0,
  });

  if (!sharing) return [current, []];
  // Another creature (or an earlier stage) already killed the player this
  // turn — don't stack a second death notice. Same guard, same reasoning, as
  // light.ts's darknessDanger.
  if (isFlagSet(current, DIED_THIS_TURN)) return [current, []];
  // Schema requires `aggression` on a stalker, but a hand-built test state
  // should not crash the tick if it's somehow missing.
  if (creature.aggression === undefined) return [current, []];
  // Warded off: no roll at all. A defused encounter never touches the RNG
  // stream, which is exactly what lets tests that carry the lit lamp assert
  // `state.rng` is untouched.
  if (isWardedByHeldItem(module, current, creature)) return [current, []];

  // (2c) THE ONLY RNG DRAW IN THIS SYSTEM.
  const [hit, rng] = rollChance(current.rng, creature.aggression);
  current = { ...current, rng };
  if (!hit) return [current, []];

  return applyEffects(module, current, [{ kind: 'die', messageId: creature.deathMessageId }]);
}

/**
 * Thief tick: fully deterministic, no RNG anywhere (design plan §8;
 * schema/creature.ts). Fires exactly once, `stealAfterTurns` turns after
 * activation, taking every carried treasure to `stashLocation`.
 *
 * Fires on schedule regardless of what (if anything) is being carried at that
 * exact turn — the timer is the whole mechanism, not a snapshot check at
 * activation. A player who happens to be carrying nothing when the window
 * lands dodges the theft entirely, once per game, by design: determinism cuts
 * both ways, and "leave no RNG for T23 to depend on" does not mean "the thief
 * cannot be out-manoeuvred by ordinary play".
 */
function thiefTick(module: AdventureModule, state: GameState, creature: Creature): [GameState, OutputEvent[]] {
  const cs = getCreatureState(state, creature.id);
  if (cs === undefined || cs.hasStolen) return [state, []];
  if (creature.stealsTreasure !== true) return [state, []];
  // Schema requires both on a thief; guarded anyway so a hand-built test
  // state can't crash the tick.
  if (creature.stealAfterTurns === undefined || creature.stashLocation === undefined) return [state, []];

  const activatedTurn = cs.activatedTurn ?? state.turn;
  const turnsSinceActivation = state.turn - activatedTurn;
  if (turnsSinceActivation < creature.stealAfterTurns) return [state, []];

  const stash = creature.stashLocation;
  let current = state;
  const stolen = module.items.filter((item) => item.treasure !== undefined && isCarrying(current, item.id));
  for (const item of stolen) {
    current = setItemLocation(current, item.id, stash);
  }
  current = setCreatureState(current, creature.id, { hasStolen: true });

  // The taunt is genuinely a theft-flavour line, not a death — see the
  // file's note on why it's read out of the same `deathMessageId` field a
  // stalker's kill uses (T9's content authoring choice; the schema has no
  // separate "steal" message id and doesn't need one, since this is the only
  // other place a creature "does its thing" to the player).
  if (stolen.length > 0 && creature.deathMessageId !== undefined) {
    const text = module.strings[creature.deathMessageId];
    if (text !== undefined) return [current, [{ kind: 'text', text }]];
  }
  return [current, []];
}

/**
 * The `creatures` stage of `worldTick` (engine.ts). Runs on every consumed
 * turn — `worldTick` itself is only ever called when one was.
 */
export function creatureTick(module: AdventureModule, state: GameState): [GameState, OutputEvent[]] {
  let current = state;
  const output: OutputEvent[] = [];

  for (const creature of module.creatures) {
    const cs = getCreatureState(current, creature.id);
    if (cs === undefined) continue; // invariant: createGame seeds every creature.

    if (!cs.active) {
      const [shouldActivate, afterGate] = evalSpawnGate(module, current, creature);
      current = afterGate;
      if (!shouldActivate) continue;
      current = setCreatureState(current, creature.id, { active: true, activatedTurn: current.turn });
    }

    switch (creature.behavior) {
      case 'stalker': {
        const [next, events] = stalkerTick(module, current, creature);
        current = next;
        output.push(...events);
        break;
      }
      case 'thief': {
        const [next, events] = thiefTick(module, current, creature);
        current = next;
        output.push(...events);
        break;
      }
      case 'static':
        break;
      default: {
        const exhaustive: never = creature.behavior;
        throw new Error(`creatureTick: unhandled behavior ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  return [current, output];
}
