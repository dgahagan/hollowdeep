import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAdventure } from '../../src/loader';
import type { AdventureModule, Effect } from '../../src/engine/schema';
import { EFFECT_KINDS } from '../../src/engine/schema';
import type { GameState } from '../../src/engine/types';
import { createGame, isFlagSet, itemLocation, setFlag, setItemLocation } from '../../src/engine/state';
import {
  applyEffects,
  DIED_THIS_TURN,
  evalCondition,
  evalConditions,
  fireTriggers,
  isExitRevealed,
} from '../../src/engine/systems/events';

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

// ─── conditions ──────────────────────────────────────────────────────────────

describe('evalCondition — every field the schema allows', () => {
  it('flag', () => {
    expect(evalCondition(module_, start, { flag: 'grate-open' })[0]).toBe(false);
    expect(evalCondition(module_, setFlag(start, 'grate-open', true), { flag: 'grate-open' })[0]).toBe(true);
  });

  it('notFlag', () => {
    expect(evalCondition(module_, start, { notFlag: 'grate-open' })[0]).toBe(true);
    expect(
      evalCondition(module_, setFlag(start, 'grate-open', true), { notFlag: 'grate-open' })[0],
    ).toBe(false);
  });

  it('hasItem', () => {
    expect(evalCondition(module_, start, { hasItem: 'brass-lamp' })[0]).toBe(false);
    const carrying = setItemLocation(start, 'brass-lamp', 'inventory');
    expect(evalCondition(module_, carrying, { hasItem: 'brass-lamp' })[0]).toBe(true);
  });

  it('atLocation', () => {
    expect(evalCondition(module_, start, { atLocation: 'road' })[0]).toBe(true);
    expect(evalCondition(module_, start, { atLocation: 'ledge' })[0]).toBe(false);
  });

  it('visited', () => {
    expect(evalCondition(module_, start, { visited: 'road' })[0]).toBe(true);
    expect(evalCondition(module_, start, { visited: 'grotto' })[0]).toBe(false);
  });

  it('deathsAtMost', () => {
    expect(evalCondition(module_, start, { deathsAtMost: 0 })[0]).toBe(true);
    expect(evalCondition(module_, { ...start, deaths: 1 }, { deathsAtMost: 0 })[0]).toBe(false);
    expect(evalCondition(module_, { ...start, deaths: 2 }, { deathsAtMost: 2 })[0]).toBe(true);
  });

  it('itemAt', () => {
    expect(evalCondition(module_, start, { itemAt: { item: 'jade-idol', location: 'wooden-box' } })[0]).toBe(true);
    expect(evalCondition(module_, start, { itemAt: { item: 'jade-idol', location: 'shed' } })[0]).toBe(false);
  });

  it('creatureAt', () => {
    expect(
      evalCondition(module_, start, { creatureAt: { creature: 'pale-newt', location: 'entry-hall' } })[0],
    ).toBe(true);
    expect(
      evalCondition(module_, start, { creatureAt: { creature: 'pale-newt', location: 'road' } })[0],
    ).toBe(false);
  });

  it('creatureAt on an unknown creature is false, not a crash', () => {
    expect(
      evalCondition(module_, start, { creatureAt: { creature: 'wyvern', location: 'road' } })[0],
    ).toBe(false);
  });

  it('ANDs its fields', () => {
    const state = setFlag(setItemLocation(start, 'brass-lamp', 'inventory'), 'grate-open', true);
    expect(evalCondition(module_, state, { flag: 'grate-open', hasItem: 'brass-lamp' })[0]).toBe(true);
    // One field failing fails the whole condition.
    expect(evalCondition(module_, state, { flag: 'grate-open', hasItem: 'jade-idol' })[0]).toBe(false);
    expect(evalCondition(module_, state, { flag: 'door-oiled', hasItem: 'brass-lamp' })[0]).toBe(false);
  });
});

