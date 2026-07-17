import type { AdventureModule } from './schema';
import type { GameState, OutputEvent, StepResult } from './types';
import { parse, type Command, type ParseResult } from './parser/parse';
import { tokenize } from './parser/tokenize';
import { clearFlag, isFlagSet, itemLocation, setItemLocation } from './state';
import { DIED_THIS_TURN, fireTriggers } from './systems/events';
import { creatureTick } from './systems/creatures';
import { lightTick } from './systems/light';
import { rankFor, scoringTick } from './systems/scoring';
import { handlerFor, type ActionResult } from './actions';

// ─────────────────────────────────────────────────────────────────────────────
// The public API (design plan §5.1) and the turn pipeline (§5.3).
//
// `step` is PURE: new state out, no mutation in. `src/app` codes against this
// file and nothing else in the engine.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The engine's version, checked against each adventure's
 * `manifest.engineVersion` range at load (design plan §10).
 *
 * This is the canonical definition; `src/loader.ts` imports it from here.
 *
 * **1.1.0** — added `Condition.all` (schema/conditions.ts). A minor bump, by
 * semver, because it is additive: every 1.0.0 module still loads, and
 * test-cave's `^1.0.0` is satisfied by 1.1.0. The bump is what lets a module
 * that NEEDS `all` say so — declaring `^1.1.0` gets a clean refusal from an
 * older engine instead of a strict-mode parse error about an unknown key.
 *
 * **2.0.0** — hints + timers (hints-timers plan §6). A MAJOR, and honestly
 * so: `hints.json` is a required eleventh document, so every pre-hints
 * module fails to load on this engine — calling that minor would make
 * `^1.0.0` a lie the loader acts on. The additive pieces (`startTimer`,
 * `timerExpired`, `hintsAtMost`, `scoring.hintPenalty`) ride the same bump.
 */
export const ENGINE_VERSION = '2.0.0';

export { createGame } from './state';
export type { GameState, OutputEvent, SceneView, StepResult, UIAction } from './types';

/** Remove `pending` by deleting the key — `exactOptionalPropertyTypes` forbids assigning undefined. */
function clearPending(state: GameState): GameState {
  if (state.pending === undefined) return state;
  const { pending: _pending, ...rest } = state;
  return rest;
}

function setPending(state: GameState, pending: NonNullable<GameState['pending']>): GameState {
  return { ...state, pending };
}

/**
 * Try to read the input as an answer to the pending question (design plan
 * §5.3.1).
 *
 * Accepts the option's text (`tin cup`), a distinguishing word from it
 * (`tin`), or its number (`2`). Returns the rewritten command, or undefined if
 * this input is not an answer at all — in which case it is a fresh command and
 * **cancels** the question rather than being eaten by it. That rule matters:
 * a player who asks "which cup?" and then decides to `look` instead must not
 * have `look` swallowed as a nonsense answer.
 */
function answerToCommand(state: GameState, input: string): string | undefined {
  const pending = state.pending;
  if (pending === undefined) return undefined;

  const tokens = tokenize(input);
  if (tokens.length === 0) return undefined;
  const answer = tokens.join(' ');

  let chosen: string | undefined;

  // By number.
  const asNumber = Number(answer);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= pending.options.length) {
    chosen = pending.options[asNumber - 1];
  }

  // By exact option text.
  chosen ??= pending.options.find((option) => option.toLowerCase() === answer);

  // By a word that appears in exactly one option — how people actually answer
  // "the tin cup or the silver chalice?": they say "tin".
  if (chosen === undefined) {
    const matching = pending.options.filter((option) =>
      tokens.every((token) => tokenize(option).includes(token)),
    );
    if (matching.length === 1) chosen = matching[0];
  }

  if (chosen === undefined) return undefined;

  // Rewrite the original command with the chosen phrase in place of the
  // ambiguous one: "take cup" + "tin cup" → "take tin cup".
  const original = tokenize(pending.originalCommand);
  const phrase = tokenize(pending.phrase);
  const at = findSubsequence(original, phrase);
  if (at < 0) return chosen;
  return [...original.slice(0, at), ...tokenize(chosen), ...original.slice(at + phrase.length)].join(' ');
}

function findSubsequence(haystack: string[], needle: string[]): number {
  if (needle.length === 0) return -1;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((token, j) => haystack[i + j] === token)) return i;
  }
  return -1;
}

/**
 * Run one action through the dispatch table.
 *
 * Handlers are filled in by T15–T17. Until a verb has one, it nudges rather
 * than throwing, and — the part that matters — **consumes no turn**: an engine
 * that charged the player a turn for a verb it has not implemented yet would
 * burn their lamp for nothing.
 */
