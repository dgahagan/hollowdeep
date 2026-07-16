import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAdventure } from '../../src/loader';
import type { AdventureModule } from '../../src/engine/schema';
import type { GameState } from '../../src/engine/types';
import {
  createGame,
  getCreatureState,
  isCarrying,
  itemLocation,
  setCreatureState,
  setFlag,
  setItemLocation,
  setItemState,
} from '../../src/engine/state';
import { creatureTick } from '../../src/engine/systems/creatures';
import { DIED_THIS_TURN } from '../../src/engine/systems/events';
import { step } from '../../src/engine/engine';

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

function texts(events: { text: string }[]): string {
  return events.map((e) => e.text).join(' | ');
}

/**
 * The adventure's own prose, read out of the module rather than written here
 * — same reasoning as light.test.ts's `lampString`: asserting against the
 * module's string is a claim about where the text CAME FROM.
 */
function moduleString(id: string): string {
  const text = module_.strings[id];
  if (text === undefined) throw new Error(`test-cave is missing the "${id}" string`);
  return text;
}

// test-cave's three creatures (adventures/test-cave/creatures.json):
//   cave-rat        stalker, spawn.locations [twisty-1, twisty-2, grotto],
//                   afterTurn 30, moveEvery 3, aggression 0.35,
//                   wardOff.itemIds [brass-lamp], deathMessageId rat-death
//   shadow-packrat  thief, spawn.locations [twisty-2],
//                   spawn.if [{flag: packrat-armed}], stealsTreasure true,
//                   stashLocation twisty-2, stealAfterTurns 6,
//                   deathMessageId packrat-taunt (reused as the steal taunt)
//   pale-newt       static, spawn.locations [entry-hall], ungated

describe('spawn gating', () => {
  it('cave-rat stays inactive before its afterTurn', () => {
    const state = at('shed', { turn: 29 });
    const [next] = creatureTick(module_, state);
    expect(getCreatureState(next, 'cave-rat')?.active).toBe(false);
  });

  it('cave-rat activates the turn afterTurn is reached, stamping activatedTurn', () => {
    const state = at('shed', { turn: 30 });
    const [next] = creatureTick(module_, state);
    const cs = getCreatureState(next, 'cave-rat');
    expect(cs?.active).toBe(true);
    expect(cs?.activatedTurn).toBe(30);
  });

  it('shadow-packrat stays inactive without its activating flag', () => {
    const state = at('twisty-2', { turn: 5 });
    const [next] = creatureTick(module_, state);
    expect(getCreatureState(next, 'shadow-packrat')?.active).toBe(false);
  });

  it('shadow-packrat activates the moment its flag is set, stamping activatedTurn', () => {
    const state = setFlag(at('twisty-2', { turn: 5 }), 'packrat-armed', true);
    const [next] = creatureTick(module_, state);
    const cs = getCreatureState(next, 'shadow-packrat');
    expect(cs?.active).toBe(true);
    expect(cs?.activatedTurn).toBe(5);
  });

  it('pale-newt (static, ungated) is active from turn 0 with no tick needed', () => {
    expect(getCreatureState(start, 'pale-newt')?.active).toBe(true);
  });
});

describe('stalker movement — deterministic schedule, no RNG', () => {
  /** Player kept away from cave-rat's spawn locations so no encounter muddies the read. */
  function ratAt(locationId: string, turn: number, activatedTurn: number): GameState {
    let state = at('shed', { turn });
    state = setCreatureState(state, 'cave-rat', { locationId, active: true, activatedTurn, encounterTurns: 0 });
    return state;
  }

  it('does not move before moveEvery turns have passed since activation', () => {
    const state = ratAt('twisty-1', 32, 30); // turnsSince = 2, moveEvery = 3
    const [next] = creatureTick(module_, state);
    expect(getCreatureState(next, 'cave-rat')?.locationId).toBe('twisty-1');
  });

  it('does not move on the activation turn itself (turnsSince = 0)', () => {
    const state = ratAt('twisty-1', 30, 30);
    const [next] = creatureTick(module_, state);
    expect(getCreatureState(next, 'cave-rat')?.locationId).toBe('twisty-1');
  });

  it('moves to the next spawn location exactly every moveEvery turns', () => {
    const state = ratAt('twisty-1', 33, 30); // turnsSince = 3
    const [next] = creatureTick(module_, state);
    expect(getCreatureState(next, 'cave-rat')?.locationId).toBe('twisty-2');
  });

  it('keeps cycling on schedule from wherever it currently is', () => {
    const state = ratAt('twisty-2', 36, 30); // turnsSince = 6
    const [next] = creatureTick(module_, state);
    expect(getCreatureState(next, 'cave-rat')?.locationId).toBe('grotto');
  });

  it('wraps back to the first spawn location past the end of the list', () => {
    const state = ratAt('grotto', 39, 30); // turnsSince = 9
    const [next] = creatureTick(module_, state);
    expect(getCreatureState(next, 'cave-rat')?.locationId).toBe('twisty-1');
  });

  it('draws no RNG for movement alone', () => {
    const state = { ...ratAt('twisty-1', 33, 30), rng: 12345 };
    const [next] = creatureTick(module_, state);
    expect(next.rng).toBe(12345);
  });
});

