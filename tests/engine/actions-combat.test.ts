import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAdventure } from '../../src/loader';
import type { AdventureModule, Creature } from '../../src/engine/schema';
import type { GameState } from '../../src/engine/types';
import {
  createGame,
  itemLocation,
  setCreatureState,
  setItemLocation,
  setItemState,
} from '../../src/engine/state';
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

function at(locationId: string, extra: Partial<GameState> = {}): GameState {
  return { ...start, locationId, ...extra };
}

/**
 * Force the cave rat active at `locationId` regardless of its `afterTurn`
 * gating (manifest: `afterTurn: 30`) — these tests are about `attack`'s
 * `wardOff` logic, not about the spawn gate T19 owns, so bypassing it here
 * (rather than playing 30 turns to reach it for real) keeps each test aimed
 * at the thing it is actually testing.
 */
function withRatActiveAt(state: GameState, locationId: string): GameState {
  return setCreatureState(state, 'cave-rat', { active: true, locationId, activatedTurn: state.turn });
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

function actWith(module: AdventureModule, state: GameState, input: string): ActionResult {
  const result = parse(module, state, input);
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
  return handler(module, state, result);
}

function act(state: GameState, input: string): ActionResult {
  return actWith(module_, state, input);
}

function texts(result: ActionResult): string {
  return result.events.map((e) => e.text).join(' | ');
}

describe('attack — the cave rat, wardOff.itemIds (T17 acceptance)', () => {
  it('attacking with nothing useful refuses with a wry line and consumes no turn', () => {
    const state = withRatActiveAt(at('grotto'), 'grotto'); // no lamp at all
    const result = act(state, 'attack rat');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/barehanded/i);
  });

  it('carrying the lamp UNLIT still refuses — wardOff.itemIds requires a lit light source', () => {
    let state = withRatActiveAt(at('grotto'), 'grotto');
    state = setItemLocation(state, 'brass-lamp', 'inventory'); // carried, not lit
    const result = act(state, 'attack rat');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/barehanded/i);
  });

  it('a lit, carried lamp wards the rat off — acted, distinct text, no lamp state change', () => {
    let state = withRatActiveAt(at('grotto'), 'grotto');
    state = setItemLocation(state, 'brass-lamp', 'inventory');
    state = setItemState(state, 'brass-lamp', { lit: true });

    const result = act(state, 'attack rat');
    expect(result.consumesTurn).toBe(true);
    expect(texts(result)).toMatch(/backs off/i);
    expect(texts(result)).not.toMatch(/barehanded/i);
  });

  it('refuses to attack something that is not a creature at all', () => {
    const result = act(at('shed'), 'attack shelf');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/can't fight/i);
  });
});

describe('attack — a synthetic verbIds ward (the "used one of verbIds against it" route)', () => {
  /**
   * test-cave's own creatures only exercise `wardOff.itemIds` (the cave rat)
   * — nothing in the fixture has `verbIds`, so the verb-match branch of
   * `isWardedOff` (combat.ts) would otherwise be dead code as far as this
   * suite is concerned. Same trick `actions-handling.test.ts` uses for its
   * portable-container regression: tweak a copy of the real module rather
   * than hand-building Command/state stubs.
   */
  function withVerbWardCreature(): AdventureModule {
    const verbWarded: Creature = {
      id: 'cave-rat',
      names: ['rat', 'cave rat'],
      description: module_.creatures.find((c) => c.id === 'cave-rat')?.description ?? '',
      artId: 'cave-rat',
      behavior: 'stalker',
      spawn: { locations: ['grotto'] },
      moveEvery: 3,
      aggression: 0.35,
      wardOff: { verbIds: ['attack'] },
    };
    return { ...module_, creatures: module_.creatures.map((c) => (c.id === 'cave-rat' ? verbWarded : c)) };
  }

  it('wards off by verb alone, with no warding item carried at all', () => {
    const testModule = withVerbWardCreature();
    const state = withRatActiveAt(at('grotto'), 'grotto');

    const result = actWith(testModule, state, 'attack rat');
    expect(result.consumesTurn).toBe(true);
    expect(texts(result)).toMatch(/backs off/i);
  });
});

