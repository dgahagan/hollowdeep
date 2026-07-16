import type { AdventureModule, Creature } from '../schema';
import type { Target } from '../parser/parse';
import { findCreature, findItem, getItemState, isCarrying } from '../state';
import { applyEffects } from '../systems/events';
import type { GameState } from '../types';
import { acted, refuse, type ActionHandler } from './index';

// attack / throw / give (foundation-implementation-plan.md T17).
//
// There is no hit-point combat model anywhere in this engine — the design
// plan never describes one, and `creature.ts`'s schema has nothing resembling
// health. The one real mechanic these three verbs share is `wardOff`
// (schema/creature.ts): a stalker becomes harmless to deal with if the player
// is carrying/holding one of `wardOff.itemIds` (a LIT lamp, specifically —
// see `isHeldWard` below) or acts against it with one of `wardOff.verbIds`.
// T19's creature tick checks the same fields before a stalker's own
// aggression roll; this file is the OTHER side of it — what happens when the
// PLAYER initiates the encounter.
//
// Turn consumption is the load-bearing decision in each handler, and it
// follows one rule: a turn is consumed when something in the world actually
// changed as a result (the creature was warded off, an item left your hand),
// and refused (no turn) when nothing did — the "nudge, not error" pattern
// `handling.ts` and `senses.ts` already establish for a command that is
// syntactically fine but has no real effect.
//
//   - `attack`: warded off → acted (the creature's reaction IS the effect).
//     Not warded off → refuse. There is nothing else `attack` could do —
//     without a combat model, swinging at something you have no answer for
//     is all nudge, and charging a turn for it would be charging fuel for a
//     gesture.
//   - `throw`: always acted. The item leaves your hand and lands somewhere —
//     that already happened by the time anyone judges whether it mattered.
//   - `give`: acted only if the creature specifically wants what you're
//     offering — see `itemSpecificallyWards` below, NOT the general
//     `isWardedOff` (a prior version of this file conflated the two, which
//     let carrying an unrelated ward make ANY gift land, destroying items
//     the creature never asked for). An accepted item is placed at the
//     creature's location, not deleted — `wardOff` never claims a creature
//     eats or holds anything. Otherwise it declines: nothing changed, so no
//     turn, and the item stays with you.

function creatureFor(module: AdventureModule, target: Target): Creature | undefined {
  return target.kind === 'creature' ? findCreature(module, target.id) : undefined;
}

/**
 * Is `itemId` currently warding on its own — i.e. the player is
 * carrying/holding it, per `wardOff.itemIds` (schema/creature.ts)?
 *
 * A light source only counts LIT. The schema comment's own example is "a lit
 * lamp", not merely a carried one — an unlit lamp in your pocket has done
 * nothing to the creature staring at you, and treating "carried" alone as
 * enough would make `light lamp` pointless busywork before every encounter.
 * Non-light-source items (a thrown pebble, say) need only be held.
 */
function isHeldWard(module: AdventureModule, state: GameState, itemId: string): boolean {
  const item = findItem(module, itemId);
  if (item === undefined || !isCarrying(state, item.id)) return false;
  if (item.lightSource) return getItemState(state, item.id).lit === true;
  return true;
}

/**
 * Is the creature's `verbIds` list satisfied by this verb — "having used one
 * of verbIds against it" (schema/creature.ts), independent of any item.
 */
function verbWards(creature: Creature, verb: string): boolean {
  return (creature.wardOff?.verbIds ?? []).includes(verb);
}

/**
 * Is the player warded off *in general* — carrying/holding ANY of the
 * creature's `wardOff.itemIds` (`isHeldWard`, above), regardless of what verb
 * or item this particular command names, OR the verb itself matching
 * `verbIds`?
 *
 * This is the right question for `attack`: a lit lamp in your other hand
 * wards a light-fearing creature off no matter what you swing, so "is the
 * player warded" (not "is the thing you swung the ward") is exactly what
 * `attack` means. It is the WRONG question for `give`/`throw` crediting —
 * see `itemSpecificallyWards` below, which a prior version of this file
 * conflated with this one. That bug let `give` accept (and destroy) any
 * item at all, and `throw` credit the wrong item, as long as the player
 * merely happened to be carrying an unrelated ward.
 */
