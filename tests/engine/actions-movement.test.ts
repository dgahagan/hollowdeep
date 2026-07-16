import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAdventure } from '../../src/loader';
import type { AdventureModule } from '../../src/engine/schema';
import type { GameState } from '../../src/engine/types';
import { createGame, setFlag, setItemLocation, setItemState } from '../../src/engine/state';
import { isExitRevealed } from '../../src/engine/systems/events';
import { parse, type Command } from '../../src/engine/parser/parse';
import { handlerFor, type ActionResult } from '../../src/engine/actions';

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

/** Put the player somewhere with a lit lamp, so light is never the reason a test fails. */
function at(locationId: string, extra: Partial<GameState> = {}): GameState {
  let state: GameState = { ...start, locationId, ...extra };
  state = setItemLocation(state, 'brass-lamp', 'inventory');
  state = setItemState(state, 'brass-lamp', { lit: true });
  return state;
}

/** Same, but no light at all — the lamp stays on the shed shelf, unlit. */
function darkAt(locationId: string, extra: Partial<GameState> = {}): GameState {
  return { ...start, locationId, ...extra };
}

function verbIdOf(command: Command): string {
  switch (command.kind) {
    case 'go':
      return 'go';
    case 'verb':
    case 'verb-noun':
    case 'verb-noun-prep-noun':
      return command.verb;
    case 'magic-word':
      return command.word;
    case 'again':
      return 'again';
  }
}

/**
 * Parse `input` for real against `module_`/`state` and run whatever handler
 * is registered for it — this is what keeps these tests driving real
 * test-cave content instead of hand-built Command/Target stubs.
 */
function act(state: GameState, input: string): ActionResult {
  const result = parse(module_, state, input);
  if (result.kind === 'error') {
    throw new Error(`parse error for "${input}": ${result.message}`);
  }
  if (result.kind === 'disambiguation') {
    throw new Error(`ambiguous "${input}": ${result.question}`);
  }
  const verb = verbIdOf(result);
  const handler = handlerFor(verb);
  if (handler === undefined) {
    throw new Error(`no handler registered for verb "${verb}"`);
  }
  return handler(module_, state, result);
}

function locationOf(id: string) {
  const location = module_.locations.find((l) => l.id === id);
  if (location === undefined) throw new Error(`no such location "${id}" in test-cave`);
  return location;
}

