import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAdventure } from '../src/loader';
import type { AdventureModule } from '../src/engine/schema';
import type { GameState, OutputEvent } from '../src/engine/types';
import {
  createGame,
  getCreatureState,
  isCarrying,
  itemLocation,
  setCreatureState,
  setItemLocation,
  setItemState,
} from '../src/engine/state';
import { step } from '../src/engine/engine';
import { creatureTick } from '../src/engine/systems/creatures';
import { rankFor } from '../src/engine/systems/scoring';
import { suggestions } from '../src/engine/view';

// ─────────────────────────────────────────────────────────────────────────────
// Content integration tests for Hollowdeep (hollowdeep-implementation-plan.md
// T10), driving the REAL `adventures/hollowdeep` module through the real
// engine. `tests/walkthrough.test.ts` already proves the one true winning
// path reaches a perfect score at every seed; this file is the rest of the
// content — the second ending, the eight ways to die (design plan §12.5), the
// thief, the KIBBLE shortcut, the FR-1.9 suggestion boundary, and the maze as
// data (§11.3) — none of which the single scripted walkthrough exercises.
//
// Style follows tests/engine/creatures.test.ts and tests/engine/timers.test.ts:
// state SURGERY over long command scripts wherever surgery is clearer, real
// `step()` for anything that has to go through the actual turn pipeline, and
// RNG forced by PINNED SEED CHOICE rather than stubbed. Both draws this file
// depends on (darkness's 0.3 deathChance, the stalker's 0.3 aggression) use
// the same pinned pair rng.ts's tests already establish: mulberry32's first
// draw from raw state 0 is ~0.2664 (a hit under 0.3) and from raw state 1 is
// ~0.6271 (a miss) — see tests/engine/creatures.test.ts and
// tests/engine/light.test.ts for the derivation. Hollowdeep's own
// `manifest.json` darkness.deathChance and `creatures.json`'s stalker
// aggression are BOTH 0.3, so the same pinned pair (rng: 0 kills, rng: 1
// survives) works for either roll without re-deriving anything.
// ─────────────────────────────────────────────────────────────────────────────

const MODULE_DIR = path.resolve(import.meta.dirname, '../adventures/hollowdeep');

let module_: AdventureModule;
let start: GameState;

beforeAll(async () => {
  module_ = await loadAdventure(
    (p) => readFile(p, 'utf8'),
    MODULE_DIR,
    (dir) => readdir(dir),
  );
  start = createGame(module_, 12345);
});

/** All twelve treasures (items.json), the-kept included. */
const ALL_TREASURES = [
  'payroll-tin',
  'cut-garnets',
  'assay-button',
  'foremans-watch',
  'silver-flowstone',
  'cave-pearls',
  'weir-nugget',
  'miners-cache',
  'bronze-tool',
  'tally-plate',
  'warm-stone',
  'the-kept',
];

/** The eleven "bankable" treasures — everything except the-kept, which ending B leaves on its plinth. */
const ELEVEN_TREASURES = ALL_TREASURES.filter((id) => id !== 'the-kept');

function at(locationId: string, extra: Partial<GameState> = {}): GameState {
  return { ...start, locationId, ...extra };
}

/** Lamp carried and lit — the only thing that lets scope resolve anything in a `dark` room. */
function litLampAt(locationId: string, extra: Partial<GameState> = {}): GameState {
  let state = at(locationId, extra);
  state = setItemLocation(state, 'brass-lantern', 'inventory');
  state = setItemState(state, 'brass-lantern', { lit: true });
  return state;
}

function texts(events: OutputEvent[]): string {
  return events.map((e) => e.text).join(' | ');
}

/** The adventure's own prose, read out of the module — a claim about where the text CAME FROM. */
function moduleString(id: string): string {
  const text = module_.strings[id];
  if (text === undefined) throw new Error(`hollowdeep is missing the "${id}" string`);
  return text;
}

