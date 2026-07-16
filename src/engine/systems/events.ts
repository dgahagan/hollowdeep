import type { AdventureModule, Condition, Effect, GameEvent } from '../schema';
import type { GameState, OutputEvent } from '../types';
import { rollChance } from '../rng';
import {
  addAchievement,
  clearFlag,
  findLocation,
  hasFired,
  hasVisited,
  isCarrying,
  isFlagSet,
  itemLocation,
  markFired,
  markVisited,
  setFlag,
  setItemLocation,
} from '../state';

// ─────────────────────────────────────────────────────────────────────────────
// THE SINGLE CHOKE POINT (design plan §5.3).
//
// **All** state mutation flows through `applyEffects`. Action handlers and
// event triggers emit the same `Effect` vocabulary, so there is exactly one
// place where "what an effect does" is decided and exactly one place to test
// it. A handler that writes state directly is a bug even if it works: it is
// the second implementation of a rule that is supposed to have one.
//
// ORDER IS THE CONTRACT. Two orderings here are observable through
// seeded tests, so they are specified rather than incidental:
//
//   1. **Effects apply in array order**, strictly sequentially, each seeing
//      the previous one's state. `[{moveItem}, {die}]` moves and then kills;
//      the reverse kills and then moves a corpse's pockets. Content relies on
//      this, so `do: [...]` is a program, not a set.
//
//   2. **Conditions evaluate left to right, and stop at the first hit.**
//      `evalConditions` ORs a list and SHORT-CIRCUITS — so a `chance` in the
//      second condition is not drawn if the first already passed. This is why
//      evaluation returns state: RNG consumed depends on where evaluation
//      stopped, and that has to be reproducible.
//
//   3. **Triggers fire in module array order, but every guard is evaluated
//      against the SAME SNAPSHOT** — the state as it was when the trigger
//      fired — and only then do the surviving events apply their effects, in
//      order. Guards decide together; effects happen in sequence.
//
//      This is not a detail. The obvious implementation (check each guard
//      against whatever the previous event just did) breaks three ordinary
//      authoring patterns, all of them in test-cave:
//
//        - `zeeble` teleports road→entry-hall, and then the ascend event,
//          seeing the player now standing in entry-hall, bounces them back.
//        - `search tree` reveals the key and sets `tree-searched`; the
//          "hollow is empty now" event then fires in the same turn.
//        - `oil door` sets `door-oiled`; "the hinges are already slick" then
//          fires in the same turn.
//
//      Each is a pair of mutually exclusive events that a snapshot keeps
//      exclusive. Under sequential guards an author would have to reason about
//      the order of every event sharing a trigger, which is exactly the kind of
//      spooky action data files must not have.
//
//      Effects still apply in order, so `win-clean` still awards before `win`
//      ends the game.
//
//   4. **A `setFlag` that turns a flag on cascades into `flagSet` triggers**,
//      which is what makes test-cave's `win` (on `flagSet both-deposited`)
//      reachable from `victory-on-idol` (which sets it). Only on the
//      transition to set, and only to a bounded depth — see the cascade note
//      further down.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate one condition. Fields AND together (design plan §4.1).
 *
 * Returns new state because `chance` draws from the seeded RNG — see rng.ts.
 * Cheap tests are ordered before `chance` deliberately: `chance` is the only
 * field that consumes RNG, so testing it last means a condition that fails on
 * a flag never perturbs the sequence.
 */