describe('evalCondition — chance and RNG threading', () => {
  it('threads RNG state: the same seed gives the same outcome', () => {
    const a = evalCondition(module_, start, { chance: 0.5 });
    const b = evalCondition(module_, start, { chance: 0.5 });
    expect(a[0]).toBe(b[0]);
    expect(a[1].rng).toBe(b[1].rng);
  });

  it('advances RNG state when it draws', () => {
    const [, next] = evalCondition(module_, start, { chance: 0.5 });
    expect(next.rng).not.toBe(start.rng);
  });

  it('different seeds can give different outcomes', () => {
    const outcomes = new Set<boolean>();
    for (let seed = 0; seed < 40; seed++) {
      outcomes.add(evalCondition(module_, createGame(module_, seed), { chance: 0.5 })[0]);
    }
    expect(outcomes.size).toBe(2);
  });

  it('consumes no RNG when a cheaper field already failed', () => {
    // The ordering that keeps seeded tests stable: a condition that fails on a
    // flag must not perturb the sequence.
    const [hit, next] = evalCondition(module_, start, { flag: 'not-set', chance: 0.5 });
    expect(hit).toBe(false);
    expect(next.rng).toBe(start.rng);
  });

  it('consumes no RNG for a certainty', () => {
    expect(evalCondition(module_, start, { chance: 1 })).toEqual([true, start]);
    expect(evalCondition(module_, start, { chance: 0 })).toEqual([false, start]);
  });
});

describe('evalConditions — list semantics', () => {
  it('ORs the list', () => {
    const state = setFlag(start, 'grate-open', true);
    expect(evalConditions(module_, state, [{ flag: 'door-oiled' }, { flag: 'grate-open' }])[0]).toBe(true);
    expect(evalConditions(module_, state, [{ flag: 'door-oiled' }, { flag: 'zeeble-known' }])[0]).toBe(false);
  });

  it('treats absent or empty as unconditional', () => {
    expect(evalConditions(module_, start, undefined)[0]).toBe(true);
    expect(evalConditions(module_, start, [])[0]).toBe(true);
  });

  it('short-circuits: a chance after a passing condition is never drawn', () => {
    const state = setFlag(start, 'grate-open', true);
    const [hit, next] = evalConditions(module_, state, [{ flag: 'grate-open' }, { chance: 0.5 }]);
    expect(hit).toBe(true);
    expect(next.rng).toBe(state.rng);
  });

  it('draws for a chance reached before any condition passed', () => {
    const [, next] = evalConditions(module_, start, [{ flag: 'not-set' }, { chance: 0.5 }]);
    expect(next.rng).not.toBe(start.rng);
  });
});

// ─── effects ─────────────────────────────────────────────────────────────────

