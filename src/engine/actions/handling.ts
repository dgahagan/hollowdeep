import type { AdventureModule, Container, Item } from '../schema';
import type { Target } from '../parser/parse';
import {
  carriedCount,
  findItem,
  getItemState,
  isCarrying,
  itemLocation,
  itemsIn,
  setItemState,
} from '../state';
import { ITEM_INVENTORY, type GameState } from '../types';
import { applyEffects, fireTriggers } from '../systems/events';
import { acted, refuse, type ActionHandler } from './index';

// take / drop / put-in / open / close / lock / unlock / use
// (foundation-implementation-plan.md T16, plus the SCOPE ADDITION covering
// `use` — see the note on `useHandler` below).
//
// Two things recur across every handler here and are worth stating once:
//
//   1. **Item relocation always goes through the `moveItem` effect**
//      (systems/events.ts), never a direct `setItemLocation` write — same
//      rule movement.ts follows for the player's own position. `take`/`drop`/
//      `put` are exactly the handlers that make item location observable to
//      content (a `take`/`drop` trigger can react to where something ends up),
//      so this is the ordinary case the choke point exists for, not an
//      exception to it.
//
//   2. **Container `open`/`locked` are NOT effect-authorable, on purpose.**
//      The frozen Effect union (effects.ts) has no variant for them, and
//      `Condition` (conditions.ts) has no field to test them either — no
//      event could gate on "is this open" even if an effect existed to set
//      it. That absence is structural, not an oversight: unlike item
//      location, no content in this format ever needs to open a container as
//      a *consequence* of something else (test-cave's grate and box are both
//      opened by the player's own `open`/`unlock` commands, never by an
//      event's `do`). So these fields are engine-internal bookkeeping,
//      written directly with `setItemState` — the same honest exception
//      `examineHandler`'s `itRefers` write (senses.ts) and `verbose`/`brief`
//      (meta.ts) already are. Content still gets to react to the *action*:
//      `open`/`use` are trigger types, so `grate-opened` and `oil-the-door`
//      fire from these handlers exactly like any other trigger.

type ContainerItem = Item & { container: Container };

function isContainerItem(item: Item): item is ContainerItem {
  return item.container !== undefined;
}

/** The item a Target names, if any — creatures and scenery have no item behind them. */
function itemFor(module: AdventureModule, target: Target): Item | undefined {
  return target.kind === 'item' ? findItem(module, target.id) : undefined;
}

/** The item a Target names, if it is a container — used by open/close/put/lock/unlock. */
function containerFor(module: AdventureModule, target: Target): ContainerItem | undefined {
  const item = itemFor(module, target);
  return item !== undefined && isContainerItem(item) ? item : undefined;
}

/**
 * Would putting `itemId` into `containerId` nest `itemId` inside itself —
 * directly (they're the same item, `put box in box`) or transitively
 * (`containerId` is already somewhere inside `itemId`'s own contents, e.g.
 * `put sack in bag` when `bag` is already inside `sack`)?
 *
 * Both destroy the item irrecoverably: `moveItem` would set the item's
 * location to a container that is the item itself, or to a container that
 * (through the chain) IS the item's own location — either way the result is
 * unreachable from any location or inventory, and nothing nested inside it
 * can ever be reached again either. This is a real bug this task's own
 * containers cannot surface (both are fixed in place), but nothing in the
 * schema forbids a portable container, and Hollowdeep will have one.
 *
 * Walks UP from `containerId` through whatever currently holds it. The walk
 * ends the moment it leaves item-space — a location id, `inventory`, or
 * `nowhere` are none of them containers, so `findItem` returning undefined
 * for the current holder is the "definitely not nested in anything" case.
 * `visited` bounds the walk so a cycle already sitting in state (which this
 * check exists to prevent, but cannot itself fully guarantee never occurs)
 * can never hang it.
 */
