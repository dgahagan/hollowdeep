import { describe, expect, it } from 'vitest';
import { zAdventureModule, type AdventureModule } from '../../src/engine/schema';
import type { GameState, OutputEvent } from '../../src/engine/types';
import { createGame } from '../../src/engine/state';
import { step } from '../../src/engine/engine';

// ─────────────────────────────────────────────────────────────────────────────
// The timer system (hints-timers plan §4; T3).
//
// Everything here drives the REAL pipeline through `step()` — the arithmetic
// being tested is precisely the interplay of effect application, the turn
// increment, and the world tick, so unit-testing the pieces apart would test
// nothing. The fixture module is deliberately RNG-free (no creatures, no dark
// rooms, no `chance`): a timer draws no randomness, and these tests prove it
// by never seeding anything twice.
//
// THE PINNED CONTRACT (plan §4.3, and the arithmetic note in engine.ts):
// after a player action arms `startTimer t n`, the player has exactly n
// further consumed turns; the expiry fires during the n-th's world tick,
// after its action — so the n-th move may be the one that gets you clear,
// and the guard sees you already gone. Do not re-derive it; test it as
// written.
// ─────────────────────────────────────────────────────────────────────────────

const rawModule = {
  manifest: {
    id: 'timer-fixture',
    title: 'Timer Fixture',
    version: '1.0.0',
    engineVersion: '^2.0.0',
    startLocation: 'lab',
    repositoryLocation: 'lab',
    maxScore: 0,
    carryLimit: 5,
    lamp: {
      itemId: 'lamp',
      startFuel: 100,
      warnAt: [10],
      warnMessageId: 'lamp-low',
      exhaustMessageId: 'lamp-dead',
    },
    darkness: { deathChance: 0.5, warningMessageId: 'dark-warning', deathMessageId: 'dark-death' },
  },
  locations: [
    {
      id: 'lab',
      name: 'Laboratory',
      brief: 'The laboratory.',
      full: 'A laboratory of levers and bells, built for exactly one purpose.',
      artId: 'lab',
      light: 'lit',
      exits: { e: { to: 'hall' } },
    },
    {
      id: 'hall',
      name: 'Hall',
      brief: 'The hall.',
      full: 'A hall outside the laboratory. Safely outside.',
      artId: 'hall',
      light: 'lit',
      exits: { w: { to: 'lab' } },
    },
  ],
  items: [
    {
      id: 'lamp',
      names: ['lamp'],
      brief: 'A lamp sits here.',
      description: 'A lamp.',
      artId: 'lamp',
      portable: true,
      initialLocation: 'inventory',
      lightSource: true,
    },
    {
      id: 'lever',
      names: ['lever'],
      brief: 'A lever juts from the wall.',
      description: 'A lever, connected to something overhead you would rather not audit.',
      artId: 'lever',
      portable: false,
      initialLocation: 'lab',
    },
    {
      id: 'knob',
      names: ['knob'],
      brief: 'A knob protrudes invitingly.',
      description: 'A knob labelled BOTH.',
      artId: 'knob',
      portable: false,
      initialLocation: 'lab',
    },
    {
      id: 'bell',
      names: ['bell'],
      brief: 'A bell hangs here.',
      description: 'A bell with opinions about silence.',
      artId: 'bell',
      portable: false,
      initialLocation: 'lab',
    },
  ],
  creatures: [],
  vocabulary: {
    verbs: [{ id: 'use', words: ['pull', 'ring', 'twist'], patterns: ['VN'] }],
    noiseWords: ['the'],
    magicWords: [],
  },
  events: [
    {
      id: 'arm-roof',
      on: { type: 'use', target: 'lever' },
      do: [
        { kind: 'print', text: 'Overhead, the ceiling clears its throat.' },
        { kind: 'startTimer', timer: 'roof-fall', turns: 3 },
      ],
    },
    // The two-event opposite-guard shape every timer death uses (the garnet
    // pattern). Snapshot semantics mean exactly one fires.
    {
      id: 'roof-hits',
      on: { type: 'timerExpired', target: 'roof-fall' },
      if: [{ atLocation: 'lab' }],
      do: [{ kind: 'die', messageId: 'roof-death' }],
    },
    {
      id: 'roof-misses',
      on: { type: 'timerExpired', target: 'roof-fall' },
      if: [{ atLocation: 'hall' }],
      do: [{ kind: 'print', text: 'Behind you, the ceiling sits down.' }],
    },
    // Two timers expiring on the same turn — armed in REVERSE lexicographic
    // order, so passing output order proves the sort, not insertion order.
    // NOTE every arming event here PRINTS: `useHandler` treats a use whose
    // events produce no output as "Nothing happens" and consumes no turn
    // (handling.ts) — silent arming would shift the whole timeline by one.
    // Real content telegraphs its timers anyway (design rule), so printing is
    // the realistic shape, not a workaround.
    {
      id: 'arm-both',
      on: { type: 'use', target: 'knob' },
      do: [
        { kind: 'print', text: 'The knob turns. Twice, somehow.' },
        { kind: 'startTimer', timer: 'z-second', turns: 2 },
        { kind: 'startTimer', timer: 'a-first', turns: 2 },
      ],
    },
    {
      id: 'a-fires',
      on: { type: 'timerExpired', target: 'a-first' },
      do: [{ kind: 'print', text: 'A fires.' }],
    },
    {
      id: 'z-fires',
      on: { type: 'timerExpired', target: 'z-second' },
      do: [{ kind: 'print', text: 'Z fires.' }],
    },
    // The periodic idiom: an expiry event re-arming its own id.
    {
      id: 'arm-echo',
      on: { type: 'use', target: 'bell' },
      do: [
        { kind: 'print', text: 'The bell rings once, and thinks about it.' },
        { kind: 'startTimer', timer: 'echo', turns: 2 },
      ],
    },
    {
      id: 'echo-returns',
      on: { type: 'timerExpired', target: 'echo' },
      do: [
        { kind: 'print', text: 'The echo returns.' },
        { kind: 'startTimer', timer: 'echo', turns: 2 },
      ],
    },
  ],
  scoring: {
    milestones: [],
    deathPenalty: 10,
    hintPenalty: 5,
    ranks: [{ minScore: 0, title: 'Test Subject' }],
  },
  achievements: [],
  strings: {
    'lamp-low': 'The lamp dims.',
    'lamp-dead': 'The lamp dies.',
    'dark-warning': 'It is pitch dark.',
    'dark-death': 'You fall.',
    'no-hints': 'No hints here.',
    'roof-death': 'The ceiling stops clearing its throat and gets to the point.',
  },
  walkthrough: { steps: [{ cmd: 'look' }], expectedScore: 0 },
  hints: { noHintMessageId: 'no-hints', hints: [] },
};

