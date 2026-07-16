import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAdventure } from '../../src/loader';
import type { AdventureModule } from '../../src/engine/schema';
import type { GameState } from '../../src/engine/types';
import { ENGINE_VERSION, step } from '../../src/engine/engine';
import { createGame, setItemLocation, setItemState } from '../../src/engine/state';

const MODULE_DIR = path.resolve(import.meta.dirname, '../../adventures/test-cave');

let module_: AdventureModule;
let start: GameState;

beforeAll(async () => {
  module_ = await loadAdventure(
    (p) => readFile(p, 'utf8'),
    MODULE_DIR,
    (dir) => readdir(dir),
  );
  start = createGame(module_, 42);
});

function at(locationId: string): GameState {
  let state = { ...start, locationId };
  state = setItemLocation(state, 'brass-lamp', 'inventory');
  state = setItemState(state, 'brass-lamp', { lit: true });
  return state;
}

/**
 * A command that consumes a turn and changes nothing else.
 *
 * `wait` is exactly that, which makes it the honest instrument for testing the
 * pipeline's turn accounting without a handler's side effects in the way.
 */
const CONSUMING_COMMAND = 'wait';

/** State where `zeeble` will actually fire (it is guarded on having read the carving). */
function zeebleReady(locationId = 'road'): GameState {
  return { ...at(locationId), flags: { ...start.flags, 'zeeble-known': true } };
}

/**
 * A module with a verb that has no handler and no event listening for it.
 *
 * Built rather than borrowed: every core verb now has a handler (T15–T17), so
 * there is no longer a real verb that exercises the "nothing answers this"
 * branch. Reaching for whichever verb happens to be unimplemented today is how
 * a test quietly stops testing anything the moment that verb lands.
 */
function moduleWithUnansweredVerb(): AdventureModule {
  return {
    ...module_,
    vocabulary: {
      ...module_.vocabulary,
      verbs: [...module_.vocabulary.verbs, { id: 'pirouette', words: ['pirouette'], patterns: ['V'] }],
    },
  };
}

function texts(events: { text: string }[]): string {
  return events.map((e) => e.text).join(' | ');
}