function wouldNestInsideItself(
  module: AdventureModule,
  state: GameState,
  itemId: string,
  containerId: string,
): boolean {
  if (containerId === itemId) return true;

  const visited = new Set<string>();
  let current = containerId;
  while (!visited.has(current)) {
    visited.add(current);
    const holder = itemLocation(state, current);
    if (holder === itemId) return true;
    if (findItem(module, holder) === undefined) return false; // a location, inventory, or nowhere — chain ends
    current = holder;
  }
  return false; // already-cyclic state elsewhere; not this command's problem to untangle
}

/**
 * `take` (FR-1.2: carry limits, `portable` enforcement).
 *
 * Refusal order matters for the message the player sees, so it is deliberate:
 * "not a thing" before "can't carry it" before "already have it" before "hands
 * full" — each check assumes everything above it has already passed.
 */
export const takeHandler: ActionHandler = (module, state, command) => {
  if (command.kind !== 'verb-noun') {
    return refuse(state, 'Take what?');
  }

  const item = itemFor(module, command.target);
  if (item === undefined) {
    // Scenery and creatures both resolve to a real Target but neither is a
    // takeable Item — same "no data to be right or wrong about" reasoning
    // movement.ts's `enter <item>` refusal documents.
    return refuse(state, "You can't take that.");
  }

  if (!item.portable) {
    // A nudge, not an error (T16 acceptance criterion): the item is a
    // perfectly good `Target`, the parser did its job, and the player just
    // asked for something the world plainly won't allow. `refuse` — not a
    // thrown error — is exactly what makes that a nudge instead of a bug.
    return refuse(state, `The ${command.noun} isn't going anywhere, and neither is it going with you.`);
  }
  if (isCarrying(state, item.id)) {
    return refuse(state, 'You already have that.');
  }
  if (carriedCount(module, state) >= module.manifest.carryLimit) {
    return refuse(state, "Your hands are full. You'll need to drop something first.");
  }

  const [afterMove] = applyEffects(module, state, [
    { kind: 'moveItem', item: item.id, to: ITEM_INVENTORY },
  ]);
  const [afterTake, events] = fireTriggers(module, afterMove, { type: 'take', target: item.id });
  return acted(afterTake, [{ kind: 'text', text: 'Taken.' }, ...events]);
};

/** `drop`. Only ever legal for something you are actually carrying. */
export const dropHandler: ActionHandler = (module, state, command) => {
  if (command.kind !== 'verb-noun') {
    return refuse(state, 'Drop what?');
  }

  const item = itemFor(module, command.target);
  if (item === undefined || !isCarrying(state, item.id)) {
    // Scope can include things you can SEE but do not carry (an item on the
    // floor is in scope too) — that phrase is a real Target and a real Item,
    // just not one you can drop.
    return refuse(state, "You aren't carrying that.");
  }

  const [afterMove] = applyEffects(module, state, [
    { kind: 'moveItem', item: item.id, to: state.locationId },
  ]);
  const [afterDrop, events] = fireTriggers(module, afterMove, { type: 'drop', target: item.id });
  return acted(afterDrop, [{ kind: 'text', text: 'Dropped.' }, ...events]);
};

/**
 * `put <item> in <container>` (FR-1.10). No `put` trigger type exists in the
 * schema (event.ts's `zTrigger` enum) — unlike take/drop, nothing in
 * test-cave or the design plan needs content to react to a specific put, so
 * this handler is effect-only: move the item, say so, done.
 */
