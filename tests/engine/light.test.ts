import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAdventure } from '../../src/loader';
import type { AdventureModule } from '../../src/engine/schema';
import type { GameState } from '../../src/engine/types';
import { createGame, getItemState, setFlag, setItemLocation, setItemState } from '../../src/engine/state';
import { lightTick } from '../../src/engine/systems/light';
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

/** Lamp carried and lit, at a LIT location — no darkness risk in the way. */
function litLampAt(locationId: string, extra: Partial<GameState> = {}): GameState {
  let state = at(locationId, extra);
  state = setItemLocation(state, 'brass-lamp', 'inventory');
  state = setItemState(state, 'brass-lamp', { lit: true });
  return state;
}

function texts(events: { text: string }[]): string {
  return events.map((e) => e.text).join(' | ');
}

/**
 * The adventure's own lamp prose, read out of the module rather than written
 * here. Asserting against a literal would let the engine drift back to
 * hardcoding a line that merely happens to look similar; asserting against the
 * module's string is a claim about where the text CAME FROM, which is the
 * actual contract (`manifest.lamp.warnMessageId`/`exhaustMessageId`).
 */
function lampString(id: string): string {
  const text = module_.strings[id];
  if (text === undefined) throw new Error(`test-cave is missing the "${id}" string`);
  return text;
}

// manifest.lamp.warnAt is [40, 15, 5] and startFuel is 200 (adventures/test-cave/manifest.json).

describe('fuel burn', () => {
  it('burns one turn of fuel off a lit lamp', () => {
    const state = litLampAt('shed', { lampFuel: 100 });
    const [next] = lightTick(module_, state);
    expect(next.lampFuel).toBe(99);
  });

  it('does not burn fuel when the lamp is unlit', () => {
    const state = at('shed', { lampFuel: 100 }); // not carried, not lit
    const [next] = lightTick(module_, state);
    expect(next.lampFuel).toBe(100);
  });

  it('burns fuel even when the lit lamp has been left behind (not carried)', () => {
    // Same "lit but left behind" state T17's actions-lamp.test.ts exercises
    // for extinguish — a real flame does not care who is holding it.
    let state = at('shed', { lampFuel: 100 });
    state = setItemState(state, 'brass-lamp', { lit: true }); // lit, sitting at 'shed', uncarried
    const [next] = lightTick(module_, state);
    expect(next.lampFuel).toBe(99);
  });

  it('never burns fuel below zero', () => {
    const state = litLampAt('shed', { lampFuel: 0 });
    const [next] = lightTick(module_, state);
    expect(next.lampFuel).toBe(0);
  });
});

describe('fuel exhaustion', () => {
  it('forces the lamp out the instant fuel hits zero', () => {
    const state = litLampAt('shed', { lampFuel: 1 });
    const [next, events] = lightTick(module_, state);
    expect(next.lampFuel).toBe(0);
    expect(getItemState(next, 'brass-lamp').lit).toBe(false);
    expect(texts(events)).toContain(lampString('lamp-dead'));
  });

  it('a lamp already out at zero fuel produces no further exhaustion text', () => {
    const state = at('shed', { lampFuel: 0 }); // unlit, empty — nothing left to exhaust
    const [, events] = lightTick(module_, state);
    expect(texts(events)).not.toContain(lampString('lamp-dead'));
  });
});

describe('lamp warnings — each warnAt threshold fires exactly once', () => {
  it('fires the 40 threshold the turn fuel reaches it, and never again', () => {
    const crossing = litLampAt('shed', { lampFuel: 41 });
    const [afterCross, crossEvents] = lightTick(module_, crossing);
    expect(afterCross.lampFuel).toBe(40);
    expect(afterCross.lampWarned).toContain(40);
    expect(texts(crossEvents)).toContain(lampString('lamp-low'));

    // One more consumed turn at the same (now-warned) threshold: no repeat.
    const [afterAgain, againEvents] = lightTick(module_, afterCross);
    expect(afterAgain.lampFuel).toBe(39);
    expect(texts(againEvents)).not.toContain(lampString('lamp-low'));
  });

  it('does not fire a threshold the fuel has not reached yet', () => {
    const state = litLampAt('shed', { lampFuel: 100 });
    const [next, events] = lightTick(module_, state);
    expect(next.lampWarned).toEqual([]);
    expect(texts(events)).not.toContain(lampString('lamp-low'));
  });

  it('fires 40, 15, and 5 independently as fuel crosses each in turn', () => {
    let state = litLampAt('shed', { lampFuel: 41 });
    const seen: number[] = [];

    for (let i = 0; i < 40; i++) {
      const [next, events] = lightTick(module_, state);
      state = next;
      if (texts(events).includes(lampString('lamp-low'))) seen.push(state.lampFuel);
    }

    expect(seen).toEqual([40, 15, 5]);
    expect(state.lampWarned.sort((a, b) => a - b)).toEqual([5, 15, 40]);
  });

  it('takes its prose from the module, so a different adventure gets different words', () => {
    // The point of manifest.lamp.warnMessageId/exhaustMessageId: an adventure
    // whose light source is a torch must not be told its lamp is guttering.
    // Swapping the strings under a module the engine has never seen before is
    // the only assertion that distinguishes "reads the string table" from
    // "hardcodes a line that happens to match test-cave's" — every other test
    // here would pass against either.
    const torchCave: AdventureModule = {
      ...module_,
      strings: { ...module_.strings, 'lamp-low': 'The torch is burning down.', 'lamp-dead': 'The torch is ash.' },
    };

    const [, warnEvents] = lightTick(torchCave, litLampAt('shed', { lampFuel: 41 }));
    expect(texts(warnEvents)).toContain('The torch is burning down.');

    const [, deadEvents] = lightTick(torchCave, litLampAt('shed', { lampFuel: 1 }));
    expect(texts(deadEvents)).toContain('The torch is ash.');

    // And nothing of the engine's own invention rides along with them.
    expect(texts(warnEvents)).not.toMatch(/lamp/i);
    expect(texts(deadEvents)).not.toMatch(/lamp/i);
  });

  it('does not warn again for a threshold already crossed once the lamp is relit', () => {
    // lampWarned survives independent of the lamp's current lit state — it is
    // per-game, not per-burn (GameState.lampWarned, T11).
    let state = litLampAt('shed', { lampFuel: 41 });
    [state] = lightTick(module_, state); // crosses 40, fuel now 40
    expect(state.lampWarned).toContain(40);

    state = setItemState(state, 'brass-lamp', { lit: false });
    state = { ...state, lampFuel: 40 }; // re-set to the same threshold value
    state = setItemState(state, 'brass-lamp', { lit: true });
    const [, events] = lightTick(module_, state);
    expect(texts(events)).not.toContain(lampString('lamp-low'));
  });
});