describe('applyEffects — every variant in the frozen union', () => {
  it('print', () => {
    const [, events] = applyEffects(module_, start, [{ kind: 'print', text: 'Hello.' }]);
    expect(events).toEqual([{ kind: 'text', text: 'Hello.' }]);
  });

  it('printId resolves against strings.json', () => {
    const [, events] = applyEffects(module_, start, [{ kind: 'printId', id: 'dark-warning' }]);
    expect(events[0]?.text).toBe(module_.strings['dark-warning']);
  });

  it('printId surfaces a missing string instead of printing nothing', () => {
    const [, events] = applyEffects(module_, start, [{ kind: 'printId', id: 'no-such-string' }]);
    expect(events[0]?.text).toContain('missing string');
  });

  it('setFlag, with the schema default and an explicit value', () => {
    const [a] = applyEffects(module_, start, [{ kind: 'setFlag', flag: 'x', value: true }]);
    expect(isFlagSet(a, 'x')).toBe(true);
    const [b] = applyEffects(module_, start, [{ kind: 'setFlag', flag: 'n', value: 3 }]);
    expect(b.flags['n']).toBe(3);
  });

  it('clearFlag', () => {
    const [state] = applyEffects(module_, setFlag(start, 'x', true), [{ kind: 'clearFlag', flag: 'x' }]);
    expect(isFlagSet(state, 'x')).toBe(false);
  });

  it('moveItem', () => {
    const [state] = applyEffects(module_, start, [
      { kind: 'moveItem', item: 'iron-key', to: 'hollow-tree' },
    ]);
    expect(itemLocation(state, 'iron-key')).toBe('hollow-tree');
  });

  it('revealExit records per-playthrough state, not a module edit', () => {
    expect(isExitRevealed(start, 'grotto', 'down')).toBe(false);
    const [state] = applyEffects(module_, start, [
      { kind: 'revealExit', location: 'grotto', dir: 'down' },
    ]);
    expect(isExitRevealed(state, 'grotto', 'down')).toBe(true);
    // The module is shared immutable content — one game's discoveries must not
    // leak into the next.
    expect(module_.locations.find((l) => l.id === 'grotto')?.exits.down?.hidden).toBe(true);
  });

  it('addScore, positive and negative', () => {
    const [up, upEvents] = applyEffects(module_, start, [{ kind: 'addScore', points: 10 }]);
    expect(up.score).toBe(10);
    expect(upEvents[0]).toMatchObject({ kind: 'score', points: 10, total: 10 });

    const [down] = applyEffects(module_, up, [{ kind: 'addScore', points: -4 }]);
    expect(down.score).toBe(6);
  });

  it('teleport moves the player and marks the destination visited', () => {
    const [state] = applyEffects(module_, start, [{ kind: 'teleport', to: 'entry-hall' }]);
    expect(state.locationId).toBe('entry-hall');
    expect(state.previousLocationId).toBe('road');
    expect(state.visited).toContain('entry-hall');
  });

  it('die records the death and emits a death event', () => {
    const [state, events] = applyEffects(module_, start, [
      { kind: 'die', messageId: 'ledge-death' },
    ]);
    expect(events[0]).toMatchObject({ kind: 'death' });
    expect(events[0]?.text).toBe(module_.strings['ledge-death']);
    // The effect only records it — penalty and reincarnation are the
    // pipeline's job, since darkness and creature kills never come through here.
    expect(isFlagSet(state, DIED_THIS_TURN)).toBe(true);
    expect(state.deaths).toBe(0);
  });

  it('die without a messageId still says something', () => {
    const [, events] = applyEffects(module_, start, [{ kind: 'die' }]);
    expect(events[0]?.text).toBeTruthy();
  });

  it('award adds the achievement and names it', () => {
    const [state, events] = applyEffects(module_, start, [
      { kind: 'award', achievement: 'first-treasure' },
    ]);
    expect(state.achievements).toEqual(['first-treasure']);
    expect(events[0]).toMatchObject({ kind: 'achievement', achievementId: 'first-treasure' });
    expect(events[0]?.text).toContain('Magpie');
  });

  it('award is idempotent and silent the second time', () => {
    const [once] = applyEffects(module_, start, [{ kind: 'award', achievement: 'first-treasure' }]);
    const [twice, events] = applyEffects(module_, once, [
      { kind: 'award', achievement: 'first-treasure' },
    ]);
    expect(twice.achievements).toEqual(['first-treasure']);
    expect(events).toEqual([]);
  });

  it('endGame', () => {
    const [state] = applyEffects(module_, start, [{ kind: 'endGame', victory: true }]);
    expect(state.ended?.victory).toBe(true);
  });

  it('activateCreature', () => {
    const state = { ...start, turn: 9 };
    const [after] = applyEffects(module_, state, [
      { kind: 'activateCreature', creature: 'cave-rat' },
    ]);
    expect(after.creatures['cave-rat']?.active).toBe(true);
    expect(after.creatures['cave-rat']?.activatedTurn).toBe(9);
  });

  it('activateCreature does not re-stamp an already-active creature', () => {
    const [once] = applyEffects(module_, { ...start, turn: 5 }, [
      { kind: 'activateCreature', creature: 'cave-rat' },
    ]);
    const [twice] = applyEffects(module_, { ...once, turn: 20 }, [
      { kind: 'activateCreature', creature: 'cave-rat' },
    ]);
    expect(twice.creatures['cave-rat']?.activatedTurn).toBe(5);
  });

  it('activateCreature on an unknown creature is a no-op, not a crash', () => {
    const [state] = applyEffects(module_, start, [{ kind: 'activateCreature', creature: 'wyvern' }]);
    expect(state).toEqual(start);
  });

  // The freeze in effects.ts is only real if something checks it.
  it('covers every kind in the frozen union', () => {
    const samples: Record<Effect['kind'], Effect> = {
      print: { kind: 'print', text: 'x' },
      printId: { kind: 'printId', id: 'dark-warning' },
      setFlag: { kind: 'setFlag', flag: 'x', value: true },
      clearFlag: { kind: 'clearFlag', flag: 'x' },
      moveItem: { kind: 'moveItem', item: 'iron-key', to: 'road' },
      revealExit: { kind: 'revealExit', location: 'grotto', dir: 'down' },
      addScore: { kind: 'addScore', points: 1 },
      teleport: { kind: 'teleport', to: 'shed' },
      die: { kind: 'die' },
      award: { kind: 'award', achievement: 'first-treasure' },
      endGame: { kind: 'endGame', victory: true },
      activateCreature: { kind: 'activateCreature', creature: 'cave-rat' },
    };
    expect(Object.keys(samples).sort()).toEqual([...EFFECT_KINDS].sort());
    // Every one applies without throwing.
    for (const effect of Object.values(samples)) {
      expect(() => applyEffects(module_, start, [effect])).not.toThrow();
    }
  });
});

