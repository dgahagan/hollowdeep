import type { AdventureModule } from '../schema';
import type { GameState, OutputEvent } from '../types';
import { canSee, getItemState, isFlagSet, setItemState } from '../state';
import { rollChance } from '../rng';
import { applyEffects, DIED_THIS_TURN } from './events';

// Fuel burn, lamp warnings, fuel exhaustion, and darkness danger (design plan
// §5.3 step 4, §4.1's `manifest.lamp`/`manifest.darkness`, FR-1.4;
// foundation-implementation-plan.md T18).
//
// This is the `light` stage of `worldTick`'s FIXED order (engine.ts):
// **events → creatures → light → scoring**. Do not reorder anything around
// it — see rng.ts and systems/events.ts for why order is a public contract
// the moment a seeded test picks a seed.
//
// FOUR THINGS HAPPEN HERE, IN THIS ORDER, and the order matters because step
// 4 is the only one that draws RNG — everything before it is free to run
// first without perturbing a seeded test:
//
//   1. **Burn fuel** — no RNG. The lamp burns while it is LIT, full stop,
//      independent of whether it is being carried. This mirrors T17's own
//      reasoning (actions/lamp.ts): a lit lamp left behind is "an odd state,
//      but a real one" that `extinguish` already has to handle, and a real
//      flame does not pause consuming oil just because nobody is holding it.
//      `hasLight` (state.ts) asks the narrower question of whether the
//      PLAYER benefits (carried AND lit) — this stage asks a different
//      question of the same field, the same class of mistake T17's execution
//      note warns `wardOff` readers about.
//
//   2. **Fuel exhaustion** — no RNG. If burning drove fuel to exactly 0 while
//      lit, the lamp goes out on its own, written directly via
//      `setItemState` — the same direct-write exception `lamp.ts` documents
//      for `lit`/`lampFuel` (no Effect variant exists for either, and no
//      adventure's content ever needs to react to raw fuel state). Only after
//      this can `hasLight` legitimately go false as a *consequence* of fuel
//      running out, since `hasLight` itself never looks at `lampFuel`.
//
//   3. **Fuel warnings** — no RNG. Every `manifest.lamp.warnAt` threshold the
//      new fuel level has reached, and has not already warned for, fires
//      once — tracked in `GameState.lampWarned` (T11), so a threshold can
//      never re-fire once crossed.
//
//      *Judgement call, flagged for review*: `manifest.lamp` has no
//      string-table id for this message the way `manifest.darkness` has
//      `warningMessageId`/`deathMessageId` (see schema/manifest.ts —
//      `zLampConfig` carries `itemId`/`startFuel`/`warnAt`/`refuel` and
//      nothing else). Rather than invent an id convention content never
//      declares (which `lookupString`'s `[missing string: …]` fallback would
//      surface as visible breakage the moment an adventure's strings.json
//      does not happen to define it), this prints a plain, dry, mechanical
//      status line — the same register as the engine's own hardcoded
//      `score`/`achievement` notices in systems/events.ts, neither of which
//      comes from strings.json either, because both are universal engine
//      bookkeeping rather than the adventure's narrative voice. A real
//      adventure wanting flavourful fuel-warning prose needs a schema
//      addition (a `manifest.lamp.warnMessageId`, most likely); that is a
//      schema-file change outside this task's lane, so it is reported rather
//      than made here.
//
//   4. **Darkness danger** — THE draw. Only when the player cannot see
//      (`state.ts#canSee`: a `dark` location and no carried, lit light
//      source). `manifest.darkness.warningMessageId` is deliberately NOT
//      re-printed here: every action that could leave the player in the dark
//      without telling them already shows it directly — `moveDescription` in
//      actions/movement.ts and `lookHandler` in actions/senses.ts both do —
//      so reprinting it unconditionally on every subsequent turn (including
//      a bare `wait`, which never checks `canSee` at all) would either double
//      it the instant the player arrives, or read as the engine narrating at
//      them for no reason. This stage's only job is the risk itself:
//      `manifest.darkness.deathChance`, drawn from the seeded RNG. A hit goes
//      through the frozen `die` Effect (systems/events.ts) exactly like every
//      other death in the engine — it only sets `DIED_THIS_TURN` and prints
//      `deathMessageId`; the turn pipeline's `handleDeath` (engine.ts) is
//      solely responsible for the penalty, the item scatter, and the
//      reincarnation text, once per death, regardless of cause.
//
//      Skipped entirely if the player already died earlier THIS turn (a
//      `turnStart`/`verb` event fired before `light` in `worldTick`'s order —
//      test-cave's `jump` at `ledge` is exactly this shape, dispatched even
//      earlier, during action handling). `handleDeath` only ever pays the
//      score penalty once regardless (it reads a boolean flag, not a count),
//      so this guard is purely about not stacking a redundant second
//      "you have died" line onto the player's transcript for one turn.

