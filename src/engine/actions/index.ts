import type { AdventureModule } from '../schema';
import type { GameState, OutputEvent } from '../types';
import type { Command } from '../parser/parse';

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
 * T15–T17 fill this in. Until then every verb falls through to the stub below,
 * which nudges rather than throwing — a half-built engine should still be
 * playable enough to test the pipeline around it.
 */
export const HANDLERS: Partial<Record<string, ActionHandler>> = {};

export function handlerFor(verb: string): ActionHandler | undefined {
  return HANDLERS[verb];
}
