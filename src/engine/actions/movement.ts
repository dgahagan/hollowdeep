import type { AdventureModule, Direction, Exit, Location } from '../schema';
import type { GameState } from '../types';
import { canSee, currentLocation, findLocation, hasVisited } from '../state';
import { applyEffects, evalConditions, fireTriggers } from '../systems/events';
import { acted, refuse, type ActionHandler, type ActionResult } from './index';

// go / enter / exit / back (design plan §5.1, foundation-implementation-plan.md T15).
//
// Two rules drive every handler here:
//
//   1. **Movement goes through the `teleport` effect** (systems/events.ts), not
//      a direct `setItemLocation`-style write. That is the one honest
//      exception to "handlers emit Effect[]" the task calls out explicitly:
//      there is no OTHER way to move the player, so routing through the
//      existing effect is the correct choice, not a shortcut around one.
//      Going through `applyEffects` means `enter` triggers fire and
//      `markVisited` runs on the exact same path every other mover uses
//      (magic words, death reincarnation, `back`).
//
//   2. **`hidden` and `if` are independent.** `hidden` only controls whether an
//      exit is DESCRIBED (that's T22's `describeScene`, not built yet); it has
//      no bearing on whether the exit can be WALKED. Looking the direction up
//      directly in `location.exits[direction]` — never checking
//      `isExitRevealed` — is what makes a guessed hidden exit work, which is
//      the classic behaviour this engine is reproducing on purpose.

const DIRECTION_LABELS: Record<Direction, string> = {
  n: 'north',
  s: 'south',
  e: 'east',
  w: 'west',
  ne: 'northeast',
  nw: 'northwest',
  se: 'southeast',
  sw: 'southwest',
  up: 'up',
  down: 'down',
  in: 'in',
  out: 'out',
};

/** Engine invariant: T5 proves every exit `to` resolves before a game can start. */
function locationOrThrow(module: AdventureModule, id: string): Location {
  const location = findLocation(module, id);
  if (location === undefined) {
    throw new Error(`engine invariant: no location "${id}"`);
  }
  return location;
}

function darknessWarning(module: AdventureModule): string {
  return module.strings[module.manifest.darkness.warningMessageId] ?? 'It is pitch dark.';
}

/**
 * Every defined exit at a location, typed by direction — a small workaround
 * for the fact that `Object.entries` on a `Partial<Record<Direction, Exit>>`
 * would widen the key back to `string` (and `noUncheckedIndexedAccess` still
 * wants the value narrowed). Iterating the fixed `Direction` domain instead
 * keeps both typed without a cast.
 */
function exitEntries(location: Location): Array<[Direction, Exit]> {
  const entries: Array<[Direction, Exit]> = [];
  for (const dir of Object.keys(DIRECTION_LABELS) as Direction[]) {
    const exit = location.exits[dir];
    if (exit !== undefined) entries.push([dir, exit]);
  }
  return entries;
}

/**
 * What to print after arriving somewhere: full on first visit or in verbose
 * mode, brief on a revisit — UNLESS the player can't see, in which case
 * neither: only the darkness warning, so a dark room's contents are never
 * described sight-unseen. `wasVisited` must be captured BEFORE the move (the
 * teleport effect marks the destination visited as a side effect of arriving,
 * so checking after would always say "not first visit").
 *
 * This is what lets "walk into the dark" work at all (movement is never
 * gated on light — that's T18's danger system, not this file's) while still
 * not leaking a dark room's description, matching the same spoiler rule
 * `look` follows.
 */
function moveDescription(
  module: AdventureModule,
  state: GameState,
  locationId: string,
  wasVisited: boolean,
): string {
  if (!canSee(module, state)) return darknessWarning(module);
  const location = locationOrThrow(module, locationId);
  return wasVisited && !state.verbose ? location.brief : location.full;
}

/**
 * The one mover every other handler in this file funnels through. Always a
 * consumed turn — arriving somewhere is always an action, even when what you
 * find there is a warning that you can't see.
 */
function moveTo(module: AdventureModule, state: GameState, destinationId: string): ActionResult {
  const wasVisited = hasVisited(state, destinationId);
  // `teleport`'s effect events are always empty (see systems/events.ts) — the
  // narration here is the move's own description, not effect output.
  const [afterMove] = applyEffects(module, state, [{ kind: 'teleport', to: destinationId }]);
  const [afterEnter, enterEvents] = fireTriggers(module, afterMove, {
    type: 'enter',
    target: destinationId,
  });
  const text = moveDescription(module, afterEnter, destinationId, wasVisited);
  return acted(afterEnter, [{ kind: 'text', text }, ...enterEvents]);
}