function isWardedOff(module: AdventureModule, state: GameState, creature: Creature, verb: string): boolean {
  const ward = creature.wardOff;
  if (ward === undefined) return false;

  if ((ward.itemIds ?? []).some((id) => isHeldWard(module, state, id))) return true;
  return verbWards(creature, verb);
}

/**
 * Does THIS item specifically satisfy this creature's `wardOff.itemIds` —
 * i.e. does the creature care about the item under consideration, as
 * opposed to "is the player warded by something, possibly unrelated"?
 *
 * `give` and `throw`'s crediting both need this question, not
 * `isWardedOff`'s: a rat that only fears a lit lamp must not accept (and
 * consume) an unrelated flask just because the player also happens to be
 * carrying that lamp, and a thrown flask must not get credit for a ward the
 * lamp is doing. Still routes through `isHeldWard` for the lit-source rule —
 * an unlit lamp handed over or swung is not the thing that scares anyone.
 */
function itemSpecificallyWards(
  module: AdventureModule,
  state: GameState,
  creature: Creature,
  itemId: string,
): boolean {
  const ward = creature.wardOff;
  if (ward === undefined) return false;
  return (ward.itemIds ?? []).includes(itemId) && isHeldWard(module, state, itemId);
}

/** Canonical name for flavour text — `names[0]`, never `description` (that's the sighted-on-look text, not a name). */
function nameOf(creature: Creature): string {
  return creature.names[0] ?? creature.id;
}

/**
 * `attack <creature>` or `attack <creature> with <item>`.
 *
 * Only a creature is a sensible attack target — items and scenery resolve to
 * a real `Target` (the parser did its job) but there is nothing to fight
 * there, same reasoning as `enterHandler`'s noun refusal in movement.ts.
 */
export const attackHandler: ActionHandler = (module, state, command) => {
  if (command.kind !== 'verb-noun' && command.kind !== 'verb-noun-prep-noun') {
    return refuse(state, 'Attack what?');
  }

  const creature = creatureFor(module, command.target);
  if (creature === undefined) {
    return refuse(state, "You can't fight that.");
  }

  if (isWardedOff(module, state, creature, 'attack')) {
    return acted(state, [
      {
        kind: 'text',
        text: `The ${nameOf(creature)} takes one look at what you're holding and reconsiders the whole encounter. It backs off, unhurried, and finds something else to be professionally interested in.`,
      },
    ]);
  }

  return refuse(
    state,
    `Attacking the ${nameOf(creature)} barehanded sounds like the opening line of a story that ends badly for you. You have nothing that would help.`,
  );
};

/**
 * `throw <item>` (drop it, forcefully) or `throw <item> at <creature>`.
 *
 * Always consumes a turn once the item is genuinely yours to throw — the
 * physical act happened regardless of what it accomplished. The item ends up
 * on the floor either way; `wardOff` only changes the flavour text, never
 * whether the item lands.
 */