function dispatch(module: AdventureModule, state: GameState, command: Command): ActionResult {
  switch (command.kind) {
    case 'again':
      // Resolved before dispatch; reaching here means there was nothing to repeat.
      return { state, events: [{ kind: 'text', text: 'There is nothing to repeat.' }], consumesTurn: false };

    case 'magic-word': {
      // Magic words are pure event triggers (FR-1.9): what the word does is
      // entirely the adventure's business, so the engine only announces it.
      const [next, events] = fireTriggers(module, state, { type: 'word', word: command.word });
      if (events.length === 0) {
        return {
          state,
          events: [{ kind: 'text', text: 'Nothing happens.' }],
          consumesTurn: true,
        };
      }
      return { state: next, events, consumesTurn: true };
    }

    default: {
      const verb = command.kind === 'go' ? 'go' : command.verb;
      const handler = handlerFor(verb);

      if (handler !== undefined) {
        const result = handler(module, state, command);
        // `verb` triggers fire AFTER the handler, so content reacts to what the
        // action did rather than pre-empting it. Only on a consumed turn: a
        // refusal did not happen, so nothing should react to it.
        if (!result.consumesTurn) return result;
        const [next, events] = fireTriggers(module, result.state, { type: 'verb', target: verb });
        return { ...result, state: next, events: [...result.events, ...events] };
      }

      // No core handler — the `verb` trigger is the whole mechanism for an
      // adventure-defined verb like test-cave's `jump` (see the contract note
      // in schema/event.ts).
      const [next, events] = fireTriggers(module, state, { type: 'verb', target: verb });
      if (events.length > 0 || next !== state) {
        return { state: next, events, consumesTurn: true };
      }

      // A verb with no handler and no matching event is a nudge, and costs no
      // turn — the player asked for something the world has no answer to.
      return {
        state,
        events: [{ kind: 'text', text: `Nothing happens.` }],
        consumesTurn: false,
      };
    }
  }
}

/**
 * The world's half of a turn (design plan §5.3 step 4).
 *
 * Order is fixed and observable through seeded tests: **events (turnStart,
 * then timer expiries) → creatures → light → scoring**. Reordering these
 * changes which draws happen when, which silently rewrites every seeded test
 * in the suite (§10). Timer expiries slot after `turnStart` (the older
 * mechanism keeps its observed position) and themselves draw no RNG.
 */
function worldTick(module: AdventureModule, state: GameState): [GameState, OutputEvent[]] {
  let current = state;
  const output: OutputEvent[] = [];

  const [afterEvents, events] = fireTriggers(module, current, {
    type: 'turnStart',
    turn: current.turn,
  });
  current = afterEvents;
  output.push(...events);

  // Timer expiries (hints-timers plan §4.4). Lexicographic id order makes
  // same-turn multi-expiry deterministic and stated. Delete-then-fire, so an
  // expiry event may legally `startTimer` its own id — the periodic idiom.
  // The list is collected up front for the same reason.
  //
  // THE ARITHMETIC, pinned. `startTimer` stores `turn-at-effect + turns`, and
  // an entry fires when the tick's turn is STRICTLY past it. Action effects
  // run before the turn increments (step stage 3 → 4), so for the design
  // plan's contract case — a timer armed by a player action — this yields
  // exactly §4.3's promise: n further consumed turns, expiry during the
  // n-th's tick, after its action (the n-th move may be the escaping one).
  // A timer armed from WITHIN a world-tick event (turnStart / a timerExpired
  // re-arm) runs post-increment instead, so its n counts from the next turn —
  // a self-re-arming timer has period n+1. That asymmetry is inherent to the
  // two phases sharing one phase-blind effect; the contract case is the
  // player-facing one, so it is the one kept exact.
  const expired = Object.entries(current.timers)
    .filter(([, expiry]) => expiry < current.turn)
    .map(([id]) => id)
    .sort();
  for (const id of expired) {
    const { [id]: _gone, ...remaining } = current.timers;
    current = { ...current, timers: remaining };
    const [afterTimer, timerEvents] = fireTriggers(module, current, {
      type: 'timerExpired',
      target: id,
    });
    current = afterTimer;
    output.push(...timerEvents);
  }

  const [afterCreatures, creatureEvents] = creatureTick(module, current);
  current = afterCreatures;
  output.push(...creatureEvents);

  const [afterLight, lightEvents] = lightTick(module, current);
  current = afterLight;
  output.push(...lightEvents);

  const [afterScoring, scoringEvents] = scoringTick(module, current);
  current = afterScoring;
  output.push(...scoringEvents);

  return [current, output];
}

/**
 * Death (design plan §5.3 step 5).
 *
 * This runs once per death regardless of cause, which is exactly why it lives
 * here and not in the `die` effect: darkness and creature kills never go
 * through an effect, and duplicating the penalty in three places is how a
 * player ends up docked twice for one fall.
 */