const module_: AdventureModule = zAdventureModule.parse(rawModule);

function fresh(): GameState {
  return createGame(module_, 1);
}

/** Run a command list, returning the final state and every turn's output. */
function play(state: GameState, commands: string[]): { state: GameState; log: OutputEvent[][] } {
  let current = state;
  const log: OutputEvent[][] = [];
  for (const cmd of commands) {
    const result = step(module_, current, cmd);
    current = result.state;
    log.push(result.events);
  }
  return { state: current, log };
}

function texts(events: OutputEvent[]): string[] {
  return events.map((e) => e.text);
}

describe('startTimer — the effect', () => {
  it('stores turn-at-effect + turns, and the arming action itself does not fire it', () => {
    const { state, log } = play(fresh(), ['pull lever']);
    expect(state.timers['roof-fall']).toBe(0 + 3); // armed at turn 0, pre-increment
    expect(texts(log[0] ?? []).join('\n')).toContain('clears its throat');
    expect(state.deaths).toBe(0);
  });

  it('restart resets — re-arming overwrites the running count', () => {
    // Arm, wait twice (expiry would land on the next move), then re-arm: the
    // player has bought a fresh three turns, not one.
    const { state } = play(fresh(), ['pull lever', 'wait', 'wait', 'pull lever']);
    expect(state.timers['roof-fall']).toBe(3 + 3); // re-armed at turn 3
    expect(state.deaths).toBe(0);
    const { state: after } = play(state, ['wait', 'wait']);
    expect(after.deaths).toBe(0); // still inside the fresh window
  });
});

