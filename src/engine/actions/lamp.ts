import type { AdventureModule, Item } from '../schema';
import type { Target } from '../parser/parse';
import { findItem, getItemState, isCarrying, setItemState } from '../state';
import { applyEffects } from '../systems/events';
import { ITEM_NOWHERE, type GameState, type OutputEvent } from '../types';
import { acted, refuse, type ActionHandler } from './index';

// light / extinguish / refuel (foundation-implementation-plan.md T17).
//
// There is exactly one lamp per adventure, by construction — `manifest.lamp`
// (schema/manifest.ts) names it, and fuel/refuel config lives THERE rather
// than on the item, because `GameState.lampFuel` is a single number (design
// plan §5.2), not a per-item map. Every handler below is written against that:
// they resolve "the lamp" as `module.manifest.lamp.itemId`, not as "whatever
// item the player typed that happens to have `lightSource: true`". An
// adventure could in principle define a second `lightSource` item (a candle,
// say) with no fuel model at all — these verbs plainly refuse it rather than
// silently pretending it has fuel it does not.
//
// **Judgement call: all three verbs require the lamp to be CARRIED.** Nothing
// in the design plan states this explicitly, but `hasLight` (state.ts) already
// requires `isCarrying && lit` before a lamp does anything for the player, so
// a lamp lit while sitting on a shelf across the map could never help anyone
// see — lighting it there would be a pointless action dressed up as a real
// one. Requiring the player to be holding it before any of light/extinguish/
// refuel do anything keeps the three verbs consistent with what the state
// they mutate is actually FOR.
//
// **`lit` is engine-internal bookkeeping, written directly via
// `setItemState`, not through an Effect** — the same class of exception
// `handling.ts` documents for container `open`/`locked`. The frozen Effect
// union (effects.ts) has no variant for it, and nothing in the schema gives an
// event a way to test it either (no `Condition` field asks "is the lamp lit").
// That absence is structural: no adventure content ever reacts to lamp state
// as a *consequence* of something else — only the player's own light/
// extinguish commands and T18's fuel-exhaustion tick change it, and both are
// engine mechanics, not content authoring surface.
//
// **`lampFuel` is likewise a direct state write, for the same reason.** There
// is no Effect variant for adjusting fuel, and there should not be one: no
// event in any adventure sets or reads fuel directly (T18's darkness/burn
// system is the only other writer, and it is engine code, not content).

/** The lamp item, resolved once so every handler shares one source of truth. */
function theLamp(module: AdventureModule): Item {
  const lamp = findItem(module, module.manifest.lamp.itemId);
  if (lamp === undefined) {
    // T5 proves `manifest.lamp.itemId` resolves to a real item with
    // `lightSource: true` before a game can start — an unresolvable lamp here
    // is an engine invariant violation, not bad content (see
    // `locationOrThrow` in movement.ts for the same reasoning).
    throw new Error(`engine invariant: no lamp item "${module.manifest.lamp.itemId}"`);
  }
  return lamp;
}

/** The item a Target names, if any — creatures and scenery have no item behind them. */
function itemFor(module: AdventureModule, target: Target): Item | undefined {
  return target.kind === 'item' ? findItem(module, target.id) : undefined;
}

/** Is this Target the configured lamp, specifically — not just any light source? */
function isTheLamp(module: AdventureModule, target: Target): boolean {
  const item = itemFor(module, target);
  return item !== undefined && item.id === module.manifest.lamp.itemId;
}

export const lightHandler: ActionHandler = (module, state, command) => {
  if (command.kind !== 'verb-noun') {
    return refuse(state, 'Light what?');
  }
  if (!isTheLamp(module, command.target)) {
    return refuse(state, `You can't light the ${command.noun}.`);
  }

  const lamp = theLamp(module);
  if (!isCarrying(state, lamp.id)) {
    return refuse(state, "You aren't carrying that.");
  }
  if (getItemState(state, lamp.id).lit === true) {
    return refuse(state, "It's already lit.");
  }
  if (state.lampFuel <= 0) {
    return refuse(state, 'The lamp is bone dry. Lighting it now would just be a gesture.');
  }

  const lit = setItemState(state, lamp.id, { lit: true });
  return acted(lit, [
    { kind: 'text', text: 'You light the lamp. It catches at once, throwing a wobbly gold circle over everything nearby.' },
  ]);
};

export const extinguishHandler: ActionHandler = (module, state, command) => {
  if (command.kind !== 'verb-noun') {
    return refuse(state, 'Extinguish what?');
  }
  if (!isTheLamp(module, command.target)) {
    return refuse(state, `You can't extinguish the ${command.noun}.`);
  }

  const lamp = theLamp(module);
  if (!isCarrying(state, lamp.id)) {
    return refuse(state, "You aren't carrying that.");
  }
  if (getItemState(state, lamp.id).lit !== true) {
    return refuse(state, "It isn't lit.");
  }

  const doused = setItemState(state, lamp.id, { lit: false });
  return acted(doused, [
    { kind: 'text', text: 'You put the lamp out. The dark closes back in, patient as ever.' },
  ]);
};

/**
 * `refuel` (bare `V`) or `refuel lamp` (`VN`) — both name the same lamp, since
 * there is only one. There is no `refuel lamp with flask` (`VNPN`): the
 * refuel source is `manifest.lamp.refuel.itemId`, a property of the
 * adventure's lamp, not something the player chooses per use — `refuel` has
 * no `VNPN` pattern in `parser/vocab.ts`, so that shape can never even reach
 * this handler.
 */
export const refuelHandler: ActionHandler = (module, state, command) => {
  if (command.kind === 'verb-noun' && !isTheLamp(module, command.target)) {
    return refuse(state, `You can't refuel the ${command.noun}.`);
  }
  if (command.kind !== 'verb' && command.kind !== 'verb-noun') {
    return refuse(state, 'Refuel what?');
  }

  const lamp = theLamp(module);
  if (!isCarrying(state, lamp.id)) {
    return refuse(state, "You aren't carrying that.");
  }

  const refuel = module.manifest.lamp.refuel;
  if (refuel === undefined) {
    return refuse(state, "There's nothing here that would refuel it.");
  }

  const source = findItem(module, refuel.itemId);
  const sourceName = source?.names[0] ?? refuel.itemId;
  if (!isCarrying(state, refuel.itemId)) {
    return refuse(state, `You don't have anything to refuel it with. Perhaps a ${sourceName}?`);
  }

  let next: GameState = { ...state, lampFuel: state.lampFuel + refuel.amount };
  const events: OutputEvent[] = [
    { kind: 'text', text: `You top the lamp up with ${sourceName}. It should burn a good while longer now.` },
  ];
  if (refuel.consumesItem) {
    const [afterMove] = applyEffects(module, next, [{ kind: 'moveItem', item: refuel.itemId, to: ITEM_NOWHERE }]);
    next = afterMove;
  }

  return acted(next, events);
};

export const LAMP_HANDLERS: Record<string, ActionHandler> = {
  light: lightHandler,
  extinguish: extinguishHandler,
  refuel: refuelHandler,
};