describe('applyEffects — ordering', () => {
  it('applies in array order, each effect seeing the last one\'s state', () => {
    const [state] = applyEffects(module_, start, [
      { kind: 'moveItem', item: 'iron-key', to: 'road' },
      { kind: 'moveItem', item: 'iron-key', to: 'shed' },
    ]);
    expect(itemLocation(state, 'iron-key')).toBe('shed');
  });

  it('emits output in effect order', () => {
    const [, events] = applyEffects(module_, start, [
      { kind: 'print', text: 'first' },
      { kind: 'print', text: 'second' },
    ]);
    expect(events.map((e) => e.text)).toEqual(['first', 'second']);
  });

  it('does not mutate the state it is given', () => {
    const frozen = structuredClone(start);
    applyEffects(module_, start, [
      { kind: 'setFlag', flag: 'x', value: true },
      { kind: 'moveItem', item: 'iron-key', to: 'road' },
      { kind: 'addScore', points: 5 },
    ]);
    expect(start).toEqual(frozen);
  });
});

// ─── triggers ────────────────────────────────────────────────────────────────

describe('fireTriggers', () => {
  it('fires a matching event and applies its effects', () => {
    // test-cave: `search tree-trunk` reveals the iron key.
    const [state, events] = fireTriggers(module_, start, { type: 'search', target: 'tree-trunk' });
    expect(itemLocation(state, 'iron-key')).toBe('hollow-tree');
    expect(events.some((e) => e.text.includes('iron key'))).toBe(true);
    expect(isFlagSet(state, 'tree-searched')).toBe(true);
  });

  it('ignores a trigger of the wrong type', () => {
    const [state] = fireTriggers(module_, start, { type: 'take', target: 'tree-trunk' });
    expect(itemLocation(state, 'iron-key')).toBe('nowhere');
  });

  it('ignores a trigger with the wrong target', () => {
    const [state] = fireTriggers(module_, start, { type: 'search', target: 'wooden-box' });
    expect(itemLocation(state, 'iron-key')).toBe('nowhere');
  });

  it('matches an event with no target against ANY subject of its type', () => {
    // test-cave's `packrat-arms` watches every take, guarded by carrying treasure.
    const carrying = setItemLocation(start, 'silver-chalice', 'inventory');
    const [state] = fireTriggers(module_, carrying, { type: 'take', target: 'silver-chalice' });
    expect(isFlagSet(state, 'packrat-armed')).toBe(true);
  });

  it('respects a failing guard', () => {
    // `packrat-arms` fires on every take but only when a treasure is carried.
    const [state] = fireTriggers(module_, start, { type: 'take', target: 'brass-lamp' });
    expect(isFlagSet(state, 'packrat-armed')).toBe(false);
  });

  it('honours `once`', () => {
    const [first] = fireTriggers(module_, start, { type: 'search', target: 'tree-trunk' });
    expect(first.firedEvents).toContain('reveal-key');

    // Move the key away; a second search must not put it back.
    const moved = setItemLocation(first, 'iron-key', 'inventory');
    const [second] = fireTriggers(module_, moved, { type: 'search', target: 'tree-trunk' });
    expect(itemLocation(second, 'iron-key')).toBe('inventory');
  });

  it('leaves a once-event armed when its guard failed', () => {
    // An event that did not fire has not fired.
    const [state] = fireTriggers(module_, start, { type: 'take', target: 'brass-lamp' });
    expect(state.firedEvents).not.toContain('first-treasure-award');

    const carrying = setItemLocation(state, 'silver-chalice', 'inventory');
    const [after] = fireTriggers(module_, carrying, { type: 'take', target: 'silver-chalice' });
    expect(after.achievements).toContain('first-treasure');
  });

  it('matches turnStart on the turn number', () => {
    const [, none] = fireTriggers(module_, start, { type: 'turnStart', turn: 11 });
    expect(none).toEqual([]);
    const [, hit] = fireTriggers(module_, start, { type: 'turnStart', turn: 12 });
    expect(hit.length).toBeGreaterThan(0);
  });

  it('matches a word trigger and respects its location guard', () => {
    // zeeble is bidirectional: at `road` it descends, at `entry-hall` it rises.
    // Both are the same word — the guard is what tells them apart.
    const known = setFlag(start, 'zeeble-known', true);
    const [down] = fireTriggers(module_, known, { type: 'word', word: 'zeeble' });
    expect(down.locationId).toBe('entry-hall');

    const [up] = fireTriggers(module_, { ...known, locationId: 'entry-hall' }, {
      type: 'word',
      word: 'zeeble',
    });
    expect(up.locationId).toBe('road');
  });

  it('does not fire a word trigger whose guard is unmet', () => {
    // Saying zeeble before reading the carving does nothing.
    const [state] = fireTriggers(module_, start, { type: 'word', word: 'zeeble' });
    expect(state.locationId).toBe('road');
  });

  it('matches a verb trigger', () => {
    const onLedge = { ...start, locationId: 'ledge' };
    const [state, events] = fireTriggers(module_, onLedge, { type: 'verb', target: 'jump' });
    expect(events.some((e) => e.kind === 'death')).toBe(true);
    expect(isFlagSet(state, DIED_THIS_TURN)).toBe(true);
  });

  it('does not kill a player who jumps somewhere safe', () => {
    const [, events] = fireTriggers(module_, start, { type: 'verb', target: 'jump' });
    expect(events).toEqual([]);
  });

  it('fires events in module order, each seeing the last one\'s state', () => {
    // test-cave: `win-clean` must award before `win` ends the game.
    let state = setItemLocation(start, 'silver-chalice', 'shed');
    state = setItemLocation(state, 'jade-idol', 'shed');
    const [after, events] = fireTriggers(module_, state, { type: 'flagSet', target: 'both-deposited' });
    expect(after.achievements).toContain('no-deaths');
    expect(after.ended?.victory).toBe(true);
    expect(events.some((e) => e.kind === 'achievement')).toBe(true);
  });

  it('withholds the clean-run award from a player who died', () => {
    const died = { ...start, deaths: 1 };
    const [after] = fireTriggers(module_, died, { type: 'flagSet', target: 'both-deposited' });
    expect(after.achievements).not.toContain('no-deaths');
    // ...but the game still ends.
    expect(after.ended?.victory).toBe(true);
  });

  it('does not mutate the state it is given', () => {
    const frozen = structuredClone(start);
    fireTriggers(module_, start, { type: 'search', target: 'tree-trunk' });
    expect(start).toEqual(frozen);
  });
});