export const throwHandler: ActionHandler = (module, state, command) => {
  if (command.kind !== 'verb-noun' && command.kind !== 'verb-noun-prep-noun') {
    return refuse(state, 'Throw what?');
  }

  const item = command.target.kind === 'item' ? findItem(module, command.target.id) : undefined;
  if (item === undefined || !isCarrying(state, item.id)) {
    return refuse(state, "You aren't carrying that.");
  }

  if (command.kind === 'verb-noun') {
    const [next] = applyEffects(module, state, [{ kind: 'moveItem', item: item.id, to: state.locationId }]);
    return acted(next, [
      { kind: 'text', text: `You throw the ${command.noun} aside. It skitters across the floor, no wiser for the trip.` },
    ]);
  }

  const creature = creatureFor(module, command.secondTarget);
  if (creature === undefined) {
    return refuse(state, `Throwing that at the ${command.secondNoun} wouldn't accomplish anything.`);
  }

  const [next] = applyEffects(module, state, [{ kind: 'moveItem', item: item.id, to: state.locationId }]);

  // Three distinct outcomes, and the middle one is the whole point of the
  // fix: a creature can be warded off (isWardedOff, e.g. by a lit lamp on
  // your belt) by something OTHER than what just left your hand. The text
  // must say so honestly rather than crediting whatever was thrown — that
  // was the bug (a thrown flask "warding off" a rat that only fears light).
  const creditedByThisThrow = itemSpecificallyWards(module, state, creature, item.id) || verbWards(creature, 'throw');
  const text = creditedByThisThrow
    ? `The ${command.noun} catches the ${nameOf(creature)} full in its composure, and it decides this spot belongs to someone else now.`
    : isWardedOff(module, state, creature, 'throw')
      ? `The ${command.noun} lands somewhere near the ${nameOf(creature)}, which barely reacts — whatever is keeping it at a distance right now, this isn't it.`
      : `The ${command.noun} bounces off the rock somewhere near the ${nameOf(creature)}, which does not appear to notice or care.`;
  return acted(next, [{ kind: 'text', text }]);
};

/**
 * `give <item> to <creature>` — the only pattern `give` has (`VNPN`,
 * `parser/vocab.ts`); there is no bare or two-word form to fall through to.
 *
 * Unlike `throw`, an unwanted gift is a genuine no-op: nothing about the
 * world changed, so it is a refusal (no turn, item stays with you) rather
 * than an action that merely failed to matter.
 *
 * Acceptance is gated on `itemSpecificallyWards` — does the creature want
 * THIS item — never the general `isWardedOff`. `wardOff` (schema/creature.ts)
 * has no gift, tribute, or creature-inventory concept in it at all: it only
 * claims a creature is warded OFF, not appeased or fed. Using the general
 * check here was a real bug: it accepted (and irrecoverably destroyed) ANY
 * item at all as long as the player merely carried some unrelated ward —
 * `give <the only flask> to <a rat that wards on lamps>` would happily
 * annihilate the flask. The fix is also why the accepted item is placed at
 * the creature's location rather than moved to `nowhere` — nothing in the
 * schema claims the creature consumes it, and `nowhere` is unrecoverable,
 * which is exactly how "give away your only lamp" turns into a soft-lock in
 * a dark cave. Placed on the floor, it can be picked back up.
 */
export const giveHandler: ActionHandler = (module, state, command) => {
  if (command.kind !== 'verb-noun-prep-noun') {
    return refuse(state, 'Give what to what?');
  }

  const item = command.target.kind === 'item' ? findItem(module, command.target.id) : undefined;
  if (item === undefined || !isCarrying(state, item.id)) {
    return refuse(state, "You aren't carrying that.");
  }

  const creature = creatureFor(module, command.secondTarget);
  if (creature === undefined) {
    return refuse(state, `There's no one there to give the ${command.noun} to.`);
  }

  const accepted = itemSpecificallyWards(module, state, creature, item.id) || verbWards(creature, 'give');
  if (!accepted) {
    return refuse(state, `The ${nameOf(creature)} has no interest whatsoever in the ${command.noun}.`);
  }

  const [next] = applyEffects(module, state, [{ kind: 'moveItem', item: item.id, to: state.locationId }]);
  return acted(next, [
    {
      kind: 'text',
      text: `You set the ${command.noun} down in front of the ${nameOf(creature)}. It seems placated, and leaves you be — for now.`,
    },
  ]);
};

export const COMBAT_HANDLERS: Record<string, ActionHandler> = {
  attack: attackHandler,
  throw: throwHandler,
  give: giveHandler,
};
