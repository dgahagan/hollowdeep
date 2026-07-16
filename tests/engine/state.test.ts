import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAdventure } from '../../src/loader';
import type { AdventureModule } from '../../src/engine/schema';
import type { GameState } from '../../src/engine/types';
import {
  addAchievement,
  canSee,
  carriedCount,
  clearFlag,
  createGame,
  creaturesHere,
  currentLocation,
  getItemState,
  hasFired,
  hasLight,
  hasVisited,
  isCarrying,
  isFlagSet,
  itemLocation,
  itemsAt,
  itemsIn,
  markFired,
  markVisited,
  setCreatureState,
  setFlag,
  setItemLocation,
  setItemState,
} from '../../src/engine/state';

// These drive the REAL test-cave module rather than a hand-built stub. That is
// the point of having a reference module: if createGame mis-reads real content,
// a stub shaped to match the code would never say so.

const MODULE_DIR = path.resolve(import.meta.dirname, '../../adventures/test-cave');

let module_: AdventureModule;

beforeAll(async () => {
  module_ = await loadAdventure(
    (p) => readFile(p, 'utf8'),
    MODULE_DIR,
    (dir) => readdir(dir),
  );
});

describe('createGame', () => {
  it('is deterministic for a fixed module and seed', () => {
    expect(createGame(module_, 42)).toEqual(createGame(module_, 42));
  });

  it('draws no RNG — the seed is simply stored', () => {
    expect(createGame(module_, 42).rng).toBe(42);
    expect(createGame(module_, 999).rng).toBe(999);
  });

  it('coerces the seed to int32 so the sequence is stable across a save', () => {
    expect(createGame(module_, 2 ** 33 + 5).rng).toBe((2 ** 33 + 5) | 0);
  });

  it('starts the player at the manifest start location', () => {
    const state = createGame(module_, 1);
    expect(state.locationId).toBe('road');
    expect(state.previousLocationId).toBe('road');
    expect(state.visited).toEqual(['road']);
    expect(state.turn).toBe(0);
  });

  it('places every item at its initial location', () => {
    const state = createGame(module_, 1);
    expect(itemLocation(state, 'brass-lamp')).toBe('shed');
    expect(itemLocation(state, 'silver-chalice')).toBe('grotto');
    // Inside a container, not a location.
    expect(itemLocation(state, 'jade-idol')).toBe('wooden-box');
    // Not in play until `search tree` reveals it.
    expect(itemLocation(state, 'iron-key')).toBe('nowhere');
  });

  it('seeds container state from the module', () => {
    const state = createGame(module_, 1);
    expect(getItemState(state, 'wooden-box')).toEqual({ open: false, locked: true });
    expect(getItemState(state, 'grate')).toEqual({ open: false, locked: true });
  });

  it('starts light sources unlit', () => {
    const state = createGame(module_, 1);
    expect(getItemState(state, 'brass-lamp').lit).toBe(false);
    expect(hasLight(module_, state)).toBe(false);
  });

  it('fills the lamp from the manifest', () => {
    expect(createGame(module_, 1).lampFuel).toBe(module_.manifest.lamp.startFuel);
  });

  it('starts scoring and its ledgers empty', () => {
    const state = createGame(module_, 1);
    expect(state.score).toBe(0);
    expect(state.deaths).toBe(0);
    expect(state.achievements).toEqual([]);
    expect(state.scoredCarry).toEqual([]);
    expect(state.scoredDeposit).toEqual([]);
    expect(state.awardedMilestones).toEqual([]);
    expect(state.lampWarned).toEqual([]);
  });

  it('leaves optional fields absent rather than explicitly undefined', () => {
    const state = createGame(module_, 1);
    // Setting these to `undefined` would survive in memory but vanish through
    // JSON, breaking the round-trip invariant below.
    expect('itRefers' in state).toBe(false);
    expect('pending' in state).toBe(false);
    expect('ended' in state).toBe(false);
    expect('lastCommand' in state).toBe(false);
  });

  describe('creature activation gating', () => {
    it('activates an ungated creature immediately', () => {
      // The newt is `static` with a bare spawn — it is simply always there.
      const state = createGame(module_, 1);
      expect(state.creatures['pale-newt']).toEqual({
        locationId: 'entry-hall',
        active: true,
        encounterTurns: 0,
        activatedTurn: 0,
        hasStolen: false,
      });
    });

    it('leaves an afterTurn-gated creature inactive', () => {
      const state = createGame(module_, 1);
      expect(state.creatures['cave-rat']?.active).toBe(false);
      expect(state.creatures['cave-rat']?.activatedTurn).toBeNull();
    });

    it('leaves an if-gated creature inactive', () => {
      const state = createGame(module_, 1);
      expect(state.creatures['shadow-packrat']?.active).toBe(false);
      expect(state.creatures['shadow-packrat']?.hasStolen).toBe(false);
    });
  });
});