// Regression tests for the bug the zeeble test caught: guards must all see the
// same snapshot. Under sequential guard evaluation each of these fires its own
// mutually-exclusive twin in the same turn.
describe('fireTriggers — guards see one snapshot', () => {
  it('zeeble teleports once and does not bounce back', () => {
    // zeeble-descend moves road->entry-hall. zeeble-ascend's guard is
    // `atLocation: entry-hall` — which the descend just made true. It must
    // still be judged on where the player was when the word was spoken.
    const known = setFlag(start, 'zeeble-known', true);
    const [after] = fireTriggers(module_, known, { type: 'word', word: 'zeeble' });
    expect(after.locationId).toBe('entry-hall');
  });

  it('finding the key does not also report the hollow empty', () => {
    const [, events] = fireTriggers(module_, start, { type: 'search', target: 'tree-trunk' });
    const text = events.map((e) => e.text).join(' ');
    expect(text).toContain('iron key');
    expect(text).not.toContain('empty now');
  });

  it('reports the hollow empty on a SECOND search', () => {
    const [first] = fireTriggers(module_, start, { type: 'search', target: 'tree-trunk' });
    const [, events] = fireTriggers(module_, first, { type: 'search', target: 'tree-trunk' });
    expect(events.map((e) => e.text).join(' ')).toContain('empty now');
  });

  it('oiling the door does not also say it is already oiled', () => {
    const carrying = setItemLocation(start, 'oil-flask', 'inventory');
    const state = { ...carrying, locationId: 'grotto' };
    const [after, events] = fireTriggers(module_, state, { type: 'use', target: 'rusted-door' });
    const text = events.map((e) => e.text).join(' ');
    expect(text).toContain('rust gives up');
    expect(text).not.toContain('already slick');
    expect(isFlagSet(after, 'door-oiled')).toBe(true);
  });

  it('says the door is already oiled on a SECOND use', () => {
    const carrying = setItemLocation(start, 'oil-flask', 'inventory');
    const [first] = fireTriggers(module_, { ...carrying, locationId: 'grotto' }, {
      type: 'use',
      target: 'rusted-door',
    });
    const [, events] = fireTriggers(module_, first, { type: 'use', target: 'rusted-door' });
    expect(events.map((e) => e.text).join(' ')).toContain('already slick');
  });
});

