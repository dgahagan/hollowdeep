import type { AdventureModule } from '../schema';
import type { GameState, OutputEvent } from '../types';
import type { Target } from '../parser/parse';
import { canSee, creaturesHere, currentLocation, findCreature, findItem, itemsAt, visibleContents } from '../state';
import { fireTriggers } from '../systems/events';
import { itemBrief, itemDescription, locationFull } from '../systems/descriptions';
import { acted, refuse, type ActionHandler } from './index';

// look / examine / read / search (foundation-implementation-plan.md T15).
//
// `look`, `examine`, `read`, and `search` all consume a turn (design plan
// §5.3): they are ordinary actions, not free bookkeeping — that's what
// separates them from `inventory`/`score` in meta.ts, which are genuinely
// free to check. Attempting to read or search costs the same lamp-minute as
// anything else, even when the answer turns out to be "nothing here".

function darknessWarning(module: AdventureModule): string {
  return module.strings[module.manifest.darkness.warningMessageId] ?? 'It is pitch dark.';
}

/**
 * `look` always shows the FULL description, regardless of `state.verbose` or
 * whether the location has been visited before — that is the whole point of
 * asking to look again. In the dark without light it shows only the darkness
 * warning and returns: no item list, no creature list, nothing that would
 * leak the room's contents to a player who cannot see them (a spoiler
 * boundary, same rule `describeScene` will apply in T22).
 */
/**
 * What is here, as transcript lines: each item's `brief`, each open
 * container's visible contents right after it, then each creature's
 * description. Shared by `look` and by arrival (movement.ts moveTo) so the
 * two can never disagree about what the player is told they can see — a
 * dropped item that only `look` would admit to is invisible in practice,
 * and in the maze a dropped item IS the navigation aid.
 *
 * Each `brief` is a complete sentence in the narrator's own voice ("An iron
 * key lies here."), so it is printed as its own line and never wrapped in
 * engine prose. Prefixing them with "You can see" produces "You can see An
 * iron key lies here." — the engine talking over the adventure, which is the
 * one thing the string table exists to prevent. An open container's contents
 * follow it for the same reason in the other direction: a lid standing open
 * with the inside unnarrated is the engine withholding what the player can
 * plainly see.
 *
 * Callers gate on `canSee` — this function assumes the player has light.
 */
export function roomContentsLines(module: AdventureModule, state: GameState): OutputEvent[] {
  const output: OutputEvent[] = [];
  for (const item of itemsAt(module, state, state.locationId)) {
    output.push({ kind: 'text', text: itemBrief(module, state, item) });
    for (const inner of visibleContents(module, state, item.id)) {
      output.push({ kind: 'text', text: itemBrief(module, state, inner) });
    }
  }
  for (const creature of creaturesHere(module, state)) {
    output.push({ kind: 'text', text: creature.description });
  }
  return output;
}

export const lookHandler: ActionHandler = (module, state) => {
  if (!canSee(module, state)) {
    return acted(state, [{ kind: 'text', text: darknessWarning(module) }]);
  }

  const location = currentLocation(module, state);
  return acted(state, [
    { kind: 'text', text: locationFull(module, state, location) },
    ...roomContentsLines(module, state),
  ]);
};

function describeTarget(module: AdventureModule, state: GameState, target: Target): string | undefined {
  if (target.kind === 'item') {
    const item = findItem(module, target.id);
    return item === undefined ? undefined : itemDescription(module, state, item);
  }
  if (target.kind === 'creature') return findCreature(module, target.id)?.description;
  return currentLocation(module, state).scenery?.[target.index]?.description;
}

/**
 * `examine` sets `state.itRefers` for an item target (FR-2.5) so a later
 * `it`/`them`/`that` can resolve. Writing it directly rather than through an
 * Effect is deliberate, not a shortcut: the frozen Effect union (effects.ts)
 * has no variant for it, and it wouldn't make sense as content-authorable
 * data if it did — no adventure author decides what the player's pronoun
 * points at, the engine does, purely as a parsing convenience. Same reasoning
 * as `verbose`/`brief` in meta.ts.
 */