describe('encounter bookkeeping', () => {
  it('increments encounterTurns each consecutive turn sharing a location with the player', () => {
    let state = at('grotto', { turn: 30 });
    state = setCreatureState(state, 'cave-rat', {
      locationId: 'grotto',
      active: true,
      activatedTurn: 30,
      encounterTurns: 0,
    });
    // Warded off so an aggression roll never disturbs the count under test.
    state = setItemLocation(state, 'brass-lamp', 'inventory');
    state = setItemState(state, 'brass-lamp', { lit: true });

    const [afterFirst] = creatureTick(module_, state);
    expect(getCreatureState(afterFirst, 'cave-rat')?.encounterTurns).toBe(1);

    const [afterSecond] = creatureTick(module_, afterFirst);
    expect(getCreatureState(afterSecond, 'cave-rat')?.encounterTurns).toBe(2);
  });

  it('resets to 0 the instant the creature no longer shares the player\'s location', () => {
    let state = at('shed', { turn: 30 });
    state = setCreatureState(state, 'cave-rat', {
      locationId: 'grotto',
      active: true,
      activatedTurn: 30,
      encounterTurns: 3,
    });
    const [next] = creatureTick(module_, state);
    expect(getCreatureState(next, 'cave-rat')?.encounterTurns).toBe(0);
  });
});

describe('stalker aggression — forced by seed choice, never stubbed', () => {
  /**
   * mulberry32's first draw from raw rng state 0 is ~0.2664, under cave-rat's
   * 0.35 aggression (a hit); from raw state 1 it is ~0.6271, over it (a miss).
   * Same derivation light.test.ts uses for darkness's deathChance, against a
   * different probability. `activatedTurn === turn` keeps turnsSince at 0, so
   * movement never runs and the location set here is exactly what the tick sees.
   */
  function encounterAt(rng: number): GameState {
    let state = at('grotto', { turn: 30, rng });
    state = setCreatureState(state, 'cave-rat', {
      locationId: 'grotto',
      active: true,
      activatedTurn: 30,
      encounterTurns: 0,
    });
    return state;
  }

  it('kills the player at a seed whose draw lands under aggression', () => {
    const [next, events] = creatureTick(module_, encounterAt(0));
    expect(next.flags[DIED_THIS_TURN]).toBe(true);
    expect(events.some((e) => e.kind === 'death')).toBe(true);
  });

  it('the kill carries the creature\'s own deathMessageId text, not engine prose', () => {
    const [, events] = creatureTick(module_, encounterAt(0));
    expect(texts(events)).toContain(moduleString('rat-death'));
  });

  it('survives at a seed whose draw lands over aggression', () => {
    const [next, events] = creatureTick(module_, encounterAt(1));
    expect(next.flags[DIED_THIS_TURN]).toBeUndefined();
    expect(events.some((e) => e.kind === 'death')).toBe(false);
  });

  it('draws no RNG at all when not sharing a location with the player', () => {
    let state = at('shed', { turn: 30, rng: 0 }); // a hit seed, but nobody there to hit
    state = setCreatureState(state, 'cave-rat', { locationId: 'grotto', active: true, activatedTurn: 30 });
    const [next] = creatureTick(module_, state);
    expect(next.rng).toBe(0);
  });

  it('a lit carried lamp wards the rat off completely — no roll at all, even at a hit seed', () => {
    let state = encounterAt(0);
    state = setItemLocation(state, 'brass-lamp', 'inventory');
    state = setItemState(state, 'brass-lamp', { lit: true });
    const [next, events] = creatureTick(module_, state);
    expect(next.rng).toBe(0); // untouched — the guard returns before the draw
    expect(next.flags[DIED_THIS_TURN]).toBeUndefined();
    expect(events.some((e) => e.kind === 'death')).toBe(false);
  });

  it('an UNLIT carried lamp does not ward — the fear is of the light, not the object', () => {
    const state = setItemLocation(encounterAt(0), 'brass-lamp', 'inventory'); // carried, not lit
    const [next] = creatureTick(module_, state);
    expect(next.flags[DIED_THIS_TURN]).toBe(true);
  });

  it('does not stack a second death if the player already died earlier this turn', () => {
    let state = encounterAt(0); // a seed that WOULD kill if the roll ran
    state = setFlag(state, DIED_THIS_TURN, true);
    const [next, events] = creatureTick(module_, state);
    expect(events.some((e) => e.kind === 'death')).toBe(false);
    expect(next.rng).toBe(0); // the guard returns before the roll ever draws
  });
});

