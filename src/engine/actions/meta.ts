import { carriedItems } from '../state';
import { evalConditions, lookupString } from '../systems/events';
import { acted, refuse, type ActionHandler } from './index';

// inventory / score / wait / verbose / brief / help / hint
// (foundation-implementation-plan.md T15; `hint` added by hints-timers plan T4).
//
// Turn consumption is the interesting decision in this file, and it splits
// the seven verbs cleanly in two:
//
//   FREE (no turn): `inventory`, `score`, `verbose`, `brief`, `help`, `hint`.
//   Every one of these is the player checking something about themselves or
//   their client, not acting on the world — checking your pockets, asking
//   your score, or changing how much text you're shown costs nothing in every
//   classic adventure game, and it matters here specifically because the
//   lamp burns per consumed turn (T18): a "free" action that quietly billed a
//   turn would burn fuel for looking at your own inventory. `hint` joins this
//   side for a sharper reason than the others: hints exist for the stuck, and
//   asking for a nudge during a timed hazard (the gour flood, the bee swarm)
//   must not have the asking itself burn the very turns the hint was meant to
//   buy back. The penalty is the price the design plan wants paid (FR-7.2);
//   it is not paid twice by also draining the clock. Note the mechanical
//   subtlety `hintHandler` below shares with `verbose`/`brief`: a handler can
//   change state — score, `hintsUsed`, `hintsRevealed` — while still
//   returning `consumesTurn: false`.
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

/**
 * `hint` — reveal the next rung of the first available ladder (design plan
 * §5.2).
 *
 * Selection scans `module.hints.hints` in DOCUMENT ORDER: the active hint is
 * the first entry whose `when` holds (the standard OR/`all` grammar via
 * `evalConditions`) AND whose ladder still has an unrevealed rung
 * (`hintsRevealed[id] < ladder.length`). Document order is priority order —
 * author-controlled, no extra syntax.
 *
 * `when` may legally contain `chance`, so evaluation threads RNG state
 * through the scan exactly like every other `evalConditions` caller (the
 * hollowdeep rule against hint ladders drawing `chance` is content
 * discipline, not engine law) — including on a MISS: a `chance` that failed
 * still consumed a draw, and that has to survive into whichever path returns.
 *
 * On a hit: `hintsRevealed[id]` and `hintsUsed` both increment by one rung,
 * the score takes `scoring.hintPenalty` floored at 0 (`deathPenalty`'s exact
 * shape), and the rung is emitted as a `hint` OutputEvent — never `text`, so
 * Phase 3 can style it without parsing prose. On a miss: `noHintMessageId`
 * prints, unconditionally free — being told "no" is not a hint, so nothing
 * is counted or deducted.
 */
export const hintHandler: ActionHandler = (module, state) => {
  let current = state;

  for (const entry of module.hints.hints) {
    const [holds, next] = evalConditions(module, current, entry.when);
    current = next;

    const revealed = current.hintsRevealed[entry.id] ?? 0;
    if (!holds || revealed >= entry.ladder.length) continue;

    // `revealed < entry.ladder.length` just proved this index exists;
    // `?? ''` only satisfies noUncheckedIndexedAccess honestly and is never
    // actually taken given the guard above.
    const rungText = entry.ladder[revealed] ?? '';
    const rungNumber = revealed + 1;

    return {
      state: {
        ...current,
        hintsRevealed: { ...current.hintsRevealed, [entry.id]: rungNumber },
        hintsUsed: current.hintsUsed + 1,
        score: Math.max(0, current.score - module.scoring.hintPenalty),
      },
      events: [{ kind: 'hint', text: rungText, hintId: entry.id, rung: rungNumber }],
      consumesTurn: false,
    };
  }

  // Nothing available: print `noHintMessageId`, change nothing — §5.2's
  // "being told no is not a hint" (`current` carries any RNG advance from
  // `chance`s evaluated during the scan above).
  return refuse(current, lookupString(module, module.hints.noHintMessageId));
};

export const META_HANDLERS: Record<string, ActionHandler> = {
  inventory: inventoryHandler,
  score: scoreHandler,
  wait: waitHandler,
  verbose: verboseHandler,
  brief: briefHandler,
  help: helpHandler,
  hint: hintHandler,
};