/** The lamp item id, per `manifest.lamp` — see actions/lamp.ts for the same resolution. */
function lampId(module: AdventureModule): string {
  return module.manifest.lamp.itemId;
}

/** Is the configured lamp burning right now, regardless of who (if anyone) is holding it? */
function isLampLit(module: AdventureModule, state: GameState): boolean {
  return getItemState(state, lampId(module)).lit === true;
}

/**
 * Step 1 + step 2. Burns one turn of fuel off a lit lamp and, if that empties
 * it, forces it out.
 */
function burnFuel(module: AdventureModule, state: GameState): [GameState, OutputEvent[]] {
  if (!isLampLit(module, state)) return [state, []];

  const fuel = Math.max(0, state.lampFuel - 1);
  const burned: GameState = { ...state, lampFuel: fuel };
  if (fuel > 0) return [burned, []];

  // Exhausted: nothing left to burn. See the file header on why this writes
  // `lit` directly rather than through an Effect.
  const doused = setItemState(burned, lampId(module), { lit: false });
  return [doused, [{ kind: 'text', text: lampString(module, module.manifest.lamp.exhaustMessageId) }]];
}

/**
 * Lamp prose comes from the adventure's `strings.json`, never from this file.
 *
 * The engine has no business naming the light source: an adventure whose lamp
 * is a torch, a candle, or a phosphorescent mushroom would get "The lamp
 * gutters" out of any hardcoded line, which is the engine writing content and
 * a direct FR-6.1 violation (adding an adventure must need zero engine
 * changes). `manifest.darkness` has carried its two message ids all along;
 * `manifest.lamp` gaining `warnMessageId`/`exhaustMessageId` just makes the
 * two halves of the light system symmetric.
 *
 * The fallback is unreachable in a validated module — `checkConsistency`
 * rejects a lamp message id with no matching string — and exists only so a
 * hand-built test state cannot crash the tick.
 */
function lampString(module: AdventureModule, id: string): string {
  return module.strings[id] ?? '';
}

/**
 * Step 3. Every `warnAt` threshold newly reached (and not already warned for)
 * fires once, recorded in `lampWarned` so it can never re-fire.
 *
 * `threshold > 0` is excluded here on purpose: a `0` threshold is what fuel
 * exhaustion (step 2) already announces, so warning about it again would be
 * the same news twice in one turn.
 */
function fuelWarnings(module: AdventureModule, state: GameState): [GameState, OutputEvent[]] {
  // Sorted highest-first so that if one turn's burn ever crossed more than
  // one threshold at once (not reachable with a burn of 1/turn today, but the
  // loop does not assume that), the earliest-crossed warning reads first.
  const crossed = module.manifest.lamp.warnAt
    .filter((threshold) => threshold > 0 && state.lampFuel <= threshold && !state.lampWarned.includes(threshold))
    .sort((a, b) => b - a);
  if (crossed.length === 0) return [state, []];

  let current = state;
  const output: OutputEvent[] = [];
  for (const threshold of crossed) {
    current = { ...current, lampWarned: [...current.lampWarned, threshold] };
    output.push({ kind: 'text', text: lampString(module, module.manifest.lamp.warnMessageId) });
  }
  return [current, output];
}

/** Step 4. The one RNG draw in this system — see the file header. */
function darknessDanger(module: AdventureModule, state: GameState): [GameState, OutputEvent[]] {
  if (canSee(module, state)) return [state, []];
  if (isFlagSet(state, DIED_THIS_TURN)) return [state, []];

  const [hit, rng] = rollChance(state.rng, module.manifest.darkness.deathChance);
  const rolled: GameState = { ...state, rng };
  if (!hit) return [rolled, []];

  return applyEffects(module, rolled, [
    { kind: 'die', messageId: module.manifest.darkness.deathMessageId },
  ]);
}

/**
 * The `light` stage of `worldTick` (engine.ts). Runs on every consumed turn —
 * `worldTick` itself is only ever called when one was (design plan §5.3), so
 * there is no separate "was a turn consumed" check to make here.
 */
export function lightTick(module: AdventureModule, state: GameState): [GameState, OutputEvent[]] {
  let current = state;
  const output: OutputEvent[] = [];

  const [afterBurn, burnEvents] = burnFuel(module, current);
  current = afterBurn;
  output.push(...burnEvents);

  const [afterWarnings, warningEvents] = fuelWarnings(module, current);
  current = afterWarnings;
  output.push(...warningEvents);

  const [afterDanger, dangerEvents] = darknessDanger(module, current);
  current = afterDanger;
  output.push(...dangerEvents);

  return [current, output];
}
