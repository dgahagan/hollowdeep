import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAdventure } from '../../src/loader';
import type { AdventureModule } from '../../src/engine/schema';
import type { GameState } from '../../src/engine/types';
import { createGame, getItemState, itemLocation, setItemLocation, setItemState } from '../../src/engine/state';
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

/**
 * Deliberately does NOT carry or light the lamp by default (unlike the `at`
 * helper in tests/engine/actions-handling.test.ts) — this file's whole job is
 * to test the carrying/lit preconditions themselves, so a helper that baked
 * them in would hide exactly what needs testing.
 */
function at(locationId: string, extra: Partial<GameState> = {}): GameState {
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

/** Parse `input` for real and run whatever handler is registered — real content, not hand-built Command stubs. */
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

function texts(result: ActionResult): string {
  return result.events.map((e) => e.text).join(' | ');
}

describe('light', () => {
  it('lights an unlit, carried lamp and consumes a turn', () => {
    let state = at('shed');
    state = setItemLocation(state, 'brass-lamp', 'inventory');

    const result = act(state, 'light lamp');
    expect(result.consumesTurn).toBe(true);
    expect(texts(result)).toMatch(/catches at once/i);
    expect(getItemState(result.state, 'brass-lamp').lit).toBe(true);
  });

  it('refuses to light a lamp you are not carrying, and does not light it', () => {
    // The lamp sits in the shed, un-taken.
    const result = act(at('shed'), 'light lamp');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/aren't carrying/i);
    expect(getItemState(result.state, 'brass-lamp').lit).not.toBe(true);
  });

  it('refuses to light an already-lit lamp', () => {
    let state = at('shed');
    state = setItemLocation(state, 'brass-lamp', 'inventory');
    state = setItemState(state, 'brass-lamp', { lit: true });

    const result = act(state, 'light lamp');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/already lit/i);
  });

  it('refuses to light a lamp with no fuel, and it stays unlit', () => {
    let state = at('shed');
    state = setItemLocation(state, 'brass-lamp', 'inventory');
    state = { ...state, lampFuel: 0 };

    const result = act(state, 'light lamp');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/dry/i);
    expect(getItemState(result.state, 'brass-lamp').lit).not.toBe(true);
  });

  it('refuses to light something that is not the configured lamp', () => {
    let state = at('shed');
    state = setItemLocation(state, 'tin-cup', 'inventory');

    const result = act(state, 'light cup');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/can't light/i);
  });

  // "light X" on a non-lamp falls through to X's `use` events, so content
  // verbs like "light the fuse" work even though `light` is a core verb.
  it("lighting a non-lamp item with a live `use` event fires it, as `use` would", () => {
    let state = at('grotto');
    state = setItemLocation(state, 'oil-flask', 'inventory');

    const result = act(state, 'light door');
    expect(result.consumesTurn).toBe(true);
    expect(texts(result)).toMatch(/rust gives up its grudge/i);
    expect(result.state.flags['door-oiled']).toBe(true);
  });

  it("lighting a non-lamp item whose `use` events are all guarded off still refuses", () => {
    // No oil flask carried, door not yet oiled: both door events' guards fail.
    const result = act(at('grotto'), 'light door');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/can't light/i);
    expect(result.state.flags['door-oiled']).toBeUndefined();
  });
});

describe('extinguish', () => {
  it('extinguishes a lit, carried lamp and consumes a turn', () => {
    let state = at('shed');
    state = setItemLocation(state, 'brass-lamp', 'inventory');
    state = setItemState(state, 'brass-lamp', { lit: true });

    const result = act(state, 'extinguish lamp');
    expect(result.consumesTurn).toBe(true);
    expect(texts(result)).toMatch(/put the lamp out/i);
    expect(getItemState(result.state, 'brass-lamp').lit).toBe(false);
  });

  it('refuses to extinguish a lamp that is not lit', () => {
    let state = at('shed');
    state = setItemLocation(state, 'brass-lamp', 'inventory');

    const result = act(state, 'extinguish lamp');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/isn't lit/i);
  });

  it('refuses to extinguish a lamp you are not carrying', () => {
    let state = at('shed');
    state = setItemState(state, 'brass-lamp', { lit: true }); // lit but left behind — an odd state, but a real one

    const result = act(state, 'extinguish lamp');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/aren't carrying/i);
    expect(getItemState(result.state, 'brass-lamp').lit).toBe(true); // unchanged
  });
});