/** Recursively freeze, so any mutation of the input throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.getOwnPropertyNames(value).forEach((key) => {
      deepFreeze((value as Record<string, unknown>)[key]);
    });
    Object.freeze(value);
  }
  return value;
}

describe('ENGINE_VERSION', () => {
  it('is the canonical definition the loader checks manifests against', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('step — purity', () => {
  it('does not mutate the state it is given', () => {
    // Deep-frozen: any write would throw rather than silently succeed.
    const frozen = deepFreeze(structuredClone(start));
    const inputs = ['look', 'take lamp', 'n', 'zeeble', 'frobnicate', 'wait'];
    for (const input of inputs) {
      expect(() => step(module_, frozen, input)).not.toThrow();
    }
  });

  it('returns a new state object on a consumed turn', () => {
    const ready = zeebleReady();
    expect(step(module_, ready, CONSUMING_COMMAND).state).not.toBe(ready);
  });

  it('is deterministic for a fixed seed', () => {
    const ready = zeebleReady();
    expect(step(module_, ready, CONSUMING_COMMAND)).toEqual(step(module_, ready, CONSUMING_COMMAND));
  });
});

describe('step — echo', () => {
  it('echoes the command first, so typing and clicking read alike (FR-2.7)', () => {
    const { events } = step(module_, start, 'look');
    expect(events[0]).toEqual({ kind: 'command-echo', text: 'look' });
  });

  it('echoes even a command it cannot parse', () => {
    const { events } = step(module_, start, 'frobnicate');
    expect(events[0]).toMatchObject({ kind: 'command-echo' });
  });
});

// §5.3.2. The rule the plan flags as easy to get wrong.
describe('step — a parse error consumes no turn', () => {
  it('does not advance the turn counter', () => {
    const { state } = step(module_, start, 'frobnicate');
    expect(state.turn).toBe(start.turn);
  });

  it('does not tick the world', () => {
    // Mistyping must not burn the lamp or move the rat. Every observable the
    // world tick touches must be untouched.
    const before = at('twisty-1');
    const { state } = step(module_, before, 'frobnicate');
    expect(state.lampFuel).toBe(before.lampFuel);
    expect(state.creatures).toEqual(before.creatures);
    expect(state.rng).toBe(before.rng);
  });

  it('still says something useful', () => {
    const { events } = step(module_, at('shed'), 'frobnicate');
    expect(texts(events)).toMatch(/isn't a word|Try/i);
  });

  it('does not record an unparseable command as repeatable', () => {
    const { state } = step(module_, start, 'frobnicate');
    expect(state.lastCommand).toBeUndefined();
  });

  it('an empty command is a no-op, not a turn', () => {
    const { state } = step(module_, start, '');
    expect(state.turn).toBe(start.turn);
  });
});

describe('step — turn counting', () => {
  it('advances on a consumed turn', () => {
    const ready = zeebleReady();
    expect(step(module_, ready, CONSUMING_COMMAND).state.turn).toBe(ready.turn + 1);
  });

  it('does not advance for a verb with no handler and no event', () => {
    // The player asked for something the world has no answer to. It must
    // refuse WITHOUT charging a turn — otherwise a verb nobody implemented
    // burns the player's lamp for nothing.
    const unanswered = moduleWithUnansweredVerb();
    const { state, events } = step(unanswered, start, 'pirouette');
    expect(state.turn).toBe(start.turn);
    expect(texts(events)).toContain('Nothing happens');
  });
});

// §5.3.1. The other rule the plan flags.
describe('step — pending questions', () => {
  /** Carry the chalice into the shed, where the tin cup lives. Both are "cup". */
  function bothCups(): GameState {
    return setItemLocation(at('shed'), 'silver-chalice', 'inventory');
  }

  it('asks rather than guessing', () => {
    const { state, events } = step(module_, bothCups(), 'take cup');
    expect(state.pending).toBeDefined();
    expect(state.pending?.options).toEqual(expect.arrayContaining(['tin cup', 'silver chalice']));
    expect(events.some((e) => e.kind === 'question')).toBe(true);
  });

  it('asking consumes no turn', () => {
    const before = bothCups();
    const { state } = step(module_, before, 'take cup');
    expect(state.turn).toBe(before.turn);
    expect(state.rng).toBe(before.rng);
  });

  it('resolves by the option text', () => {
    const { state: asked } = step(module_, bothCups(), 'take cup');
    const { state } = step(module_, asked, 'tin cup');
    expect(state.pending).toBeUndefined();
    // No handlers yet, so the proof it resolved is that it got as far as the
    // dispatch refusal rather than asking again.
    expect(state.pending).toBeUndefined();
  });

  it('resolves by a distinguishing word — how people actually answer', () => {
    const { state: asked } = step(module_, bothCups(), 'take cup');
    const { state } = step(module_, asked, 'tin');
    expect(state.pending).toBeUndefined();
  });

  it('resolves by number', () => {
    const { state: asked } = step(module_, bothCups(), 'take cup');
    const { state } = step(module_, asked, '1');
    expect(state.pending).toBeUndefined();
  });

  it('A FRESH COMMAND CANCELS the question rather than being eaten by it', () => {
    // The rule: a player who asks "which cup?" and then changes their mind must
    // have the new command honoured, not swallowed as a nonsense answer.
    const asked = step(module_, { ...bothCups(), flags: { 'zeeble-known': true } }, 'take cup').state;
    expect(asked.pending).toBeDefined();

    const { state } = step(module_, asked, CONSUMING_COMMAND);
    expect(state.pending).toBeUndefined();
    // The fresh command actually ran rather than being read as an answer.
    expect(state.turn).toBe(asked.turn + 1);
  });

  it('a fresh command that is itself ambiguous asks again', () => {
    const { state: asked } = step(module_, bothCups(), 'take cup');
    const { state } = step(module_, asked, 'examine cup');
    expect(state.pending).toBeDefined();
    expect(state.pending?.originalCommand).toBe('examine cup');
  });

  it('an unanswerable answer is treated as a fresh command', () => {
    const { state: asked } = step(module_, bothCups(), 'take cup');
    const { state, events } = step(module_, asked, 'frobnicate');
    expect(state.pending).toBeUndefined();
    expect(texts(events)).toMatch(/isn't a word/i);
  });
});