export function evalCondition(
  // Only used to recurse through `all` today: every leaf field is answerable
  // from state alone. The parameter stays because the design plan fixes this
  // signature and every caller already threads the module — dropping it would
  // mean changing the public shape back the first time a condition needs
  // content (a `treasure?` test, say).
  module: AdventureModule,
  state: GameState,
  cond: Condition,
): [boolean, GameState] {
  if (cond.flag !== undefined && !isFlagSet(state, cond.flag)) return [false, state];
  if (cond.notFlag !== undefined && isFlagSet(state, cond.notFlag)) return [false, state];
  if (cond.hasItem !== undefined && !isCarrying(state, cond.hasItem)) return [false, state];
  if (cond.atLocation !== undefined && state.locationId !== cond.atLocation) return [false, state];
  if (cond.visited !== undefined && !hasVisited(state, cond.visited)) return [false, state];
  if (cond.deathsAtMost !== undefined && state.deaths > cond.deathsAtMost) return [false, state];

  if (cond.itemAt !== undefined && itemLocation(state, cond.itemAt.item) !== cond.itemAt.location) {
    return [false, state];
  }

  if (cond.creatureAt !== undefined) {
    const creature = state.creatures[cond.creatureAt.creature];
    if (creature === undefined || creature.locationId !== cond.creatureAt.location) {
      return [false, state];
    }
  }

  // `all` ANDs its children (schema/conditions.ts). Evaluated BEFORE `chance`
  // so the "chance is drawn last, and only if everything else passed" rule
  // below still holds for the condition as a whole — a nested `chance` that
  // fails must not have cost the outer one a draw it never needed.
  //
  // State threads through the children because one of them may itself roll:
  // each child sees the RNG the previous child left, and the outer `chance`
  // below sees what `all` left. Short-circuits at the first false, so a
  // `chance` after a failed child does NOT draw — observable through seeded
  // tests, and the same rule `evalConditions` already applies to its OR.
  let current = state;
  if (cond.all !== undefined) {
    for (const sub of cond.all) {
      const [hit, next] = evalCondition(module, current, sub);
      current = next;
      if (!hit) return [false, current];
    }
  }

  // Last, and only if everything else passed — see the note above.
  if (cond.chance !== undefined) {
    const [hit, rng] = rollChance(current.rng, cond.chance);
    return [hit, { ...current, rng }];
  }

  return [true, current];
}

/**
 * Evaluate a condition list. A list ORs (design plan §4.1), short-circuiting
 * at the first pass. An absent or empty list is `true` — an unguarded effect
 * is unconditional.
 */
export function evalConditions(
  module: AdventureModule,
  state: GameState,
  conds: Condition[] | undefined,
): [boolean, GameState] {
  if (conds === undefined || conds.length === 0) return [true, state];

  let current = state;
  for (const cond of conds) {
    const [hit, next] = evalCondition(module, current, cond);
    current = next;
    if (hit) return [true, current];
  }
  return [false, current];
}

/** Resolve a `printId` against strings.json, loudly rather than silently. */
function lookupString(module: AdventureModule, id: string): string {
  // T5 proves every printId resolves before a game can start, so this is an
  // engine-visible bug rather than an author's. Surfacing the id beats
  // printing an empty line and moving on.
  return module.strings[id] ?? `[missing string: ${id}]`;
}

/**
 * Apply one effect. The exhaustive switch is deliberate: `effects.ts` freezes
 * the union at 12 variants, and a 13th lands here as a compile error rather
 * than a silent no-op.
 */