describe('go', () => {
  it('moves through a normal exit and consumes a turn', () => {
    const result = act(at('road'), 'e');
    expect(result.state.locationId).toBe('shed');
    expect(result.consumesTurn).toBe(true);
  });

  it('refuses a direction with no exit, and consumes no turn', () => {
    const before = at('road');
    const result = act(before, 'up');
    expect(result.state.locationId).toBe('road');
    expect(result.consumesTurn).toBe(false);
    expect(result.events.map((e) => e.text).join(' ')).toMatch(/can't go up/i);
  });

  it('a bare direction and `go <direction>` are the same command', () => {
    const bare = act(at('road'), 'e');
    const verbose = act(at('road'), 'go east');
    expect(bare.state.locationId).toBe(verbose.state.locationId);
  });
});

describe('go — brief vs. full descriptions', () => {
  it('prints the FULL description on first visit', () => {
    const result = act(at('road'), 'e'); // shed has not been visited yet
    expect(result.events.some((e) => e.text === locationOf('shed').full)).toBe(true);
  });

  it('prints the BRIEF description on a revisit', () => {
    const arrived = act(at('road'), 'e').state; // shed now visited
    const revisit = act(arrived, 'w'); // shed -> road, and road was already visited at game start
    expect(revisit.events.some((e) => e.text === locationOf('road').brief)).toBe(true);
    expect(revisit.events.some((e) => e.text === locationOf('road').full)).toBe(false);
  });

  it('verbose mode forces FULL even on a revisit', () => {
    const arrived = act(at('road'), 'e').state;
    const verbose = { ...arrived, verbose: true };
    const revisit = act(verbose, 'w');
    expect(revisit.events.some((e) => e.text === locationOf('road').full)).toBe(true);
  });
});

describe('go — darkness (movement itself is never gated on light)', () => {
  it('walking into a dark room without light still succeeds', () => {
    // entry-hall -> low-passage is dark, and the lamp is still on the shed
    // shelf, unlit. Movement must work anyway; only the DESCRIPTION changes
    // (see the next test) — the darkness danger is T18's, not this file's.
    const result = act(darkAt('entry-hall'), 'n');
    expect(result.state.locationId).toBe('low-passage');
    expect(result.consumesTurn).toBe(true);
  });

  it('...but shows the darkness warning, not the room description, without light', () => {
    const result = act(darkAt('entry-hall'), 'n');
    const warning = module_.strings[module_.manifest.darkness.warningMessageId];
    expect(result.events.some((e) => e.text === warning)).toBe(true);
    expect(result.events.some((e) => e.text === locationOf('low-passage').full)).toBe(false);
  });

  it('shows the room description normally when carrying a lit lamp', () => {
    const result = act(at('entry-hall'), 'n');
    expect(result.events.some((e) => e.text === locationOf('low-passage').full)).toBe(true);
  });
});

describe('go — hidden exits work if guessed', () => {
  it('an unrevealed hidden exit still opens once its `if` is met', () => {
    // grotto's `down` exit is hidden AND gated on door-oiled. Set the flag
    // directly, WITHOUT ever firing the `find-hatch` search event, so the
    // exit is provably still unrevealed — proving `hidden` only governs
    // description, never traversal.
    const state = setFlag(at('grotto'), 'door-oiled', true);
    expect(isExitRevealed(state, 'grotto', 'down')).toBe(false);

    const result = act(state, 'down');
    expect(result.state.locationId).toBe('deep-vault');
    expect(result.consumesTurn).toBe(true);
  });
});

describe('go — blocked conditional exits', () => {
  it('refuses with the exit\'s blockedMessage and consumes no turn', () => {
    const result = act(at('cave-mouth'), 'down'); // grate-open is not set
    expect(result.state.locationId).toBe('cave-mouth');
    expect(result.consumesTurn).toBe(false);
    expect(result.events.map((e) => e.text).join(' ')).toContain('The grate is shut');
  });

  it('opens once the guard is met', () => {
    const state = setFlag(at('cave-mouth'), 'grate-open', true);
    const result = act(state, 'down');
    expect(result.state.locationId).toBe('entry-hall');
    expect(result.consumesTurn).toBe(true);
  });
});

describe('go — one-way exits', () => {
  it('the forward direction works with no guard at all', () => {
    const result = act(at('twisty-2'), 'down');
    expect(result.state.locationId).toBe('low-passage');
    expect(result.consumesTurn).toBe(true);
  });
});

describe('enter / exit', () => {
  it('bare `exit` is `go out`', () => {
    const result = act(at('shed'), 'exit');
    expect(result.state.locationId).toBe('road');
    expect(result.consumesTurn).toBe(true);
  });

  it('bare `enter` refuses when there is no `in` exit here', () => {
    const result = act(at('road'), 'enter');
    expect(result.consumesTurn).toBe(false);
    expect(result.state.locationId).toBe('road');
  });

  it('`enter <item>` refuses rather than guessing which location the item leads to', () => {
    // "grate" resolves to a real, in-scope item (parser scope has no location
    // names to resolve against at all) — this exercises the handler's actual
    // verb-noun refusal branch through real parsing, not a hand-built Target.
    const result = act(at('cave-mouth'), 'enter grate');
    expect(result.consumesTurn).toBe(false);
    expect(result.events.map((e) => e.text).join(' ')).toMatch(/can't enter/i);
  });

  it('`exit <item>` refuses the same way', () => {
    const result = act(at('grotto'), 'exit door');
    expect(result.consumesTurn).toBe(false);
    expect(result.events.map((e) => e.text).join(' ')).toMatch(/can't exit/i);
  });
});

describe('back', () => {
  it('refuses when the player has not been anywhere else yet', () => {
    const result = act(at('road'), 'back');
    expect(result.consumesTurn).toBe(false);
    expect(result.state.locationId).toBe('road');
  });

  it('returns the way you came through an ordinary exit', () => {
    const arrived = act(at('road'), 'e').state; // road -> shed
    expect(arrived.locationId).toBe('shed');
    expect(arrived.previousLocationId).toBe('road');

    const back = act(arrived, 'back');
    expect(back.state.locationId).toBe('road');
    expect(back.consumesTurn).toBe(true);
  });

  it('honours a oneWay exit: no going back through it', () => {
    // twisty-2 --down(oneWay)--> low-passage, with no reverse exit at all.
    const arrived = act(at('twisty-2'), 'down').state;
    expect(arrived.locationId).toBe('low-passage');
    expect(arrived.previousLocationId).toBe('twisty-2');

    const back = act(arrived, 'back');
    expect(back.consumesTurn).toBe(false);
    expect(back.state.locationId).toBe('low-passage'); // did not move
    expect(back.events.map((e) => e.text).join(' ')).toMatch(/no going back/i);
  });

  it('allows back after a teleport, where no exit (oneWay or otherwise) is on record', () => {
    // Simulates having arrived via the `zeeble` magic word: locationId and
    // previousLocationId are set, but road and entry-hall are not connected
    // by any exit in either direction, so there is no oneWay promise to honour.
    const teleported: GameState = { ...at('entry-hall'), previousLocationId: 'road' };
    const back = act(teleported, 'back');
    expect(back.state.locationId).toBe('road');
    expect(back.consumesTurn).toBe(true);
  });
});