describe('static creatures', () => {
  it('never move, act, or consume RNG', () => {
    const state = at('entry-hall', { rng: 999 });
    const [next, events] = creatureTick(module_, state);
    expect(getCreatureState(next, 'pale-newt')).toEqual(getCreatureState(state, 'pale-newt'));
    expect(next.rng).toBe(999);
    expect(events).toEqual([]);
  });
});

describe('thief theft — fully deterministic, draws NO RNG', () => {
  function armedThief(turn: number, activatedTurn: number, rng = 0): GameState {
    let state = at('grotto', { turn, rng });
    state = setCreatureState(state, 'shadow-packrat', { active: true, activatedTurn });
    state = setItemLocation(state, 'silver-chalice', 'inventory');
    state = setItemLocation(state, 'jade-idol', 'inventory');
    return state;
  }

  it('does not steal before stealAfterTurns has elapsed', () => {
    const state = armedThief(35, 30); // turnsSince = 5, stealAfterTurns = 6
    const [next] = creatureTick(module_, state);
    expect(itemLocation(next, 'silver-chalice')).toBe('inventory');
    expect(itemLocation(next, 'jade-idol')).toBe('inventory');
    expect(getCreatureState(next, 'shadow-packrat')?.hasStolen).toBe(false);
  });

  it('steals ALL carried treasure exactly stealAfterTurns turns after activation, stashing it in twisty-2', () => {
    const state = armedThief(36, 30); // turnsSince = 6
    const [next, events] = creatureTick(module_, state);
    expect(itemLocation(next, 'silver-chalice')).toBe('twisty-2');
    expect(itemLocation(next, 'jade-idol')).toBe('twisty-2');
    expect(getCreatureState(next, 'shadow-packrat')?.hasStolen).toBe(true);
    expect(texts(events)).toContain(moduleString('packrat-taunt'));
  });

  it('steals only what is actually carried, leaving already-deposited treasure alone', () => {
    let state = armedThief(36, 30);
    state = setItemLocation(state, 'silver-chalice', 'shed'); // deposited, not carried
    const [next] = creatureTick(module_, state);
    expect(itemLocation(next, 'silver-chalice')).toBe('shed'); // untouched
    expect(itemLocation(next, 'jade-idol')).toBe('twisty-2'); // the one still carried
  });

  it('never fires twice, even if the stolen goods are carried again later', () => {
    let [afterFirst] = creatureTick(module_, armedThief(36, 30));
    expect(getCreatureState(afterFirst, 'shadow-packrat')?.hasStolen).toBe(true);

    // Recover the chalice and try again much later.
    afterFirst = setItemLocation(afterFirst, 'silver-chalice', 'inventory');
    afterFirst = { ...afterFirst, turn: 100 };
    const [afterSecond] = creatureTick(module_, afterFirst);
    expect(itemLocation(afterSecond, 'silver-chalice')).toBe('inventory'); // not re-stolen
  });

  it('produces byte-identical results across several seeds — the no-RNG regression guard', () => {
    const seeds = [0, 1, 2, 12345, 999999];
    const results = seeds.map((rng) => {
      const state = armedThief(36, 30, rng);
      const [next, events] = creatureTick(module_, state);
      return {
        rng: next.rng,
        chalice: itemLocation(next, 'silver-chalice'),
        idol: itemLocation(next, 'jade-idol'),
        hasStolen: getCreatureState(next, 'shadow-packrat')?.hasStolen,
        text: texts(events),
      };
    });

    // The rng field itself must be untouched at every seed — the thief draws
    // nothing, so it stays exactly whatever it started as (the seed itself).
    seeds.forEach((seed, i) => expect(results[i]?.rng).toBe(seed));
    // And every seed produces exactly the same OUTCOME as the first — `rng`
    // excluded, since that field is trivially different by construction.
    const outcomes = results.map(({ rng: _rng, ...outcome }) => outcome);
    for (const outcome of outcomes.slice(1)) {
      expect(outcome).toEqual(outcomes[0]);
    }
  });
});