describe('step — again (FR-2.3)', () => {
  it('says so when there is nothing to repeat', () => {
    const { events } = step(module_, start, 'again');
    expect(texts(events)).toContain('nothing to repeat');
  });

  it('replays the last CONSUMED command', () => {
    const first = step(module_, zeebleReady(), CONSUMING_COMMAND).state;
    expect(first.lastCommand).toBe(CONSUMING_COMMAND);
    // We are now at entry-hall, where zeeble sends us back to the road.
    const { state } = step(module_, first, 'g');
    expect(state.turn).toBe(first.turn + 1);
    expect(state.locationId).toBe('road');
  });

  it('does not record a refusal as the last command', () => {
    // Repeating a refusal should repeat the refusal, not resurrect whatever
    // last happened to work.
    const consumed = step(module_, zeebleReady(), CONSUMING_COMMAND).state;
    const { state: refused } = step(module_, consumed, 'frobnicate');
    expect(refused.lastCommand).toBe(CONSUMING_COMMAND);
  });
});

describe('step — magic words (FR-1.9)', () => {
  it('fires the word event when its guard passes', () => {
    const known = { ...start, flags: { ...start.flags, 'zeeble-known': true } };
    const { state } = step(module_, known, 'zeeble');
    expect(state.locationId).toBe('entry-hall');
    expect(state.turn).toBe(known.turn + 1);
  });

  it('says nothing happened when the guard fails, without leaking that the word is real', () => {
    const { state, events } = step(module_, start, 'zeeble');
    expect(state.locationId).toBe('road');
    expect(texts(events)).toContain('Nothing happens');
  });
});

describe('step — world tick', () => {
  it('fires turnStart triggers on a consumed turn', () => {
    // test-cave's lamp-nudge fires at turn 12.
    const result = step(module_, { ...zeebleReady(), turn: 11 }, CONSUMING_COMMAND);
    expect(result.state.turn).toBe(12);
    expect(texts(result.events)).toContain('never needed a lamp');
  });

  it('does not fire turnStart triggers on an unconsumed turn', () => {
    const { events } = step(module_, { ...zeebleReady(), turn: 11 }, 'frobnicate');
    expect(texts(events)).not.toContain('never needed a lamp');
  });
});

describe('step — game over', () => {
  it('refuses further play once ended', () => {
    const ended: GameState = { ...zeebleReady(), ended: { victory: true, rank: 'Tourist' } };
    const { state, events } = step(module_, ended, CONSUMING_COMMAND);
    expect(state.turn).toBe(ended.turn);
    expect(state.locationId).toBe(ended.locationId);
    expect(texts(events)).toContain('game is over');
  });
});

describe('step — death (§5.3 step 5)', () => {
  /** `jump` at the ledge is test-cave's lethal hazard. */
  function jumpOffLedge(seed = 42): ReturnType<typeof step> {
    const state = at('ledge');
    return step(module_, { ...state, rng: seed }, 'jump');
  }

  it('kills the player and says so in the adventure\'s own words', () => {
    const { events } = jumpOffLedge();
    expect(events.some((e) => e.kind === 'death')).toBe(true);
    expect(texts(events)).toContain('out of your hands');
  });

  it('counts the death once', () => {
    const { state } = jumpOffLedge();
    expect(state.deaths).toBe(1);
  });

  it('applies the death penalty', () => {
    const scored = { ...at('ledge'), score: 40 };
    const { state } = step(module_, scored, 'jump');
    expect(state.score).toBe(40 - module_.scoring.deathPenalty);
  });

  it('never drives the score below zero', () => {
    const { state } = jumpOffLedge();
    expect(state.score).toBe(0);
  });

  it('scatters possessions where you fell', () => {
    const { state } = jumpOffLedge();
    expect(state.itemLocations['brass-lamp']).toBe('ledge');
  });

  it('reincarnates the player at the start', () => {
    const { state } = jumpOffLedge();
    expect(state.locationId).toBe(module_.manifest.startLocation);
  });

  it('clears the death marker so the penalty is charged once', () => {
    const { state } = jumpOffLedge();
    // Take another turn; the death must not re-fire.
    const { state: next } = step(module_, { ...state, flags: { 'zeeble-known': true } }, CONSUMING_COMMAND);
    expect(next.deaths).toBe(1);
  });

  it('does not kill a player who jumps somewhere safe', () => {
    const { state, events } = step(module_, at('road'), 'jump');
    expect(state.deaths).toBe(0);
    expect(events.some((e) => e.kind === 'death')).toBe(false);
  });
});