export const putHandler: ActionHandler = (module, state, command) => {
  if (command.kind !== 'verb-noun-prep-noun') {
    return refuse(state, 'Put what where?');
  }

  const item = itemFor(module, command.target);
  if (item === undefined || !isCarrying(state, item.id)) {
    return refuse(state, "You aren't carrying that.");
  }

  const container = containerFor(module, command.secondTarget);
  if (container === undefined) {
    return refuse(state, "You can't put anything in that.");
  }
  // Checked before open/capacity: a container that would swallow itself is
  // impossible regardless of whether it happens to have room, and refusing
  // it here means it never reaches `moveItem` at all. See
  // `wouldNestInsideItself` for why this is a real bug and not a schema
  // question — nothing here is new state, just a walk over what's already there.
  if (container.id === item.id) {
    return refuse(state, `Putting the ${command.noun} inside itself would be quite a trick.`);
  }
  if (wouldNestInsideItself(module, state, item.id, container.id)) {
    return refuse(
      state,
      `The ${command.secondNoun} is already inside the ${command.noun} — putting one in the other would just chase its own tail.`,
    );
  }
  if (getItemState(state, container.id).open !== true) {
    return refuse(state, `The ${command.secondNoun} is closed.`);
  }
  // Nesting "just works" here: capacity counts whatever is directly located
  // AT this container id, regardless of how deep the container itself sits
  // (parser scope already recurses through open containers — resolveScope in
  // parse.ts — so an item inside a container inside another open container
  // resolves and takes/puts the same way a top-level item does).
  if (itemsIn(module, state, container.id).length >= container.container.capacity) {
    return refuse(state, `There's no more room in the ${command.secondNoun}.`);
  }

  const [next] = applyEffects(module, state, [{ kind: 'moveItem', item: item.id, to: container.id }]);
  return acted(next, [{ kind: 'text', text: `You put the ${command.noun} in the ${command.secondNoun}.` }]);
};

/** `open` (FR-1.10). Fires the `open` trigger (event.ts) so content can react — test-cave's grate. */
export const openHandler: ActionHandler = (module, state, command) => {
  if (command.kind !== 'verb-noun') {
    return refuse(state, 'Open what?');
  }

  const container = containerFor(module, command.target);
  if (container === undefined) {
    return refuse(state, "You can't open that.");
  }

  const itemState = getItemState(state, container.id);
  if (itemState.open === true) {
    return refuse(state, "It's already open.");
  }
  if (itemState.locked === true) {
    return refuse(state, "It's locked.");
  }

  const opened = setItemState(state, container.id, { open: true });
  const [next, events] = fireTriggers(module, opened, { type: 'open', target: container.id });
  return acted(next, [{ kind: 'text', text: `You open the ${command.noun}.` }, ...events]);
};

/**
 * `close`. No `close` trigger type exists (event.ts's `zTrigger` enum has
 * `open` but not its opposite) — nothing in the design plan needed one, and
 * adding one would be new scope for this task, not a mechanical consequence
 * of it.
 */
export const closeHandler: ActionHandler = (module, state, command) => {
  if (command.kind !== 'verb-noun') {
    return refuse(state, 'Close what?');
  }

  const container = containerFor(module, command.target);
  if (container === undefined) {
    return refuse(state, "You can't close that.");
  }
  if (getItemState(state, container.id).open !== true) {
    return refuse(state, "It's already closed.");
  }

  const closed = setItemState(state, container.id, { open: false });
  return acted(closed, [{ kind: 'text', text: `You close the ${command.noun}.` }]);
};

/** The item named by a Target, if it is carried — shared by lock/unlock's "with <key>". */
function carriedKeyFor(module: AdventureModule, state: GameState, target: Target): Item | undefined {
  const item = itemFor(module, target);
  return item !== undefined && isCarrying(state, item.id) ? item : undefined;
}

/**
 * `lock <container> with <key>` (FR-1.10). Requires the container to be
 * closed first — locking something open would silently trap whatever you
 * just decided to leave sitting in full view, which is not what "lock" means
 * in any of the classic games this one is patterned after.
 */