describe('refuel — the oil flask (T17 acceptance: refueling from the oil flask)', () => {
  function lowOnFuel(state: GameState): GameState {
    let s = setItemLocation(state, 'brass-lamp', 'inventory');
    s = { ...s, lampFuel: 10 };
    return s;
  }

  it('tops the lamp up from a carried oil flask — which SURVIVES (softlock fix)', () => {
    let state = lowOnFuel(at('shed'));
    state = setItemLocation(state, 'oil-flask', 'inventory');

    const result = act(state, 'refuel lamp');
    expect(result.consumesTurn).toBe(true);
    // manifest.lamp.refuel.amount is 120 (adventures/test-cave/manifest.json) — 10 + 120.
    expect(result.state.lampFuel).toBe(130);
    // consumesItem: false — the flask also oils the vault door (oil-the-door
    // event), so consuming it on refuel made refuel-before-oil an unwinnable
    // game. The flask stays.
    expect(itemLocation(result.state, 'oil-flask')).toBe('inventory');
    expect(texts(result)).toMatch(/top the lamp up/i);
  });

  it('consumesItem: true destroys the source (the hollowdeep configuration, pinned on a patched module)', () => {
    const refuel = module_.manifest.lamp.refuel;
    if (refuel === undefined) throw new Error('fixture lamp has no refuel config');
    const consuming: AdventureModule = {
      ...module_,
      manifest: { ...module_.manifest, lamp: { ...module_.manifest.lamp, refuel: { ...refuel, consumesItem: true } } },
    };
    let state = lowOnFuel(at('shed'));
    state = setItemLocation(state, 'oil-flask', 'inventory');

    const parsed = parse(consuming, state, 'refuel lamp');
    if (parsed.kind === 'error' || parsed.kind === 'disambiguation') throw new Error('refuel failed to parse');
    const handler = handlerFor('refuel');
    if (handler === undefined) throw new Error('no refuel handler');
    const result = handler(consuming, state, parsed);

    expect(result.state.lampFuel).toBe(130);
    expect(itemLocation(result.state, 'oil-flask')).toBe('nowhere');
  });

  it('the bare `refuel` form (no noun) does the same thing', () => {
    let state = lowOnFuel(at('shed'));
    state = setItemLocation(state, 'oil-flask', 'inventory');

    const result = act(state, 'refuel');
    expect(result.consumesTurn).toBe(true);
    expect(result.state.lampFuel).toBe(130);
  });

  it('refuses to refuel without carrying the oil flask, and fuel is unchanged', () => {
    const state = lowOnFuel(at('shed')); // flask still sits in the shed, un-taken

    const result = act(state, 'refuel lamp');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/don't have anything to refuel it with/i);
    expect(result.state.lampFuel).toBe(10); // untouched
  });

  it('refuses to refuel a lamp you are not carrying', () => {
    let state = at('shed'); // neither lamp nor flask taken
    state = { ...state, lampFuel: 10 };
    state = setItemLocation(state, 'oil-flask', 'inventory');

    const result = act(state, 'refuel lamp');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/aren't carrying/i);
    expect(result.state.lampFuel).toBe(10);
  });
});

describe("'fill' as a refuel synonym (player-reported: 'fill lamp' parsed to nothing)", () => {
  it('fill lamp refuels, same as refuel lamp', () => {
    let state = at('shed');
    state = setItemLocation(state, 'brass-lamp', 'inventory');
    state = setItemLocation(state, 'oil-flask', 'inventory');
    state = { ...state, lampFuel: 10 };

    const result = act(state, 'fill lamp');
    expect(result.consumesTurn).toBe(true);
    expect(result.state.lampFuel).toBe(130);
  });
});