describe('darkness danger — forced by seed choice, never by stubbing RNG', () => {
  /**
   * Seeds computed directly against rng.ts's mulberry32 (see the commit for
   * the derivation): seed 0's first draw is 0.246... < manifest.darkness's
   * 0.3 deathChance (a hit); seed 1's first draw is >= 0.3 (a miss). Neither
   * state carries a lit lamp, so `low-passage` (a `dark` location) leaves the
   * player genuinely unable to see, and darkness danger is the ONLY RNG draw
   * a bare `wait`-shaped tick makes here.
   */
  function unlitInTheDark(rng: number): GameState {
    return at('low-passage', { rng });
  }

  it('kills at a seed whose draw lands under deathChance', () => {
    const [next, events] = lightTick(module_, unlitInTheDark(0));
    expect(next.ended).toBeUndefined(); // ended is engine.ts's job (T20), not light's
    expect(events.some((e) => e.kind === 'death')).toBe(true);
  });

  it('the death event carries the adventure\'s own dark-death string, not engine prose', () => {
    const [, events] = lightTick(module_, unlitInTheDark(0));
    const deathText = module_.strings[module_.manifest.darkness.deathMessageId];
    expect(deathText).toBeDefined();
    expect(texts(events)).toContain(deathText);
  });

  it('sets DIED_THIS_TURN so the turn pipeline (not this system) handles the penalty', () => {
    const [next] = lightTick(module_, unlitInTheDark(0));
    expect(next.flags[DIED_THIS_TURN]).toBe(true);
  });

  it('survives at a seed whose draw lands over deathChance', () => {
    const [next, events] = lightTick(module_, unlitInTheDark(1));
    expect(events.some((e) => e.kind === 'death')).toBe(false);
    expect(next.flags[DIED_THIS_TURN]).toBeUndefined();
  });

  it('draws no RNG at all when the player can see', () => {
    // Same "killing" seed, but at a LIT location: the roll must never happen.
    const state = at('shed', { rng: 0 });
    const [next, events] = lightTick(module_, state);
    expect(next.rng).toBe(0);
    expect(events.some((e) => e.kind === 'death')).toBe(false);
  });

  it('draws no RNG at all once carrying a lit lamp into the dark', () => {
    const state = litLampAt('low-passage', { rng: 0 }); // seed 0 would kill if drawn
    const [next, events] = lightTick(module_, state);
    expect(next.rng).toBe(0);
    expect(events.some((e) => e.kind === 'death')).toBe(false);
  });

  it('does not stack a second death if the player already died earlier this turn', () => {
    // e.g. an event or the `jump` verb killed them before `light` runs
    // (worldTick's fixed events → creatures → light → scoring order).
    let state = unlitInTheDark(0); // a seed that WOULD kill if the roll ran
    state = setFlag(state, DIED_THIS_TURN, true);
    const [next, events] = lightTick(module_, state);
    expect(events.some((e) => e.kind === 'death')).toBe(false);
    expect(next.rng).toBe(0); // the guard returns before the roll ever draws
  });
});

describe('wired into the turn pipeline (engine.ts worldTick)', () => {
  it('burns fuel on a consumed turn', () => {
    const before = litLampAt('shed', { lampFuel: 100 });
    const { state } = step(module_, before, 'wait');
    expect(state.lampFuel).toBe(99);
  });

  it('does not burn fuel on a turn that was not consumed (a parse error)', () => {
    const before = litLampAt('shed', { lampFuel: 100 });
    const { state } = step(module_, before, 'frobnicate');
    expect(state.lampFuel).toBe(100);
  });

  it('a fuel warning surfaces through step()\'s output events', () => {
    const before = litLampAt('shed', { lampFuel: 41 });
    const { events } = step(module_, before, 'wait');
    expect(texts(events)).toContain(lampString('lamp-low'));
  });

  it('kills the player through the full pipeline at a losing seed, reincarnation and all', () => {
    const before = at('low-passage', { rng: 0, score: 10 });
    const { state, events } = step(module_, before, 'wait');
    expect(events.some((e) => e.kind === 'death')).toBe(true);
    expect(state.deaths).toBe(1);
    expect(state.locationId).toBe(module_.manifest.startLocation);
    // Reincarnation text is engine.ts's handleDeath, wired the same way for
    // every death regardless of cause.
    expect(texts(events)).toMatch(/puts you back where you started/i);
  });

  it('leaves the player be through the full pipeline at a surviving seed', () => {
    const before = at('low-passage', { rng: 1 });
    const { state, events } = step(module_, before, 'wait');
    expect(events.some((e) => e.kind === 'death')).toBe(false);
    expect(state.locationId).toBe('low-passage');
  });
});
