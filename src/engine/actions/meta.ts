import { carriedItems } from '../state';
import { acted, refuse, type ActionHandler } from './index';

// inventory / score / wait / verbose / brief / help
// (foundation-implementation-plan.md T15).
//
// Turn consumption is the interesting decision in this file, and it splits
// the six verbs cleanly in two:
//
//   FREE (no turn): `inventory`, `score`, `verbose`, `brief`, `help`. Every
//   one of these is the player checking something about themselves or their
//   client, not acting on the world — checking your pockets, asking your
//   score, or changing how much text you're shown costs nothing in every
//   classic adventure game, and it matters here specifically because the
//   lamp burns per consumed turn (T18): a "free" action that quietly billed a
//   turn would burn fuel for looking at your own inventory.
//
//   COSTS A TURN: `wait`. It exists FOR the world tick — "let a turn pass and
//   see what happens" is the entire verb. A wait that consumed no turn would
//   not be `wait`, it would be a no-op.
//
// `again` is deliberately absent — engine.ts's dispatch already resolves it
// before a Command ever reaches the handler table (T14); adding a handler for
// verb id `again` here would be dead code shadowing a case that can't occur.

/**
 * Lists carried items by their canonical name (`names[0]`, per item.ts), NOT
 * by `brief`. `brief` is documented in the schema as "one line shown when the
 * item is listed **in a room**", and it is written to be exactly that — an
 * in-situ sentence in the narrator's voice ("A brass lamp sits on the shelf,
 * waiting to be useful."). Read out of an inventory it describes furniture you
 * are somehow holding: "You are carrying: A brass lamp sits on the shelf,
 * waiting to be useful. A flask of lamp oil leans in the corner."
 *
 * Sibling of the `look` fix in senses.ts: `brief` is the adventure's prose for
 * one specific situation, and the engine's job is to use it there and nowhere
 * else.
 */
export const inventoryHandler: ActionHandler = (module, state) => {
  const items = carriedItems(module, state);
  if (items.length === 0) {
    return refuse(state, 'You are empty-handed.');
  }
  // `names` is `.min(1)` in the schema, so a first element always exists —
  // `?? item.id` satisfies noUncheckedIndexedAccess without a `!`, and degrades
  // to something legible rather than "undefined" if that ever changes.
  const names = items.map((item) => item.names[0] ?? item.id);
  return refuse(state, `You are carrying: ${names.join(', ')}.`);
};

export const scoreHandler: ActionHandler = (module, state) => {
  return refuse(state, `Your score is ${state.score} out of ${module.manifest.maxScore} points.`);
};

export const waitHandler: ActionHandler = (module, state) => {
  return acted(state, [{ kind: 'text', text: 'Time passes.' }]);
};

/**
 * `verbose`/`brief` toggle `state.verbose` directly rather than through an
 * Effect — the second of the two honest exceptions this task calls out
 * (movement.ts's use of the `teleport` effect is the first). The frozen
 * Effect union (effects.ts) has no variant for a client-side rendering
 * preference, and it shouldn't grow one: no adventure's content would ever
 * need to set it, so there is nothing here for an author to author. Adding a
 * variant to express "toggle a field no event will ever touch" would be a
 * schema version bump paid for a rule with zero content-authoring use.
 */
export const verboseHandler: ActionHandler = (module, state) => {
  return refuse({ ...state, verbose: true }, 'Verbose mode: full descriptions every time now.');
};

export const briefHandler: ActionHandler = (module, state) => {
  return refuse({ ...state, verbose: false }, 'Brief mode: short descriptions on locations you have seen.');
};

/**
 * FR-1.9: magic words are never surfaced in the UI, including here. This text
 * names verbs and shortcuts only — nothing that would tip a player off that a
 * word like `zeeble` exists, let alone what it is.
 */
export const helpHandler: ActionHandler = (module, state) => {
  const text = [
    'This is a text adventure. Type what you want to do, e.g. `go north`, `take lamp`, `open door`.',
    'Bare directions work too: n, s, e, w, ne, nw, se, sw, up, down, in, out.',
    'Useful verbs: look (l), examine (x), take, drop, open, close, read, search, inventory (i), wait (z), again (g).',
    'Type `verbose` for full descriptions every time, or `brief` to go back to short ones on places you have seen.',
  ].join(' ');
  return refuse(state, text);
};

export const META_HANDLERS: Record<string, ActionHandler> = {
  inventory: inventoryHandler,
  score: scoreHandler,
  wait: waitHandler,
  verbose: verboseHandler,
  brief: briefHandler,
  help: helpHandler,
};