describe('applyEffects — flagSet cascade', () => {
  it('a setFlag fires flagSet triggers for that flag', () => {
    // test-cave's `win` is only reachable this way: a drop sets
    // `both-deposited`, and `win` listens for it.
    let state = setItemLocation(start, 'silver-chalice', 'shed');
    state = setItemLocation(state, 'jade-idol', 'shed');
    const [after, events] = applyEffects(module_, state, [
      { kind: 'setFlag', flag: 'both-deposited', value: true },
    ]);
    expect(after.ended?.victory).toBe(true);
    expect(after.achievements).toContain('no-deaths');
    expect(events.some((e) => e.text.includes('The plank holds'))).toBe(true);
  });

  it('cascades only on the transition to set, not on every write', () => {
    const state = setFlag(start, 'grate-open', true);
    // grate-note already fired for the transition; re-setting must not re-fire.
    const [, events] = applyEffects(module_, { ...state, firedEvents: ['grate-note'] }, [
      { kind: 'setFlag', flag: 'grate-open', value: true },
    ]);
    expect(events).toEqual([]);
  });

  it('does not cascade when a flag is set to a falsy value', () => {
    const [, events] = applyEffects(module_, start, [
      { kind: 'setFlag', flag: 'grate-open', value: false },
    ]);
    expect(events).toEqual([]);
  });

  it('terminates on a mutually-recursive cascade instead of hanging', () => {
    // Content the validator would accept but which loops: two events that set
    // each other's flags. The engine must stop rather than hang.
    const looping: AdventureModule = {
      ...module_,
      events: [
        {
          id: 'ping',
          once: false,
          on: { type: 'flagSet', target: 'a' },
          do: [{ kind: 'setFlag', flag: 'b', value: true }],
        },
        {
          id: 'pong',
          once: false,
          on: { type: 'flagSet', target: 'b' },
          do: [{ kind: 'clearFlag', flag: 'a' }, { kind: 'setFlag', flag: 'a', value: true }],
        },
      ],
    };
    expect(() => applyEffects(looping, start, [{ kind: 'setFlag', flag: 'a', value: true }])).not.toThrow();
  });
});