describe('creatures wired into the full pipeline (engine.ts worldTick, via step())', () => {
  it('the rat kills the player through the full pipeline at a losing seed, reincarnation and all', () => {
    let before = at('grotto', { rng: 0, turn: 29, score: 10 });
    before = setCreatureState(before, 'cave-rat', { locationId: 'grotto', active: true, activatedTurn: 30 });
    const { state, events } = step(module_, before, 'wait');
    expect(events.some((e) => e.kind === 'death')).toBe(true);
    expect(state.deaths).toBe(1);
    expect(state.locationId).toBe(module_.manifest.startLocation);
    expect(texts(events)).toMatch(/puts you back where you started/i);
  });

  it('the rat leaves the player be through the full pipeline at a surviving seed', () => {
    let before = at('grotto', { rng: 1, turn: 29 });
    before = setCreatureState(before, 'cave-rat', { locationId: 'grotto', active: true, activatedTurn: 30 });
    const { state, events } = step(module_, before, 'wait');
    expect(events.some((e) => e.kind === 'death')).toBe(false);
    expect(state.locationId).toBe('grotto');
  });

  it('the packrat activates on the first treasure carried, then steals it exactly stealAfterTurns turns later', () => {
    let state = at('grotto');
    let result = step(module_, state, 'take chalice');
    state = result.state;
    expect(getCreatureState(state, 'shadow-packrat')?.active).toBe(true);
    expect(isCarrying(state, 'silver-chalice')).toBe(true);

    // stealAfterTurns = 6: five more consumed turns, still no theft.
    for (let i = 0; i < 5; i++) {
      result = step(module_, state, 'wait');
      state = result.state;
    }
    expect(isCarrying(state, 'silver-chalice')).toBe(true);

    // The sixth turn: the theft fires, recoverable at twisty-2.
    result = step(module_, state, 'wait');
    state = result.state;
    expect(isCarrying(state, 'silver-chalice')).toBe(false);
    expect(itemLocation(state, 'silver-chalice')).toBe('twisty-2');
    expect(texts(result.events)).toContain(moduleString('packrat-taunt'));
    expect(getCreatureState(state, 'shadow-packrat')?.hasStolen).toBe(true);
  });

  it('never fires twice, even after the player recovers the goods', () => {
    let state = at('grotto');
    let result = step(module_, state, 'take chalice');
    state = result.state;
    for (let i = 0; i < 6; i++) {
      result = step(module_, state, 'wait');
      state = result.state;
    }
    expect(itemLocation(state, 'silver-chalice')).toBe('twisty-2');

    state = setItemLocation(state, 'silver-chalice', 'inventory');
    for (let i = 0; i < 10; i++) {
      result = step(module_, state, 'wait');
      state = result.state;
    }
    expect(itemLocation(state, 'silver-chalice')).toBe('inventory');
  });

  it('the activation-through-theft sequence is identical at several seeds', () => {
    function run(seed: number): { chalice: string; hasStolen: boolean | undefined } {
      let state: GameState = { ...createGame(module_, seed), locationId: 'grotto' };
      let result = step(module_, state, 'take chalice');
      state = result.state;
      for (let i = 0; i < 6; i++) {
        result = step(module_, state, 'wait');
        state = result.state;
      }
      return {
        chalice: itemLocation(state, 'silver-chalice'),
        hasStolen: getCreatureState(state, 'shadow-packrat')?.hasStolen,
      };
    }

    const seeds = [1, 2, 3, 42, 100000];
    const results = seeds.map(run);
    for (const result of results.slice(1)) {
      expect(result).toEqual(results[0]);
    }
    expect(results[0]?.chalice).toBe('twisty-2');
    expect(results[0]?.hasStolen).toBe(true);
  });
});