// The invariant the entire save system rests on (T21). If this breaks, saves
// corrupt silently — the game loads and is subtly not the game you saved.
describe('serializability', () => {
  it('round-trips through JSON unchanged', () => {
    const state = createGame(module_, 42);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('round-trips a played-in state with every optional field set', () => {
    const base = createGame(module_, 42);
    const played: GameState = {
      ...base,
      turn: 17,
      itRefers: 'brass-lamp',
      lastCommand: 'take lamp',
      pending: {
        kind: 'disambiguation',
        question: 'Which cup?',
        options: ['tin cup', 'silver chalice'],
        originalCommand: 'take cup',
      },
      ended: { victory: true, rank: 'Master of the Test Cave' },
    };
    expect(JSON.parse(JSON.stringify(played))).toEqual(played);
  });

  it('contains no Map, Set, or class instance anywhere', () => {
    // A Set would stringify to {} and lose the game silently. This walks the
    // whole object rather than trusting the type declaration.
    const walk = (value: unknown, at: string): void => {
      if (value === null || typeof value !== 'object') return;
      expect(value instanceof Map, `${at} is a Map`).toBe(false);
      expect(value instanceof Set, `${at} is a Set`).toBe(false);
      expect(value instanceof Date, `${at} is a Date`).toBe(false);
      const proto: unknown = Object.getPrototypeOf(value);
      expect(
        proto === Object.prototype || proto === Array.prototype,
        `${at} is a class instance`,
      ).toBe(true);
      for (const [key, child] of Object.entries(value)) walk(child, `${at}.${key}`);
    };
    walk(createGame(module_, 1), 'state');
  });
});

describe('item helpers', () => {
  it('reports an unknown item as nowhere rather than undefined', () => {
    expect(itemLocation(createGame(module_, 1), 'no-such-item')).toBe('nowhere');
  });

  it('finds items at a location, excluding container contents', () => {
    const state = createGame(module_, 1);
    const ids = itemsAt(module_, state, 'deep-vault').map((i) => i.id);
    expect(ids).toContain('wooden-box');
    // The idol is IN the box, not at the vault.
    expect(ids).not.toContain('jade-idol');
    expect(itemsIn(module_, state, 'wooden-box').map((i) => i.id)).toEqual(['jade-idol']);
  });

  it('tracks carrying', () => {
    const state = setItemLocation(createGame(module_, 1), 'brass-lamp', 'inventory');
    expect(isCarrying(state, 'brass-lamp')).toBe(true);
    expect(carriedCount(module_, state)).toBe(1);
  });

  it('does not mutate the state it is given', () => {
    const before = createGame(module_, 1);
    const snapshot = structuredClone(before);
    setItemLocation(before, 'brass-lamp', 'inventory');
    setItemState(before, 'brass-lamp', { lit: true });
    setFlag(before, 'x', true);
    expect(before).toEqual(snapshot);
  });

  it('merges item state rather than replacing it', () => {
    let state = createGame(module_, 1);
    state = setItemState(state, 'wooden-box', { locked: false });
    expect(getItemState(state, 'wooden-box')).toEqual({ open: false, locked: false });
  });
});

describe('light and visibility', () => {
  it('a lit location is visible without a lamp', () => {
    expect(canSee(module_, createGame(module_, 1))).toBe(true);
  });

  it('a dark location is not visible without a light source', () => {
    const state = { ...createGame(module_, 1), locationId: 'low-passage' };
    expect(canSee(module_, state)).toBe(false);
  });

  it('carrying an UNLIT lamp is not light', () => {
    let state = { ...createGame(module_, 1), locationId: 'low-passage' };
    state = setItemLocation(state, 'brass-lamp', 'inventory');
    expect(hasLight(module_, state)).toBe(false);
    expect(canSee(module_, state)).toBe(false);
  });

  it('a lit lamp left on the floor is not light you can use', () => {
    let state = { ...createGame(module_, 1), locationId: 'low-passage' };
    state = setItemState(state, 'brass-lamp', { lit: true });
    expect(hasLight(module_, state)).toBe(false);
  });

  it('carrying a lit lamp lights a dark room', () => {
    let state = { ...createGame(module_, 1), locationId: 'low-passage' };
    state = setItemLocation(state, 'brass-lamp', 'inventory');
    state = setItemState(state, 'brass-lamp', { lit: true });
    expect(hasLight(module_, state)).toBe(true);
    expect(canSee(module_, state)).toBe(true);
  });
});

describe('flags', () => {
  it('treats unset, false, and 0 as not set', () => {
    let state = createGame(module_, 1);
    expect(isFlagSet(state, 'nope')).toBe(false);
    state = setFlag(state, 'a', false);
    expect(isFlagSet(state, 'a')).toBe(false);
    state = setFlag(state, 'b', 0);
    expect(isFlagSet(state, 'b')).toBe(false);
  });

  it('treats true and non-zero numbers as set', () => {
    let state = setFlag(createGame(module_, 1), 'a', true);
    state = setFlag(state, 'b', 3);
    expect(isFlagSet(state, 'a')).toBe(true);
    expect(isFlagSet(state, 'b')).toBe(true);
  });

  it('clears by deleting the key, leaving no tombstone in the save', () => {
    let state = setFlag(createGame(module_, 1), 'a', true);
    state = clearFlag(state, 'a');
    expect(isFlagSet(state, 'a')).toBe(false);
    expect('a' in state.flags).toBe(false);
  });
});

describe('visited and fired ledgers', () => {
  it('marks visited without duplicating', () => {
    let state = createGame(module_, 1);
    state = markVisited(state, 'shed');
    state = markVisited(state, 'shed');
    expect(state.visited).toEqual(['road', 'shed']);
    expect(hasVisited(state, 'shed')).toBe(true);
  });

  it('marks events fired without duplicating', () => {
    let state = markFired(createGame(module_, 1), 'reveal-key');
    state = markFired(state, 'reveal-key');
    expect(state.firedEvents).toEqual(['reveal-key']);
    expect(hasFired(state, 'reveal-key')).toBe(true);
  });

  it('returns the same object when nothing changes', () => {
    const state = markVisited(createGame(module_, 1), 'road');
    expect(state.visited).toEqual(['road']);
  });
});

describe('creatures', () => {
  it('lists only active creatures at the player location', () => {
    const state = { ...createGame(module_, 1), locationId: 'entry-hall' };
    expect(creaturesHere(module_, state).map((c) => c.id)).toEqual(['pale-newt']);
  });

  it('excludes an inactive creature even when co-located', () => {
    let state = { ...createGame(module_, 1), locationId: 'twisty-1' };
    state = setCreatureState(state, 'cave-rat', { locationId: 'twisty-1' });
    expect(creaturesHere(module_, state)).toEqual([]);
    state = setCreatureState(state, 'cave-rat', { active: true });
    expect(creaturesHere(module_, state).map((c) => c.id)).toEqual(['cave-rat']);
  });

  it('ignores a patch for an unknown creature rather than inventing one', () => {
    const state = createGame(module_, 1);
    expect(setCreatureState(state, 'no-such-creature', { active: true })).toBe(state);
  });
});

describe('achievements', () => {
  it('adds without duplicating', () => {
    let state = addAchievement(createGame(module_, 1), 'first-treasure');
    state = addAchievement(state, 'first-treasure');
    expect(state.achievements).toEqual(['first-treasure']);
  });
});

describe('currentLocation', () => {
  it('resolves the player location', () => {
    expect(currentLocation(module_, createGame(module_, 1)).id).toBe('road');
  });

  it('throws on an impossible location — that is an engine bug, not content', () => {
    const state = { ...createGame(module_, 1), locationId: 'atlantis' };
    expect(() => currentLocation(module_, state)).toThrow(/engine invariant/);
  });
});