function handleDeath(module: AdventureModule, state: GameState): [GameState, OutputEvent[]] {
  if (!isFlagSet(state, DIED_THIS_TURN)) return [state, []];

  let current = clearFlag(state, DIED_THIS_TURN);
  const diedAt = current.locationId;

  current = { ...current, deaths: current.deaths + 1 };
  current = { ...current, score: Math.max(0, current.score - module.scoring.deathPenalty) };

  // Possessions scatter where you fell — the classic tax, and the reason death
  // costs a trek rather than a reload.
  for (const item of module.items) {
    if (itemLocation(current, item.id) === 'inventory') {
      current = setItemLocation(current, item.id, diedAt);
    }
  }

  current = {
    ...current,
    locationId: module.manifest.startLocation,
    previousLocationId: diedAt,
  };

  return [
    current,
    [
      {
        kind: 'text',
        text: 'The cave, which has seen this before, puts you back where you started. Your possessions are where you left them, which is to say where you fell.',
      },
    ],
  ];
}

/**
 * Advance the game by one input (design plan §5.3).
 *
 * Pure — the input state is never mutated. Returns a new state and the turn's
 * output, in order.
 */
export function step(module: AdventureModule, state: GameState, rawInput: string): StepResult {
  const output: OutputEvent[] = [{ kind: 'command-echo', text: rawInput }];

  if (state.ended !== undefined) {
    return {
      state,
      events: [
        ...output,
        { kind: 'text', text: 'The game is over. Load a save, or start again.' },
      ],
    };
  }

  let working = state;
  let input = rawInput;

  // ── 1. pending question ────────────────────────────────────────────────
  if (working.pending !== undefined) {
    const answered = answerToCommand(working, rawInput);
    working = clearPending(working);
    // Not an answer? Then it is a fresh command, and the question is simply
    // dropped (§5.3.1).
    if (answered !== undefined) input = answered;
  }

  // ── 2. parse ───────────────────────────────────────────────────────────
  // `again` replays the last CONSUMED command (FR-2.3) — so repeating a
  // refusal repeats the refusal, not the last thing that happened to work.
  let result: ParseResult = parse(module, working, input);
  if (result.kind === 'again') {
    const last = working.lastCommand;
    if (last === undefined) {
      return { state: working, events: [...output, { kind: 'text', text: 'There is nothing to repeat.' }] };
    }
    input = last;
    result = parse(module, working, input);
  }

  if (result.kind === 'error') {
    // A parse error consumes NO turn (§5.3.2): no fuel burn, no creature tick.
    // Mistyping a word must not cost you the lamp.
    const events: OutputEvent[] = [...output, { kind: 'text', text: result.message }];
    if (result.suggestion !== undefined) events.push({ kind: 'text', text: result.suggestion });
    return { state: working, events };
  }

  if (result.kind === 'disambiguation') {
    // Also no turn: asking which cup you meant is not an action.
    const asked = setPending(working, {
      kind: 'disambiguation',
      question: result.question,
      options: result.options,
      originalCommand: result.originalCommand,
      phrase: result.phrase,
    });
    return {
      state: asked,
      events: [...output, { kind: 'question', text: result.question, options: result.options }],
    };
  }

  // ── 3. act ─────────────────────────────────────────────────────────────
  const action = dispatch(module, working, result);
  working = action.state;
  output.push(...action.events);

  if (!action.consumesTurn) {
    return { state: working, events: output };
  }

  working = { ...working, lastCommand: input, turn: working.turn + 1 };

  // ── 4. world tick ──────────────────────────────────────────────────────
  const [ticked, tickEvents] = worldTick(module, working);
  working = ticked;
  output.push(...tickEvents);

  // ── 5. death ───────────────────────────────────────────────────────────
  const [afterDeath, deathEvents] = handleDeath(module, working);
  working = afterDeath;
  output.push(...deathEvents);

  // ── 6. end ─────────────────────────────────────────────────────────────
  if (working.ended !== undefined) {
    // The `endGame` effect (systems/events.ts) only stamps `rank: ''` — it
    // doesn't own the rank table, scoring.ts does. Fill it in here, and
    // persist it onto `state.ended` (not just the OutputEvent) so a save
    // taken after the game ends round-trips the same rank rather than
    // recomputing it, and so it can't drift from what the player was told.
    const victory = working.ended.victory;
    const rank = rankFor(module, working.score);
    working = { ...working, ended: { victory, rank } };
    output.push({
      kind: 'game-over',
      text: victory ? 'You have won.' : 'Your adventure ends here.',
      victory,
      score: working.score,
      rank,
    });
  }

  return { state: working, events: output };
}