function applyEffect(
  module: AdventureModule,
  state: GameState,
  effect: Effect,
): [GameState, OutputEvent[]] {
  switch (effect.kind) {
    case 'print':
      return [state, [{ kind: 'text', text: effect.text }]];

    case 'printId':
      return [state, [{ kind: 'text', text: lookupString(module, effect.id) }]];

    case 'setFlag':
      return [setFlag(state, effect.flag, effect.value), []];

    case 'clearFlag':
      return [clearFlag(state, effect.flag), []];

    case 'moveItem':
      return [setItemLocation(state, effect.item, effect.to), []];

    case 'revealExit': {
      // Revealing is per-playthrough state, not a module edit: the module is
      // shared, immutable content and mutating it would leak one game's
      // discoveries into the next. So it is recorded as a flag the scene view
      // consults (see the key format below), which also means it saves for
      // free.
      return [setFlag(state, revealedExitFlag(effect.location, effect.dir), true), []];
    }

    case 'addScore': {
      const total = state.score + effect.points;
      return [
        { ...state, score: total },
        [
          {
            kind: 'score',
            text: effect.points >= 0 ? `You score ${effect.points}.` : `You lose ${-effect.points}.`,
            points: effect.points,
            total,
          },
        ],
      ];
    }

    case 'teleport': {
      const destination = findLocation(module, effect.to);
      if (destination === undefined) return [state, []];
      const moved = markVisited(
        { ...state, previousLocationId: state.locationId, locationId: effect.to },
        effect.to,
      );
      return [moved, []];
    }

    case 'die': {
      // The `die` effect only RECORDS the death and says so. Penalty,
      // scattering possessions, and reincarnation are the turn pipeline's job
      // (§5.3 step 5) — they have to happen once per death however it was
      // caused, and darkness and creature kills never come through here.
      const text =
        effect.messageId !== undefined ? lookupString(module, effect.messageId) : 'You have died.';
      return [setFlag(state, DIED_THIS_TURN, true), [{ kind: 'death', text }]];
    }

    case 'award': {
      if (state.achievements.includes(effect.achievement)) return [state, []];
      const achievement = module.achievements.find((a) => a.id === effect.achievement);
      const name = achievement?.name ?? effect.achievement;
      return [
        addAchievement(state, effect.achievement),
        [
          {
            kind: 'achievement',
            text: `Achievement unlocked: ${name}.`,
            achievementId: effect.achievement,
          },
        ],
      ];
    }

    case 'endGame':
      // Rank is filled in by the scoring system, which owns the rank table.
      return [{ ...state, ended: { victory: effect.victory, rank: '' } }, []];

    case 'activateCreature': {
      const existing = state.creatures[effect.creature];
      if (existing === undefined || existing.active) return [state, []];
      return [
        {
          ...state,
          creatures: {
            ...state.creatures,
            [effect.creature]: { ...existing, active: true, activatedTurn: state.turn },
          },
        },
        [],
      ];
    }

    default: {
      const exhaustive: never = effect;
      throw new Error(`applyEffects: unhandled effect ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Internal flag marking that the player died this turn. The pipeline (T14)
 * consumes and clears it.
 *
 * It lives in `flags` rather than as its own GameState field because it is
 * transient — it never survives the turn that set it, so it does not deserve
 * a slot in the shape that save migrations have to maintain forever. The `$`
 * prefix keeps it out of content's namespace: `zId` forbids `$`, so no
 * adventure can define a flag that collides with it.
 */
export const DIED_THIS_TURN = '$died';

/** Flag key recording that a hidden exit has been revealed (see `revealExit`). */
export function revealedExitFlag(locationId: string, dir: string): string {
  return `$revealed:${locationId}:${dir}`;
}

export function isExitRevealed(state: GameState, locationId: string, dir: string): boolean {
  return isFlagSet(state, revealedExitFlag(locationId, dir));
}

/**
 * How deep a `setFlag` → `flagSet` → `setFlag` chain may go.
 *
 * A cascade is a loop waiting to happen: two events that set each other's
 * flags would recur forever. `once` stops most of it and the
 * transition-only rule stops more, but neither is a guarantee content cannot
 * violate, and an engine that hangs on bad data is worse than one that stops.
 * Depth 8 is far past anything sane (test-cave's deepest chain is 2: a drop
 * sets `both-deposited`, which fires `win`).
 */
const MAX_CASCADE_DEPTH = 8;

/**
 * Apply effects in order, threading state through each (design plan §5.3).
 *
 * This is THE mutation path. Sequential by construction: each effect sees what
 * the previous one did.
 */
export function applyEffects(
  module: AdventureModule,
  state: GameState,
  effects: Effect[],
): [GameState, OutputEvent[]] {
  return applyEffectsAt(module, state, effects, 0);
}

function applyEffectsAt(
  module: AdventureModule,
  state: GameState,
  effects: Effect[],
  depth: number,
): [GameState, OutputEvent[]] {
  let current = state;
  const output: OutputEvent[] = [];

  for (const effect of effects) {
    // Captured before the effect: the cascade fires on the TRANSITION to set,
    // not on every write. `packrat-arms` re-sets its flag on every take, and
    // re-announcing that to `flagSet` listeners each time would be noise at
    // best and a loop at worst.
    const wasSet = effect.kind === 'setFlag' ? isFlagSet(current, effect.flag) : false;

    const [next, events] = applyEffect(module, current, effect);
    current = next;
    output.push(...events);

    if (effect.kind === 'setFlag' && !wasSet && isFlagSet(current, effect.flag)) {
      if (depth >= MAX_CASCADE_DEPTH) continue;
      const [after, cascaded] = fireTriggersAt(
        module,
        current,
        { type: 'flagSet', target: effect.flag },
        depth + 1,
      );
      current = after;
      output.push(...cascaded);
    }
  }

  return [current, output];
}

/** What fires a trigger. `target` means whatever the trigger type says it means. */
export interface TriggerMatch {
  type: GameEvent['on']['type'];
  /** Location id, item id, verb id, or flag id — see the schema's `zTrigger`. */
  target?: string;
  /** For `turnStart`. */
  turn?: number;
  /** For `word`. */
  word?: string;
}

function matches(event: GameEvent, trigger: TriggerMatch): boolean {
  const on = event.on;
  if (on.type !== trigger.type) return false;

  // An event with no `target` matches ANY subject of its type — `on: {type:
  // 'take'}` fires for every take. An event WITH a target matches only that
  // one. (test-cave leans on both: `packrat-arms` watches all takes;
  // `reveal-key` watches one tree.)
  if (on.target !== undefined && on.target !== trigger.target) return false;
  if (on.turn !== undefined && on.turn !== trigger.turn) return false;
  if (on.word !== undefined && on.word !== trigger.word) return false;

  return true;
}

/**
 * Fire every event matching a trigger (design plan §5.3).
 *
 * Two phases, and the split is the whole design (see rule 3 in the banner):
 *
 *   1. **Decide.** Walk the module's events in order and evaluate every
 *      matching event's guard against the same snapshot. Guard evaluation can
 *      consume RNG (`chance`), so state threads through this phase — but only
 *      the RNG changes, which is why the guards genuinely all see one world.
 *   2. **Apply.** The survivors run their effects in order, each seeing the
 *      last one's state.
 *
 * `once` is honoured via `firedEvents`, and marked only when an event actually
 * fires — an event whose guard failed has not fired and must stay armed.
 */
export function fireTriggers(
  module: AdventureModule,
  state: GameState,
  trigger: TriggerMatch,
): [GameState, OutputEvent[]] {
  return fireTriggersAt(module, state, trigger, 0);
}

function fireTriggersAt(
  module: AdventureModule,
  state: GameState,
  trigger: TriggerMatch,
  depth: number,
): [GameState, OutputEvent[]] {
  // Phase 1 — decide, against one snapshot.
  let current = state;
  const firing: GameEvent[] = [];

  for (const event of module.events) {
    if (!matches(event, trigger)) continue;
    // Checked against the snapshot, not `current`: nothing in this phase can
    // fire an event, so the two agree — but reading from `state` says so.
    if (event.once && hasFired(state, event.id)) continue;

    const [passed, afterCond] = evalConditions(module, current, event.if);
    current = afterCond; // carries RNG advance only
    if (passed) firing.push(event);
  }

  // Phase 2 — apply, in order.
  const output: OutputEvent[] = [];
  for (const event of firing) {
    if (event.once) current = markFired(current, event.id);
    const [afterEffects, events] = applyEffectsAt(module, current, event.do, depth);
    current = afterEffects;
    output.push(...events);
  }

  return [current, output];
}