export const examineHandler: ActionHandler = (module, state, command) => {
  if (command.kind !== 'verb-noun') {
    return refuse(state, 'Examine what?');
  }

  const description = describeTarget(module, state, command.target);
  if (description === undefined) {
    return refuse(state, 'You see nothing special about that.');
  }

  const next = command.target.kind === 'item' ? { ...state, itRefers: command.target.id } : state;
  const output: OutputEvent[] = [{ kind: 'text', text: description }];
  if (command.target.kind === 'item') {
    for (const inner of visibleContents(module, state, command.target.id)) {
      output.push({ kind: 'text', text: inner.brief });
    }
  }
  // Looking closely at something with art shows its painting (FR-4.1 finally
  // on screen) — but only when the player can see. Examining a carried item
  // in the dark is done by touch; emitting its art would draw what cannot be
  // seen, the same leak the dark scene panel exists to prevent.
  if (canSee(module, state)) {
    const subject =
      command.target.kind === 'item'
        ? findItem(module, command.target.id)
        : command.target.kind === 'creature'
          ? findCreature(module, command.target.id)
          : undefined;
    if (subject?.artId !== undefined) {
      output.push({ kind: 'inspect', text: subject.names[0] ?? subject.id, artId: subject.artId });
    }
  }
  return acted(next, output);
};

function readTextFor(module: AdventureModule, state: GameState, target: Target): string | undefined {
  if (target.kind === 'item') return findItem(module, target.id)?.readText;
  if (target.kind === 'scenery') return currentLocation(module, state).scenery?.[target.index]?.readText;
  return undefined; // creatures have no readText — nothing is written on a rat.
}

/**
 * `read` prints `readText` when the target has it, and fires the `read`
 * trigger — but only for item targets. The `read` trigger's `target` is
 * documented (schema/event.ts) as an item id; scenery has no id to fire one
 * with, so a scenery read is just the text, same as it would be with no
 * matching event at all.
 */
export const readHandler: ActionHandler = (module, state, command) => {
  if (command.kind !== 'verb-noun') {
    return refuse(state, 'Read what?');
  }

  const text = readTextFor(module, state, command.target);
  if (text === undefined) {
    return refuse(state, 'There is nothing written on it.');
  }

  if (command.target.kind === 'item') {
    const [next, events] = fireTriggers(module, state, { type: 'read', target: command.target.id });
    return acted(next, [{ kind: 'text', text }, ...events]);
  }
  return acted(state, [{ kind: 'text', text }]);
};

/**
 * `search` is purely a trigger fire — everything it can ever do (find a
 * hidden key, reveal a hidden exit) is content's business, expressed as a
 * `search` event. Non-item targets (creatures, scenery) have nothing to
 * search-trigger against — same reasoning as `read` — so they always fall
 * through to "nothing of interest", still on a consumed turn.
 */
export const searchHandler: ActionHandler = (module, state, command) => {
  if (command.kind !== 'verb-noun') {
    return refuse(state, 'Search what?');
  }
  if (command.target.kind !== 'item') {
    return acted(state, [{ kind: 'text', text: 'You find nothing of interest.' }]);
  }

  const [next, events] = fireTriggers(module, state, { type: 'search', target: command.target.id });
  if (events.length === 0) {
    // No authored search event — but searching an open container is still a
    // fair question with a plain answer: what's in it. "Nothing of interest"
    // on a box holding a treasure is the engine lying.
    const contents = visibleContents(module, state, command.target.id);
    if (contents.length > 0) {
      return acted(
        next,
        contents.map((inner): OutputEvent => ({ kind: 'text', text: inner.brief })),
      );
    }
    return acted(next, [{ kind: 'text', text: 'You find nothing of interest.' }]);
  }
  return acted(next, events);
};

export const SENSES_HANDLERS: Record<string, ActionHandler> = {
  look: lookHandler,
  examine: examineHandler,
  read: readHandler,
  search: searchHandler,
};