describe('timerExpired — the pinned n-further-turns contract', () => {
  it('n = 3: the expiry fires during the third further consumed turn, not before', () => {
    const armed = play(fresh(), ['pull lever']).state;

    const twoMore = play(armed, ['wait', 'wait']);
    expect(twoMore.state.deaths).toBe(0); // turns 1 and 2 of the window: nothing

    const third = step(module_, twoMore.state, 'wait');
    expect(third.state.deaths).toBe(1); // fires during the 3rd further turn's tick
    expect(texts(third.events).join('\n')).toContain('gets to the point');
    expect('roof-fall' in third.state.timers).toBe(false); // entry removed on firing
  });

  it('the n-th move may be the escaping one — the guard sees you already gone', () => {
    const { state, log } = play(fresh(), ['pull lever', 'wait', 'wait', 'e']);
    expect(state.deaths).toBe(0);
    expect(state.locationId).toBe('hall');
    // Exactly one of the opposite-guard pair fired (snapshot semantics).
    const lastTurn = texts(log[3] ?? []).join('\n');
    expect(lastTurn).toContain('the ceiling sits down');
    expect(lastTurn).not.toContain('gets to the point');
  });

  it('a timer death is one death, one penalty, through the normal death path', () => {
    const before = play(fresh(), ['pull lever', 'wait', 'wait']).state;
    const killed = step(module_, before, 'wait');
    expect(killed.state.deaths).toBe(1);
    expect(killed.state.score).toBe(0); // 0 - 10, floored at 0 by handleDeath
    expect(killed.state.locationId).toBe('lab'); // reincarnated at startLocation
  });

  it('parse errors and free meta verbs advance no timer', () => {
    const armed = play(fresh(), ['pull lever']).state;
    // Two window-turns pass, then a storm of turn-free inputs: gibberish (a
    // parse error), `score` and `inventory` (free meta verbs). None may tick.
    const { state } = play(armed, ['wait', 'wait', 'xyzzyplugh', 'score', 'inventory', 'score']);
    expect(state.deaths).toBe(0);
    expect(state.timers['roof-fall']).toBe(3);
    // The very next consumed turn is still the fatal third.
    expect(step(module_, state, 'wait').state.deaths).toBe(1);
  });
});

describe('timerExpired — multiple timers and the periodic idiom', () => {
  it('two timers expiring the same turn fire in lexicographic id order', () => {
    // Armed z-then-a in one event; if insertion order leaked, Z would print first.
    const { log } = play(fresh(), ['twist knob', 'wait', 'wait']);
    const lastTurn = texts(log[2] ?? []);
    const a = lastTurn.findIndex((t) => t.includes('A fires.'));
    const z = lastTurn.findIndex((t) => t.includes('Z fires.'));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(z).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(z);
  });

  it('an expiry event may re-arm its own id — and a tick-armed timer has period n+1', () => {
    // Armed by the action at turn 0 (n=2): first echo during the 2nd further
    // turn. The re-arm happens INSIDE that world tick (post-increment), so
    // the next period is n+1 = 3 — the documented asymmetry (engine.ts).
    const { state, log } = play(fresh(), ['ring bell', 'wait', 'wait', 'wait', 'wait', 'wait']);
    const echoTurns = log
      .map((events, i) => (texts(events).join('\n').includes('The echo returns.') ? i : -1))
      .filter((i) => i >= 0);
    expect(echoTurns).toEqual([2, 5]); // action-armed: 2 turns; re-armed: 3
    expect(state.timers['echo']).toBeDefined(); // still running
  });
});