export const lockHandler: ActionHandler = (module, state, command) => {
  if (command.kind !== 'verb-noun-prep-noun') {
    return refuse(state, 'Lock what with what?');
  }

  const container = containerFor(module, command.target);
  if (container === undefined || container.container.keyId === undefined) {
    return refuse(state, "You can't lock that.");
  }

  const key = carriedKeyFor(module, state, command.secondTarget);
  if (key === undefined) {
    return refuse(state, "You aren't carrying that.");
  }
  if (key.id !== container.container.keyId) {
    return refuse(state, `The ${command.secondNoun} doesn't fit.`);
  }

  const itemState = getItemState(state, container.id);
  if (itemState.locked === true) {
    return refuse(state, "It's already locked.");
  }
  if (itemState.open === true) {
    return refuse(state, `You'll need to close the ${command.noun} first.`);
  }

  const locked = setItemState(state, container.id, { locked: true });
  return acted(locked, [
    { kind: 'text', text: `You lock the ${command.noun} with the ${command.secondNoun}.` },
  ]);
};

/**
 * `unlock <container> with <key>` (FR-1.10). Unlocking does not also open —
 * that stays a separate `open`, matching test-cave's walkthrough
 * (`unlock grate with key` then `open grate` as two distinct steps).
 */
export const unlockHandler: ActionHandler = (module, state, command) => {
  if (command.kind !== 'verb-noun-prep-noun') {
    return refuse(state, 'Unlock what with what?');
  }

  const container = containerFor(module, command.target);
  if (container === undefined || container.container.keyId === undefined) {
    return refuse(state, "You can't unlock that.");
  }

  const key = carriedKeyFor(module, state, command.secondTarget);
  if (key === undefined) {
    return refuse(state, "You aren't carrying that.");
  }
  if (key.id !== container.container.keyId) {
    return refuse(state, `The ${command.secondNoun} doesn't fit.`);
  }

  const itemState = getItemState(state, container.id);
  if (itemState.locked !== true) {
    return refuse(state, "It's not locked.");
  }

  const unlocked = setItemState(state, container.id, { locked: false });
  return acted(unlocked, [
    { kind: 'text', text: `You unlock the ${command.noun} with the ${command.secondNoun}.` },
  ]);
};

/**
 * `use` (SCOPE ADDITION to T16 — see docs/foundation-implementation-plan.md's
 * orchestrator note on T16 and the T15 tracker entry it responds to). `use`
 * has no core mechanic of its own: it is a trigger fire and nothing else,
 * exactly like `search` in senses.ts. What `use <x>` or `use <x> with <y>`
 * actually DOES is entirely the adventure's business, expressed as a `use`
 * event — test-cave's `oil-the-door`/`door-already-oiled` pair fires on
 * `{type: 'use', target: 'rusted-door'}` regardless of which second noun (if
 * any) was used, because the trigger only ever names the first noun
 * (event.ts's documented shape: "target is an item id" for `use`, same as
 * take/drop/read/open/search).
 *
 * Turn consumption mirrors engine.ts's `dispatch` for an unhandled verb, not
 * `searchHandler`'s: an event responding is an action (turn spent); nothing
 * responding is the world having no answer, which costs nothing — the
 * opposite of `search`, where "nothing of interest" is itself the answer and
 * still costs a turn. `use` has no such fallback content to fall back on.
 */
export const useHandler: ActionHandler = (module, state, command) => {
  if (command.kind !== 'verb-noun' && command.kind !== 'verb-noun-prep-noun') {
    return refuse(state, 'Use what?');
  }
  if (command.target.kind !== 'item') {
    return refuse(state, 'Nothing happens.');
  }

  const [next, events] = fireTriggers(module, state, { type: 'use', target: command.target.id });
  if (events.length === 0) {
    // `next`, not `state`: a guard's `chance` draw may have advanced the RNG
    // even though nothing fired — the draw happened, the turn didn't. Same
    // reasoning as movement.ts's blocked-exit refusal.
    return refuse(next, 'Nothing happens.');
  }
  return acted(next, events);
};

export const HANDLING_HANDLERS: Record<string, ActionHandler> = {
  take: takeHandler,
  drop: dropHandler,
  put: putHandler,
  open: openHandler,
  close: closeHandler,
  lock: lockHandler,
  unlock: unlockHandler,
  use: useHandler,
};