/** Run the same consumed command `n` times, returning the final state and the LAST turn's events. */
function playN(startState: GameState, cmd: string, n: number): { state: GameState; lastEvents: OutputEvent[] } {
  let state = startState;
  let lastEvents: OutputEvent[] = [];
  for (let i = 0; i < n; i++) {
    const result = step(module_, state, cmd);
    state = result.state;
    lastEvents = result.events;
  }
  return { state, lastEvents };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Ending B — "Kept the Seal" (the vault sealed from the inside).
// ─────────────────────────────────────────────────────────────────────────────

describe('ending B: sealing the vault', () => {
  function readyToSeal(): GameState {
    let state = litLampAt('the-vault'); // dark room — seal vault needs light to resolve "vault" at all
    for (const id of ELEVEN_TREASURES) state = setItemLocation(state, id, 'assay-office');
    // the-kept is left exactly where it started: on its plinth, in the-vault.
    return state;
  }

  it('eleven banked, the twelfth left on its plinth, seal vault -> victory, without tripping ending A', () => {
    const before = readyToSeal();
    expect(itemLocation(before, 'the-kept')).toBe('the-vault');

    const { state: after, events } = step(module_, before, 'seal vault');

    expect(texts(events)).toContain(moduleString('ending-b-epilogue'));
    expect(after.ended?.victory).toBe(true);
    expect(after.achievements).toContain('kept-the-seal');

    // Ending A ("The Full Ledger") is a DIFFERENT ending, gated on the-kept
    // being banked in the assay office rather than left in the vault. It must
    // not have fired just because the eleven bankable treasures did.
    expect(after.flags['ledger-complete']).toBeUndefined();
    expect(after.achievements).not.toContain('the-full-ledger');

    // the-kept itself never moved — that is the whole point of this ending.
    expect(itemLocation(after, 'the-kept')).toBe('the-vault');
  });

  it('does not fire with the-kept missing from the vault (an eleven-only ledger is not this ending)', () => {
    let before = readyToSeal();
    before = setItemLocation(before, 'the-kept', 'inventory'); // carried off, not left behind

    const { state: after, events } = step(module_, before, 'seal vault');
    expect(after.ended).toBeUndefined();
    expect(after.achievements).not.toContain('kept-the-seal');
    expect(texts(events)).not.toContain(moduleString('ending-b-epilogue'));
  });

  it("pins the rank ladder at the ending-B milestone score (scoring.json's minScore: 310 entry)", () => {
    // A real 310 only happens at the end of a full run (tests/walkthrough.test.ts
    // exercises that); this just holds the ladder itself steady so a future
    // edit to scoring.json's rank table is caught here rather than only by
    // drift in a much longer, harder-to-read test.
    expect(rankFor(module_, 310)).toBe('Keeper of the Seal');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The eight deaths (design plan §12.5), each fired, telegraphed where the
//    design telegraphs it, and shown to leave the world winnable afterward.
// ─────────────────────────────────────────────────────────────────────────────

describe('death 1: darkness', () => {
  it('an unlit step into the dark kills at a losing-seed draw (rng 0, deathChance 0.3)', () => {
    const before = at('stables', { rng: 0 }); // dark; lamp carried but never lit
    const { state, events } = step(module_, before, 'wait');

    expect(events.some((e) => e.kind === 'death')).toBe(true);
    expect(texts(events)).toContain(moduleString('dark-death'));
    expect(state.deaths).toBe(1);
    expect(state.score).toBe(0); // 0 - deathPenalty, floored
    expect(state.locationId).toBe(module_.manifest.startLocation);
  });

  it('survives at the paired miss seed (rng 1)', () => {
    const before = at('stables', { rng: 1 });
    const { state, events } = step(module_, before, 'wait');
    expect(events.some((e) => e.kind === 'death')).toBe(false);
    expect(state.deaths).toBe(0);
  });
});

describe('death 2: the roof-fall (the stull)', () => {
  it('use stull telegraphs "six good breaths" and arms the timer without killing yet', () => {
    const state = litLampAt('stull-gallery');
    const { state: armed, events } = step(module_, state, 'use stull');
    expect(texts(events)).toContain('six good breaths');
    expect(armed.deaths).toBe(0);
    expect(itemLocation(armed, 'cut-garnets')).toBe('stull-gallery'); // now lying free for the taking
  });

  it('staying for all six further turns brings the roof down, and buries the garnets left behind', () => {
    let state = litLampAt('stull-gallery');
    state = step(module_, state, 'use stull').state;

    const { state: after, lastEvents } = playN(state, 'wait', 6);
    expect(after.deaths).toBe(1);
    expect(texts(lastEvents)).toContain(moduleString('roof-fall-death'));
    expect(after.locationId).toBe(module_.manifest.startLocation);
    expect(after.flags['garnets-buried']).toBe(true);
    expect(itemLocation(after, 'cut-garnets')).toBe('nowhere');
    // Possessions — the lamp included — scatter where you fell.
    expect(itemLocation(after, 'brass-lantern')).toBe('stull-gallery');

    // The world stays winnable: walk back, retrieve the lamp, search the rubble.
    let back = { ...after, locationId: 'stull-gallery' };
    back = setItemLocation(back, 'brass-lantern', 'inventory'); // pick the lamp back up (still lit)
    const recovered = step(module_, back, 'search rubble');
    expect(itemLocation(recovered.state, 'cut-garnets')).toBe('stull-gallery');
    expect(texts(recovered.events)).toMatch(/garnet pouch/i);
  });

  it('escaping the gallery before the sixth turn leaves it settling behind you, unharmed', () => {
    let state = litLampAt('stull-gallery');
    state = step(module_, state, 'use stull').state; // further turn 0 (the arming action itself)
    state = step(module_, state, 'n').state; // long-drift — further turn 1

    const { state: after, lastEvents } = playN(state, 'wait', 5); // further turns 2..6
    expect(after.deaths).toBe(0);
    expect(texts(lastEvents)).toContain('mountain sitting down');
    // Nobody was there to take the garnets either, so the mountain keeps them.
    expect(after.flags['garnets-buried']).toBe(true);
  });
});

describe('death 3: the gour-flood (the cave pearls)', () => {
  it('take pearls telegraphs "five turns of the glass" and arms the flood', () => {
    const state = litLampAt('gour-pools');
    const { state: armed, events } = step(module_, state, 'take pearls');
    expect(texts(events)).toContain('five turns of the glass');
    expect(armed.deaths).toBe(0);
    expect(isCarrying(armed, 'cave-pearls')).toBe(true);
  });

  it('staying at the pools for all five further turns drowns the player', () => {
    let state = litLampAt('gour-pools');
    state = step(module_, state, 'take pearls').state;

    const { state: after, lastEvents } = playN(state, 'wait', 5);
    expect(after.deaths).toBe(1);
    expect(texts(lastEvents)).toContain(moduleString('gour-flood-death'));
    // Scattered where you fell — still recoverable, the chain still closes.
    expect(itemLocation(after, 'cave-pearls')).toBe('gour-pools');
  });

  it('escaping to the cathedral before the flood settles it quietly, unharmed', () => {
    let state = litLampAt('gour-pools');
    state = step(module_, state, 'take pearls').state; // further turn 0
    state = step(module_, state, 'w').state; // cathedral — further turn 1

    const { state: after, lastEvents } = playN(state, 'wait', 4); // further turns 2..5
    expect(after.deaths).toBe(0);
    expect(texts(lastEvents)).toContain('taking their room back');
  });
});

describe('death 4: the powder keg', () => {
  it('reads its own warning label', () => {
    const state = litLampAt('magazine'); // keg starts here
    const { events } = step(module_, state, 'read keg');
    expect(texts(events)).toContain('NOT WITHOUT A FUSE, DAVEY');
  });

  it('using it anywhere but the breach kills instantly, and the keg survives the fall', () => {
    let before = at('coach-road'); // lit; the keg-death list covers every other location too
    before = setItemLocation(before, 'powder-keg', 'inventory');

    const { state: after, events } = step(module_, before, 'use keg');
    expect(after.deaths).toBe(1);
    expect(texts(events)).toContain(moduleString('keg-death'));
    // Scattered where it fell — not destroyed, so it can still be recovered and placed.
    expect(itemLocation(after, 'powder-keg')).toBe('coach-road');
  });

  it('is safe at the breach wall, where it belongs', () => {
    let before = litLampAt('breach-wall');
    before = setItemLocation(before, 'powder-keg', 'inventory');

    const { state: after, events } = step(module_, before, 'use keg');
    expect(after.deaths).toBe(0);
    expect(texts(events)).not.toContain(moduleString('keg-death'));
    expect(after.flags['powder-placed']).toBe(true);
  });
});

describe('death 5: the ore chute', () => {
  it('warns once ("consider yourself warned"), then kills the second attempt', () => {
    const state = litLampAt('ore-chute');

    const warn = step(module_, state, 'use chute');
    expect(texts(warn.events)).toContain('Consider yourself warned');
    expect(warn.state.flags['chute-warned']).toBe(true);
    expect(warn.state.deaths).toBe(0);

    const death = step(module_, warn.state, 'use chute');
    expect(death.state.deaths).toBe(1);
    expect(texts(death.events)).toContain(moduleString('chute-death'));
  });
});

describe('death 6: the Black River', () => {
  it('warns once ("nothing native to this river swims the middle"), then kills the second attempt', () => {
    const state = litLampAt('black-river');

    const warn = step(module_, state, 'swim');
    expect(texts(warn.events)).toContain('Nothing native to this river swims the middle');
    expect(warn.state.flags['swim-warned']).toBe(true);
    expect(warn.state.deaths).toBe(0);

    const death = step(module_, warn.state, 'swim');
    expect(death.state.deaths).toBe(1);
    expect(texts(death.events)).toContain(moduleString('swim-death'));
  });
});

describe('death 7: the stair gap', () => {
  it('jumping kills immediately — the room prose is the only telegraph this one gets', () => {
    const state = litLampAt('long-stair');
    const { state: after, events } = step(module_, state, 'jump');
    expect(after.deaths).toBe(1);
    expect(texts(events)).toContain(moduleString('jump-death'));
  });
});

describe('death 8: the stalker', () => {
  /**
   * activatedTurn === turn keeps turnsSince at 0, so movement never runs and
   * the location set here is exactly what the tick sees — the same shape
   * tests/engine/creatures.test.ts's `encounterAt` uses for test-cave's
   * cave-rat, against hollowdeep's own 0.3 aggression instead of 0.35. Lamp
   * lit so darkness itself never rolls, isolating the aggression draw.
   */
  function unwardedEncounter(rng: number): GameState {
    let state = litLampAt('cathedral', { turn: 30, rng });
    state = setCreatureState(state, 'stalker', {
      locationId: 'cathedral',
      active: true,
      activatedTurn: 30,
      encounterTurns: 0,
    });
    return state;
  }

  it('kills an unwarded player at a losing-seed encounter roll (rng 0, aggression 0.3)', () => {
    const { state: after, events } = step(module_, unwardedEncounter(0), 'wait');
    expect(after.deaths).toBe(1);
    expect(texts(events)).toContain(moduleString('stalker-death'));
  });

  it('survives at the paired miss seed (rng 1)', () => {
    const { state: after } = step(module_, unwardedEncounter(1), 'wait');
    expect(after.deaths).toBe(0);
  });

  it('the canary wards it off completely, even at the same losing seed', () => {
    let state = unwardedEncounter(0);
    state = setItemLocation(state, 'canary-cage', 'inventory');
    const { state: after } = step(module_, state, 'wait');
    expect(after.deaths).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. The thief — deterministic, exactly-once, everything to the midden.
// ─────────────────────────────────────────────────────────────────────────────

describe('the thief', () => {
  function armedThief(turn: number, activatedTurn: number, rng = 0): GameState {
    let state = at('breakthrough', { turn, rng });
    state = setCreatureState(state, 'thief', { active: true, activatedTurn });
    state = setItemLocation(state, 'weir-nugget', 'inventory');
    state = setItemLocation(state, 'cave-pearls', 'inventory');
    return state;
  }

  it('activates once breakthrough has been visited — a bare flag check, wherever the player stands', () => {
    const state = at('coach-road', { visited: [...start.visited, 'breakthrough'] });
    const [next] = creatureTick(module_, state);
    const cs = getCreatureState(next, 'thief');
    expect(cs?.active).toBe(true);
    expect(cs?.activatedTurn).toBe(state.turn);
  });

  it('does not steal before the 25th further turn (stealAfterTurns, creatures.json)', () => {
    const state = armedThief(24, 0);
    const [next] = creatureTick(module_, state);
    expect(isCarrying(next, 'weir-nugget')).toBe(true);
    expect(getCreatureState(next, 'thief')?.hasStolen).toBe(false);
  });

  it('steals every carried treasure exactly 25 turns after activation, stashing it all in the midden', () => {
    const state = armedThief(25, 0);
    const [next, events] = creatureTick(module_, state);
    expect(itemLocation(next, 'weir-nugget')).toBe('midden');
    expect(itemLocation(next, 'cave-pearls')).toBe('midden');
    expect(getCreatureState(next, 'thief')?.hasStolen).toBe(true);
    expect(texts(events)).toContain(moduleString('thief-robbery'));
  });

  it('fires on schedule even carrying nothing at all — the timer is the mechanism, not a snapshot at activation', () => {
    let state = at('breakthrough', { turn: 25 });
    state = setCreatureState(state, 'thief', { active: true, activatedTurn: 0 });
    const [next, events] = creatureTick(module_, state);
    expect(getCreatureState(next, 'thief')?.hasStolen).toBe(true);
    expect(events).toEqual([]); // nothing carried, nothing taken, nothing said
  });

  it('never fires twice, even after the goods are carried again later', () => {
    let [state] = creatureTick(module_, armedThief(25, 0));
    expect(getCreatureState(state, 'thief')?.hasStolen).toBe(true);
    state = setItemLocation(state, 'weir-nugget', 'inventory');
    state = { ...state, turn: 200 };
    const [next] = creatureTick(module_, state);
    expect(itemLocation(next, 'weir-nugget')).toBe('inventory'); // not re-stolen
  });

  it('draws no RNG, and produces byte-identical outcomes across several seeds', () => {
    const seeds = [0, 1, 2, 12345, 999999];
    const outcomes = seeds.map((rng) => {
      const state = armedThief(25, 0, rng);
      const [next] = creatureTick(module_, state);
      return {
        rng: next.rng,
        stolen: getCreatureState(next, 'thief')?.hasStolen,
        nugget: itemLocation(next, 'weir-nugget'),
        pearls: itemLocation(next, 'cave-pearls'),
      };
    });
    seeds.forEach((seed, i) => expect(outcomes[i]?.rng).toBe(seed)); // untouched — the seed itself
    const withoutRng = outcomes.map(({ rng: _rng, ...rest }) => rest);
    for (const outcome of withoutRng.slice(1)) expect(outcome).toEqual(withoutRng[0]);
  });
});

describe('the midden and its curator', () => {
  it('entering the midden with everything ever carried awards Everything You Carried', () => {
    let state = litLampAt('river-strand'); // e -> midden
    for (const id of ALL_TREASURES) state = setItemLocation(state, id, 'midden');

    const { state: entered, events } = step(module_, state, 'e');
    expect(entered.achievements).toContain('everything-you-carried');
    expect(texts(events)).toContain('Achievement unlocked: Everything You Carried.');
  });

  it('deposit points still pay out once a stolen treasure is recovered and banked', () => {
    let state = litLampAt('river-strand');
    for (const id of ALL_TREASURES) state = setItemLocation(state, id, 'midden');
    const entered = step(module_, state, 'e').state;

    // Recovered by hand, carried up to the assay office, and banked.
    let atOffice = setItemLocation(entered, 'weir-nugget', 'inventory');
    atOffice = { ...atOffice, locationId: 'assay-office' };
    const before = atOffice.score;

    const deposited = step(module_, atOffice, 'drop nugget');
    expect(deposited.state.score - before).toBe(15); // weir-nugget's depositPoints (items.json)
    expect(texts(deposited.events)).toContain('You score 15');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. KIBBLE bypasses the pump gate entirely — a real walk, never touching the
//    pump or its handle, proving the word is location-gated only.
// ─────────────────────────────────────────────────────────────────────────────

describe('KIBBLE bypasses the pump gate', () => {
  it('reaches shaft-head without the pump or its handle, and kibble still works', () => {
    let state = createGame(module_, 20260716);
    const route = ['light lamp', 'e', 'ne', 'up', 'e', 'e', 'e', 'e'];
    for (const cmd of route) {
      state = step(module_, state, cmd).state;
    }

    expect(state.locationId).toBe('shaft-head');
    expect(state.deaths).toBe(0);
    expect(state.flags['pump-fixed']).toBeUndefined();
    expect(state.flags['pump-drained']).toBeUndefined();
    // The winze is still full — the ladderway down is still blocked.
    expect(step(module_, state, 'd').state.locationId).toBe('shaft-head');

    const { state: after } = step(module_, state, 'kibble');
    expect(after.locationId).toBe('shaft-foot');
    expect(after.flags['pump-drained']).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. FR-1.9 — magic words are never completions, at any prefix, even where a
//    real noun would otherwise collide.
// ─────────────────────────────────────────────────────────────────────────────

describe('suggestions never complete the magic words (FR-1.9)', () => {
  it('never offers "kibble", even where "key" is a real, colliding noun in scope', () => {
    const state = at('chapel'); // key-office hangs here
    for (const prefix of ['k', 'ki', 'kib', 'kibb', 'kibbl']) {
      expect(suggestions(module_, state, prefix)).not.toContain('kibble');
    }
    // Sanity: the collision is real, not a vacuous prefix with nothing to hide behind.
    expect(suggestions(module_, state, 'k')).toContain('key');
  });

  it('never offers "gunnis", even where "garnets" is a real, colliding noun in scope', () => {
    let state = litLampAt('stull-gallery'); // dark — needs light for the item to be in scope at all
    state = setItemLocation(state, 'cut-garnets', 'stull-gallery');
    for (const prefix of ['g', 'gu', 'gun', 'gunn', 'gunni']) {
      expect(suggestions(module_, state, prefix)).not.toContain('gunnis');
    }
    expect(suggestions(module_, state, 'g')).toContain('garnets');
  });

  it('holds even at the locations where the words actually do something', () => {
    for (const locationId of ['shaft-head', 'shaft-foot', 'broken-drift', 'the-gunnis']) {
      const state = at(locationId);
      expect(suggestions(module_, state, 'kib')).not.toContain('kibble');
      expect(suggestions(module_, state, 'gun')).not.toContain('gunnis');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. The maze as data (design plan §11.3) — connectivity and the table itself.
// ─────────────────────────────────────────────────────────────────────────────

describe('the maze — connectivity and the exact §11.3 table', () => {
  type TwistyExits = Partial<Record<'n' | 'e' | 's' | 'w' | 'up', string>>;

  /** Design plan §11.3's table, transcribed verbatim — bold self-loops included. */
  const TWISTY_TABLE: Record<string, TwistyExits> = {
    'twisty-1': { n: 'twisty-2', e: 'twisty-4', s: 'twisty-3', w: 'twisty-1', up: 'cathedral' },
    'twisty-2': { n: 'twisty-4', e: 'twisty-5', s: 'twisty-1', w: 'twisty-2' },
    'twisty-3': { n: 'twisty-1', e: 'twisty-6', s: 'twisty-3', w: 'twisty-4' },
    'twisty-4': { n: 'twisty-1', e: 'twisty-2', s: 'twisty-3', w: 'twisty-5' },
    'twisty-5': { n: 'twisty-2', e: 'breach-wall', s: 'twisty-4', w: 'twisty-5' },
    'twisty-6': { w: 'twisty-3' },
  };

  function findLoc(id: string) {
    const loc = module_.locations.find((l) => l.id === id);
    if (loc === undefined) throw new Error(`hollowdeep is missing location "${id}"`);
    return loc;
  }

  it('every twisty room\'s exits match the design plan\'s table exactly, self-loops included', () => {
    for (const [id, expected] of Object.entries(TWISTY_TABLE)) {
      const loc = findLoc(id);
      const actual: TwistyExits = {};
      for (const dir of ['n', 'e', 's', 'w', 'up'] as const) {
        const exit = loc.exits[dir];
        if (exit !== undefined) actual[dir] = exit.to;
      }
      expect(actual, `twisty room "${id}"`).toEqual(expected);
    }
  });

  it('every twisty room is reachable from twisty-1 over the maze subgraph alone', () => {
    // BFS using only n/e/s/w edges that stay inside the maze (twisty-* targets) —
    // `up` (to the cathedral) and twisty-5's `e` (out to breach-wall) both leave
    // the subgraph and are deliberately excluded from the walk.
    const seen = new Set<string>(['twisty-1']);
    let frontier = ['twisty-1'];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const id of frontier) {
        const loc = findLoc(id);
        for (const dir of ['n', 'e', 's', 'w'] as const) {
          const to = loc.exits[dir]?.to;
          if (to !== undefined && to.startsWith('twisty-') && !seen.has(to)) {
            seen.add(to);
            next.push(to);
          }
        }
      }
      frontier = next;
    }
    expect([...seen].sort()).toEqual(['twisty-1', 'twisty-2', 'twisty-3', 'twisty-4', 'twisty-5', 'twisty-6']);
  });

  it('breach-wall is reachable only through twisty-5\'s east exit', () => {
    const leadingToBreach = Object.entries(TWISTY_TABLE).filter(([, exits]) => Object.values(exits).includes('breach-wall'));
    expect(leadingToBreach).toEqual([['twisty-5', TWISTY_TABLE['twisty-5']]]);
    expect(findLoc('twisty-5').exits.e?.to).toBe('breach-wall');
    // And the reverse: nothing outside the maze leads back in except that same pair.
    expect(findLoc('breach-wall').exits.w?.to).toBe('twisty-5');
  });
});