describe('throw', () => {
  it('throwing at the rat without a warding item still consumes a turn and moves the item', () => {
    let state = withRatActiveAt(at('grotto'), 'grotto');
    state = setItemLocation(state, 'tin-cup', 'inventory');

    // "tin cup" — the silver chalice is also named "cup" (items.json), so a
    // bare "cup" here is ambiguous. "tin" narrows it (parser adjective rule).
    const result = act(state, 'throw tin cup at rat');
    expect(result.consumesTurn).toBe(true);
    expect(itemLocation(result.state, 'tin-cup')).toBe('grotto');
    expect(texts(result)).toMatch(/bounces off/i);
  });

  it('throwing the lit lamp at the rat wards it off (distinct text) — and still relocates the lamp', () => {
    let state = withRatActiveAt(at('grotto'), 'grotto');
    state = setItemLocation(state, 'brass-lamp', 'inventory');
    state = setItemState(state, 'brass-lamp', { lit: true });

    const result = act(state, 'throw lamp at rat');
    expect(result.consumesTurn).toBe(true);
    expect(texts(result)).toMatch(/catches the/i);
    expect(itemLocation(result.state, 'brass-lamp')).toBe('grotto');
  });

  it('bare `throw <item>` (no target) relocates the item to the floor', () => {
    let state = at('shed');
    state = setItemLocation(state, 'tin-cup', 'inventory');

    const result = act(state, 'throw tin cup');
    expect(result.consumesTurn).toBe(true);
    expect(itemLocation(result.state, 'tin-cup')).toBe('shed');
  });

  it('refuses to throw something you are not carrying', () => {
    const result = act(at('shed'), 'throw flask'); // flask sits in the shed, uncarried
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/aren't carrying/i);
  });

  it('throwing a non-ward item while ALSO carrying a lit ward does not credit the throw (regression)', () => {
    // The rat wards on `brass-lamp` only (creatures.json). Carrying the lit
    // lamp means the player IS warded in general — but the cup being thrown
    // is not what's doing that, and the text must say so honestly rather
    // than crediting the cup, which is the exact bug the review caught.
    let state = withRatActiveAt(at('grotto'), 'grotto');
    state = setItemLocation(state, 'brass-lamp', 'inventory');
    state = setItemState(state, 'brass-lamp', { lit: true });
    state = setItemLocation(state, 'tin-cup', 'inventory');

    const result = act(state, 'throw tin cup at rat');
    expect(result.consumesTurn).toBe(true);
    expect(itemLocation(result.state, 'tin-cup')).toBe('grotto');
    // Neither the "this warded it off" text nor the "totally ignored" text —
    // a third, honest outcome: warded, but not by the cup.
    expect(texts(result)).not.toMatch(/catches the/i);
    expect(texts(result)).not.toMatch(/does not appear to notice or care/i);
    expect(texts(result)).toMatch(/isn't it/i);
  });
});

describe('give', () => {
  it('offering the lit lamp (the actual ward) to the rat is accepted — placed, not destroyed', () => {
    let state = withRatActiveAt(at('grotto'), 'grotto');
    state = setItemLocation(state, 'brass-lamp', 'inventory');
    state = setItemState(state, 'brass-lamp', { lit: true });

    const result = act(state, 'give lamp to rat');
    expect(result.consumesTurn).toBe(true);
    expect(texts(result)).toMatch(/placated/i);
    // Recoverable: set down at the creature's (== the player's) location,
    // never `nowhere` — `wardOff` has no gift/consumption concept, and
    // `nowhere` for the player's only light source is an unrecoverable
    // soft-lock in a dark cave (the bug the review caught).
    expect(itemLocation(result.state, 'brass-lamp')).toBe('grotto');
  });

  it('declines an unlit lamp — the ward is lit-specific even as a gift', () => {
    let state = withRatActiveAt(at('grotto'), 'grotto');
    state = setItemLocation(state, 'brass-lamp', 'inventory'); // carried, NOT lit

    const result = act(state, 'give lamp to rat');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/no interest/i);
    expect(itemLocation(result.state, 'brass-lamp')).toBe('inventory');
  });

  it('declines a non-ward item even while ALSO carrying a lit ward — the gate is item-specific, not a status effect (regression)', () => {
    // This is the core bug the review caught: `isWardedOff` answers "is the
    // player warded", which is true here (lit lamp carried) — but the rat
    // wards on `brass-lamp` only (creatures.json), not the tin cup being
    // offered, and gating acceptance on the general check let ANY gift land
    // (and be destroyed) merely because an unrelated ward was in the
    // player's other hand.
    let state = withRatActiveAt(at('grotto'), 'grotto');
    state = setItemLocation(state, 'brass-lamp', 'inventory');
    state = setItemState(state, 'brass-lamp', { lit: true });
    state = setItemLocation(state, 'tin-cup', 'inventory');

    const result = act(state, 'give tin cup to rat');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/no interest/i);
    // Both items untouched — the cup was never at risk, and the still-lit,
    // still-carried lamp proves the refusal didn't smuggle in a side effect.
    expect(itemLocation(result.state, 'tin-cup')).toBe('inventory');
    expect(itemLocation(result.state, 'brass-lamp')).toBe('inventory');
  });

  it('refuses to give something you are not carrying', () => {
    // The chalice sits in the grotto, in scope but un-taken — proves the
    // refusal is "not carried", not "does not exist".
    const state = withRatActiveAt(at('grotto'), 'grotto');
    const result = act(state, 'give chalice to rat');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/aren't carrying/i);
  });
});