/** Check the exit's `if` (blocked ⇒ no turn, `blockedMessage` or a generic refusal), then move. */
function traverse(module: AdventureModule, state: GameState, exit: Exit): ActionResult {
  const [passed, afterCond] = evalConditions(module, state, exit.if);
  if (!passed) {
    // Blocked movement consumes no turn — RNG may still have advanced if the
    // guard drew a `chance`, and that's correct: the draw happened, the turn
    // didn't.
    return refuse(afterCond, exit.blockedMessage ?? "Something stops you from going that way.");
  }
  return moveTo(module, afterCond, exit.to);
}

function moveInDirection(module: AdventureModule, state: GameState, direction: Direction): ActionResult {
  const location = currentLocation(module, state);
  const exit = location.exits[direction];
  if (exit === undefined) {
    return refuse(state, `You can't go ${DIRECTION_LABELS[direction]} from here.`);
  }
  return traverse(module, state, exit);
}

export const goHandler: ActionHandler = (module, state, command) => {
  if (command.kind !== 'go') {
    // The parser only ever produces a `go` Command for the `go` verb — a bare
    // direction word or `go <direction>` both resolve to it before dispatch
    // (parser/parse.ts). This branch is unreachable in practice; the handler
    // signature takes the general `Command`, so narrow honestly instead of
    // asserting.
    return refuse(state, 'Go where?');
  }
  return moveInDirection(module, state, command.direction);
};

/**
 * `enter`/`exit` bare (V) are direction shortcuts: `in`/`out` respectively.
 * With a noun (`enter shed`, `exit door`) the parser has already resolved the
 * noun to a `Target` — and a `Target` is only ever an item, a creature, or
 * scenery (`resolveScope`, parser/parse.ts). Scope never includes location
 * names, and nothing in the schema connects an item to "the location it leads
 * into" (Item has no such field). Guessing that connection from item/exit
 * NAMES (e.g. "the grate" → the cave-mouth's `down` exit) would be exactly
 * the kind of undocumented, unverifiable magic the frozen effect vocabulary
 * elsewhere in this engine exists to avoid — there is no data to be right or
 * wrong about, only a guess. So a noun here is refused, plainly, rather than
 * pretending a heuristic is content-driven behaviour.
 */
export const enterHandler: ActionHandler = (module, state, command) => {
  if (command.kind === 'verb-noun') {
    return refuse(state, "You can't enter that. Try a direction instead.");
  }
  return moveInDirection(module, state, 'in');
};

export const exitHandler: ActionHandler = (module, state, command) => {
  if (command.kind === 'verb-noun') {
    return refuse(state, "You can't exit that. Try `out` or a direction.");
  }
  return moveInDirection(module, state, 'out');
};

/**
 * Return to `state.previousLocationId`.
 *
 * `back` deliberately does NOT re-walk a specific exit — it isn't retracing
 * "the exit you used", it's returning to "where you were", so it skips the
 * exits table's `if`/`blockedMessage` machinery entirely and goes straight to
 * `moveTo`. That is what lets `back` work after a magic-word teleport or a
 * death reincarnation, neither of which used an exit at all.
 *
 * The one exception is `oneWay: true`. Design-plan-explicit intent: a oneWay
 * exit is the author saying "there is no reverse". Honouring everything else
 * about `back` while silently ignoring that one signal would make `oneWay`
 * pointless content metadata — a player could always just type `back` to
 * reverse a one-way drop (test-cave's twisty-2 → low-passage chute exists
 * specifically to be irreversible), and the map design depending on that
 * would not hold. So: if an exit from `previousLocationId` to here is on
 * record and marked `oneWay`, `back` refuses. If no such exit is on record at
 * all — teleport, death — there is no promise to break, so `back` is allowed;
 * `previousLocationId` is simply where the player was.
 */
export const backHandler: ActionHandler = (module, state) => {
  const dest = state.previousLocationId;
  if (dest === state.locationId) {
    return refuse(state, "You haven't been anywhere else yet.");
  }

  const origin = findLocation(module, dest);
  const usedExit = origin === undefined
    ? undefined
    : exitEntries(origin).find(([, exit]) => exit.to === state.locationId)?.[1];
  if (usedExit?.oneWay === true) {
    return refuse(state, 'There is no going back that way.');
  }

  return moveTo(module, state, dest);
};

export const MOVEMENT_HANDLERS: Record<string, ActionHandler> = {
  go: goHandler,
  enter: enterHandler,
  exit: exitHandler,
  back: backHandler,
};
