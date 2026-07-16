import type { AdventureModule } from '../schema';
import type { GameState, OutputEvent } from '../types';
import type { Command } from '../parser/parse';
import { MOVEMENT_HANDLERS } from './movement';
import { SENSES_HANDLERS } from './senses';
import { META_HANDLERS } from './meta';

/**
 * What an action handler returns.
 *
 * `consumesTurn` is the important field. A turn is the unit the world ticks
 * on — fuel burns, creatures move, the thief counts down — so a handler that
 * refuses ("you can't take that") must say so and NOT charge the player a turn
 * for the privilege. The classic games are strict about this and it is the
 * difference between a forgiving parser and a punishing one.
 */
export interface ActionResult {
  state: GameState;
  events: OutputEvent[];
  consumesTurn: boolean;
}

export type ActionHandler = (
  module: AdventureModule,
  state: GameState,
  command: Command,
) => ActionResult;

/** Convenience for the common "say something, no turn spent" refusal. */
export function refuse(state: GameState, text: string): ActionResult {
  return { state, events: [{ kind: 'text', text }], consumesTurn: false };
}

/** Convenience for "did the thing, turn spent". */
export function acted(state: GameState, events: OutputEvent[]): ActionResult {
  return { state, events, consumesTurn: true };
}

/**
 * The dispatch table: verb id → handler.
 *
 * T15 registers movement/senses/meta; T16–T17 add the rest. A verb with no
 * entry here falls through to engine.ts's stub, which nudges rather than
 * throwing — a half-built engine should still be playable enough to test the
 * pipeline around it.
 *
 * This file and `movement.ts`/`senses.ts`/`meta.ts` import each other
 * (they need `ActionHandler`/`refuse`/`acted` from here; this file needs
 * their handler maps to populate `HANDLERS`). That's a deliberate cycle, not
 * an accident: `refuse`/`acted` are `function` declarations, which are fully
 * hoisted and initialized the instant this module starts evaluating — before
 * the imports below even run — so the other files always see live bindings,
 * never a temporal-dead-zone `undefined`. See eslint.config.js: there is no
 * `import/no-cycle` rule guarding against this pattern.
 */
export const HANDLERS: Partial<Record<string, ActionHandler>> = {
  ...MOVEMENT_HANDLERS,
  ...SENSES_HANDLERS,
  ...META_HANDLERS,
};

export function handlerFor(verb: string): ActionHandler | undefined {
  return HANDLERS[verb];
}
