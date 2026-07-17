import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { zAdventureModule, type AdventureModule } from '../../src/engine/schema';
import type { GameState, OutputEvent } from '../../src/engine/types';
import { createGame } from '../../src/engine/state';
import { step } from '../../src/engine/engine';
import { loadAdventure } from '../../src/loader';

// ─────────────────────────────────────────────────────────────────────────────
// The hint verb, ladder selection, and hintsAtMost (hints-timers plan §5; T4).
//
// Drives the REAL pipeline through `step()` against a hand-built, RNG-free
// module (no creatures, a lit room only, no `chance`) — same fixture pattern
// as tests/engine/timers.test.ts, and for the same reason: `hint`'s whole
// point is its interaction with the rest of the turn pipeline (it changes
// state but must never consume a turn), so unit-testing the handler in
// isolation would prove nothing about the property that actually matters.
//
// Two ladders exercise selection: `ladder-a` (3 rungs, document-order first)
// and `ladder-b` (1 rung), each retiring on its own flag so retirement and
// exhaustion can be tested independently without one scenario disturbing the
// other. A timer (`bell-timer`, armed by `pull lever`) proves the no-turn
// property against the exact mechanism hints-timers plan §4 built. `check` is
// an adventure-defined verb (no core handler) whose two `if`-guarded events
// are the `hintsAtMost` boundary probe.
// ─────────────────────────────────────────────────────────────────────────────

function buildModule(hintPenalty: number): AdventureModule {
  const rawModule = {
    manifest: {
      id: 'hint-fixture',
      title: 'Hint Fixture',
      version: '1.0.0',
      engineVersion: '^2.0.0',
      startLocation: 'lab',
      repositoryLocation: 'lab',
      maxScore: 3,
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
        full: 'A laboratory of levers and switches, all quiet for now.',
        artId: 'lab',
        light: 'lit',
        exits: {},
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
        description: 'A lever, wired to something overhead you would rather not audit.',
        artId: 'lever',
        portable: false,
        initialLocation: 'lab',
      },
      {
        id: 'switch-a',
        names: ['switch'],
        brief: 'A switch labelled A.',
        description: 'A switch labelled A. It looks tired.',
        artId: 'switch',
        portable: false,
        initialLocation: 'lab',
      },
    ],
    creatures: [],
    vocabulary: {
      verbs: [
        { id: 'use', words: ['pull', 'flip'], patterns: ['VN'] },
        // Intransitive, no core handler — dispatch's "no handler" path fires
        // the `verb` trigger directly (engine.ts), which is exactly the
        // hintsAtMost probe below needs.
        { id: 'check', words: ['check'], patterns: ['V'] },
      ],
      noiseWords: ['the'],
      magicWords: [],
    },
    events: [
      {
        id: 'arm-timer',
        on: { type: 'use', target: 'lever' },
        do: [
          { kind: 'print', text: 'Overhead, something begins to warm up.' },
          { kind: 'startTimer', timer: 'bell-timer', turns: 2 },
        ],
      },
      {
        id: 'timer-fires',
        on: { type: 'timerExpired', target: 'bell-timer' },
        do: [{ kind: 'print', text: 'DING.' }],
      },
      {
        id: 'retire-a',
        on: { type: 'use', target: 'switch-a' },
        do: [
          { kind: 'print', text: 'The A switch clicks off.' },
          { kind: 'setFlag', flag: 'a-retired', value: true },
        ],
      },
      // The hintsAtMost boundary probe: two independent guards on the same
      // trigger, judged against one snapshot (systems/events.ts's rule 3),
      // so both can legally fire together (0 hints used satisfies both).
      {
        id: 'check-zero',
        on: { type: 'verb', target: 'check' },
        if: [{ hintsAtMost: 0 }],
        do: [{ kind: 'print', text: 'ZERO-HINTS-OK' }],
      },
      {
        id: 'check-two',
        on: { type: 'verb', target: 'check' },
        if: [{ hintsAtMost: 2 }],
        do: [{ kind: 'print', text: 'AT-MOST-TWO-OK' }],
      },
    ],
    scoring: {
      // Awarded the first turn `lab` is visited — true from `createGame`, so
      // it fires on the first CONSUMED turn (a `wait`), giving the penalty-math
      // tests a nonzero score to deduct from without `hint` itself ever being
      // able to trigger it (`hint` consumes no turn, so `scoringTick` never
      // runs off it alone — itself part of what these tests prove).
      milestones: [{ id: 'm1', points: 3, when: [{ visited: 'lab' }] }],
      deathPenalty: 10,
      hintPenalty,
      ranks: [{ minScore: 0, title: 'Test Subject' }],
    },
    achievements: [],
    strings: {
      'lamp-low': 'The lamp dims.',
      'lamp-dead': 'The lamp dies.',
      'dark-warning': 'It is pitch dark.',
      'dark-death': 'You fall.',
      'no-hints': 'You are on your own.',
    },
    walkthrough: { steps: [{ cmd: 'look' }], expectedScore: 0 },
    hints: {
      noHintMessageId: 'no-hints',
      hints: [
        // Document order = priority order (§5.2). Both ladders are available
        // from the start, so a fresh `hint` must pick this one.
        {
          id: 'ladder-a',
          when: [{ notFlag: 'a-retired' }],
          ladder: ['a-rung-1', 'a-rung-2', 'a-rung-3'],
        },
        {
          id: 'ladder-b',
          when: [{ notFlag: 'b-retired' }],
          ladder: ['b-rung-1'],
        },
      ],
    },
  };

  return zAdventureModule.parse(rawModule);
}

function fresh(module: AdventureModule): GameState {
  return createGame(module, 1);
}

/** Run a command list against a module, returning the final state and every turn's output. */
function play(
  module: AdventureModule,
  state: GameState,
  commands: string[],
): { state: GameState; log: OutputEvent[][] } {
  let current = state;
  const log: OutputEvent[][] = [];
  for (const cmd of commands) {
    const result = step(module, current, cmd);
    current = result.state;
    log.push(result.events);
  }
  return { state: current, log };
}

function texts(events: OutputEvent[]): string[] {
  return events.map((e) => e.text);
}

function hintEvents(events: OutputEvent[]): Extract<OutputEvent, { kind: 'hint' }>[] {
  return events.filter((e): e is Extract<OutputEvent, { kind: 'hint' }> => e.kind === 'hint');
}

const module_ = buildModule(5);
const zeroPenaltyModule = buildModule(0);

describe('hint — selection rule', () => {
  it('two available ladders: document order wins', () => {
    const { log } = play(module_, fresh(module_), ['hint']);
    const hints = hintEvents(log[0] ?? []);
    expect(hints).toHaveLength(1);
    expect(hints[0]?.hintId).toBe('ladder-a');
    expect(hints[0]?.rung).toBe(1);
    expect(hints[0]?.text).toBe('a-rung-1');
  });

  it('retirement: a hint whose `when` goes false mid-ladder stops being offered', () => {
    const afterFirst = play(module_, fresh(module_), ['hint']).state; // ladder-a, rung 1
    const retired = play(module_, afterFirst, ['flip switch']).state; // a-retired = true
    const { log } = play(module_, retired, ['hint']);
    const hints = hintEvents(log[0] ?? []);
    expect(hints).toHaveLength(1);
    // ladder-a still has two unrevealed rungs, but `when` no longer holds —
    // it must be skipped in favour of the next available ladder, not re-offered.
    expect(hints[0]?.hintId).toBe('ladder-b');
    expect(hints[0]?.rung).toBe(1);
  });

  it('exhaustion skips to the next available ladder', () => {
    const exhausted = play(module_, fresh(module_), ['hint', 'hint', 'hint']).state; // all 3 of ladder-a
    expect(exhausted.hintsRevealed['ladder-a']).toBe(3);
    const { log } = play(module_, exhausted, ['hint']);
    const hints = hintEvents(log[0] ?? []);
    expect(hints).toHaveLength(1);
    expect(hints[0]?.hintId).toBe('ladder-b');
    expect(hints[0]?.rung).toBe(1);
  });
});

describe('hint — penalty and counter math', () => {
  it('each reveal deducts hintPenalty, and score floors at 0', () => {
    // `wait` first so the milestone (3 points on visiting `lab`) actually
    // awards — `hint` itself consumes no turn, so `scoringTick` never runs
    // off it alone.
    const scored = play(module_, fresh(module_), ['wait']).state;
    expect(scored.score).toBe(3);

    const deducted = play(module_, scored, ['hint']).state; // 3 - 5, floored at 0
    expect(deducted.score).toBe(0);

    const flooredAgain = play(module_, deducted, ['hint']).state; // already 0, stays 0
    expect(flooredAgain.score).toBe(0);
  });

  it('a 0 hintPenalty deducts nothing', () => {
    const scored = play(zeroPenaltyModule, fresh(zeroPenaltyModule), ['wait']).state;
    expect(scored.score).toBe(3);
    const afterTwoHints = play(zeroPenaltyModule, scored, ['hint', 'hint']).state;
    expect(afterTwoHints.score).toBe(3);
  });

  it('hintsUsed counts RUNGS revealed, not commands; the no-hint path counts nothing', () => {
    const threeUsed = play(module_, fresh(module_), ['hint', 'hint', 'hint']).state; // all of ladder-a
    expect(threeUsed.hintsUsed).toBe(3);

    const fourUsed = play(module_, threeUsed, ['hint']).state; // ladder-b's only rung
    expect(fourUsed.hintsUsed).toBe(4);

    const { state: stillFour, log } = play(module_, fourUsed, ['hint']); // nothing left to give
    expect(stillFour.hintsUsed).toBe(4); // unchanged — "no" is not a hint
    expect(texts(log[0] ?? []).join('\n')).toContain('You are on your own.');
  });
});

describe('hint — the no-turn property', () => {
  it('lamp fuel does not burn while spamming hint', () => {
    const lit = play(module_, fresh(module_), ['light lamp']).state;
    const fuelAfterLighting = lit.lampFuel;
    const spammed = play(module_, lit, ['hint', 'hint', 'hint', 'hint']).state;
    expect(spammed.lampFuel).toBe(fuelAfterLighting);
  });

  it('state.turn does not advance', () => {
    const before = fresh(module_);
    const { state } = play(module_, before, ['hint', 'hint', 'hint']);
    expect(state.turn).toBe(before.turn);
  });

  it('a running timer does not advance while hints are spammed', () => {
    const armed = play(module_, fresh(module_), ['pull lever']).state; // bell-timer: n=2 further turns
    const spammed = play(module_, armed, ['hint', 'hint', 'hint', 'hint', 'hint']).state;
    expect(spammed.turn).toBe(armed.turn); // the spam itself burned no turns
    expect(spammed.timers['bell-timer']).toBe(armed.timers['bell-timer']); // untouched

    const { log } = play(module_, spammed, ['wait', 'wait']);
    expect(texts(log[0] ?? []).join('\n')).not.toContain('DING'); // 1st further turn: not yet
    expect(texts(log[1] ?? []).join('\n')).toContain('DING'); // 2nd further turn: exactly on schedule
  });
});

describe('hint — hintsAtMost, the bridge to a no-hints achievement', () => {
  it('an event guarded hintsAtMost: 0 fires at 0 hints used, and not after', () => {
    const { log: atZero } = play(module_, fresh(module_), ['check']);
    expect(texts(atZero[0] ?? []).join('\n')).toContain('ZERO-HINTS-OK');

    const oneUsed = play(module_, fresh(module_), ['hint']).state;
    const { log: atOne } = play(module_, oneUsed, ['check']);
    expect(texts(atOne[0] ?? []).join('\n')).not.toContain('ZERO-HINTS-OK');
  });

  it('an event guarded hintsAtMost: 2 fires at 2 hints used, and not at 3', () => {
    const twoUsed = play(module_, fresh(module_), ['hint', 'hint']).state;
    const { log: atTwo } = play(module_, twoUsed, ['check']);
    expect(texts(atTwo[0] ?? []).join('\n')).toContain('AT-MOST-TWO-OK');

    const threeUsed = play(module_, twoUsed, ['hint']).state;
    const { log: atThree } = play(module_, threeUsed, ['check']);
    expect(texts(atThree[0] ?? []).join('\n')).not.toContain('AT-MOST-TWO-OK');
  });
});

describe('hint — the OutputEvent shape', () => {
  it('carries kind, hintId, and the 1-based rung index', () => {
    const { log: first } = play(module_, fresh(module_), ['hint']);
    expect(hintEvents(first[0] ?? [])).toEqual([
      { kind: 'hint', text: 'a-rung-1', hintId: 'ladder-a', rung: 1 },
    ]);

    const afterFirst = play(module_, fresh(module_), ['hint']).state;
    const { log: second } = play(module_, afterFirst, ['hint']);
    expect(hintEvents(second[0] ?? [])).toEqual([
      { kind: 'hint', text: 'a-rung-2', hintId: 'ladder-a', rung: 2 },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Against REAL content (hints-timers plan T7).
//
// Everything above drives a hand-built module built for exactly the property
// under test; this is the layer that can't be faked by one — the real
// `hints.json` selection order (grate first, then the rusted door), real
// retirement via the grate/door puzzles' own flags, and a real trophy shelf's
// worth of treasure to deduct points from. Loaded off disk the same way
// tests/engine/save.test.ts does. `fresh`/`play`/`texts`/`hintEvents` above
// already take the module as a parameter — reused as-is against the loaded
// cave, which is the whole reason they were written that way.
// ─────────────────────────────────────────────────────────────────────────────

describe('hint — against test-cave (integration)', () => {
  const CAVE_DIR = path.resolve(import.meta.dirname, '../../adventures/test-cave');
  let cave: AdventureModule;

  beforeAll(async () => {
    cave = await loadAdventure(
      (p) => readFile(p, 'utf8'),
      CAVE_DIR,
      (dir) => readdir(dir),
    );
  });

  // The walkthrough's own opening (adventures/test-cave/walkthrough.json),
  // borrowed rather than re-derived — ends with the grate open.
  const OPEN_GRATE = [
    'e',
    'take lamp',
    'take flask',
    'w',
    'n',
    'search tree',
    'take key',
    's',
    'w',
    'unlock grate with key',
    'open grate',
  ];

  // From cave-mouth (where OPEN_GRATE leaves you) down into the grotto, lamp
  // lit first — the walkthrough's next six steps.
  const TO_GROTTO = ['light lamp', 'down', 'n', 'n', 'n', 'w'];

  const GRATE_RUNG =
    "The grate is locked, and a lock is usually somebody's answer to a key that exists. Things around here get hidden in things.";
  const DOOR_LADDER = [
    'The door in the grotto has not moved in a long time, and rust is the reason. Rust is a problem people were solving before you were born.',
    'What loosens rust is oil, and you have passed some. Think about what a lamp burns.',
    "Pour the oil flask on the rusted door — 'oil door with flask' — and the hinges will remember their job.",
  ];
  const NO_HINTS_TEXT = 'No hints for this one. The cave assumes you know what you are doing, which is generous of it.';

  it('typed hint at turn 0 reveals the grate hint, the only one active', () => {
    const { state, log } = play(cave, fresh(cave), ['hint']);
    expect(hintEvents(log[0] ?? [])).toEqual([
      { kind: 'hint', text: GRATE_RUNG, hintId: 'grate-hint', rung: 1 },
    ]);
    expect(state.score).toBe(0); // nothing scored yet; 0 - 5, floored at 0
    expect(state.hintsUsed).toBe(1);
  });

  it('once the grate is open, hint offers nothing — retired, and the door not yet reachable', () => {
    const opened = play(cave, fresh(cave), OPEN_GRATE).state;
    const { state, log } = play(cave, opened, ['hint']);
    expect(texts(log[0] ?? []).join('\n')).toContain(NO_HINTS_TEXT);
    expect(state.hintsUsed).toBe(0); // being told "no" is not a hint
  });

  it('in the grotto, three hints walk the rusted-door ladder in order; a fourth gives noHint', () => {
    const atGrotto = play(cave, fresh(cave), [...OPEN_GRATE, ...TO_GROTTO]).state;

    const { state: afterOne, log: log1 } = play(cave, atGrotto, ['hint']);
    expect(hintEvents(log1[0] ?? [])).toEqual([
      { kind: 'hint', text: DOOR_LADDER[0], hintId: 'rusted-door-hint', rung: 1 },
    ]);

    const { state: afterTwo, log: log2 } = play(cave, afterOne, ['hint']);
    expect(hintEvents(log2[0] ?? [])).toEqual([
      { kind: 'hint', text: DOOR_LADDER[1], hintId: 'rusted-door-hint', rung: 2 },
    ]);

    const { state: afterThree, log: log3 } = play(cave, afterTwo, ['hint']);
    expect(hintEvents(log3[0] ?? [])).toEqual([
      { kind: 'hint', text: DOOR_LADDER[2], hintId: 'rusted-door-hint', rung: 3 },
    ]);
    expect(afterThree.hintsUsed).toBe(3);

    const { state: afterFour, log: log4 } = play(cave, afterThree, ['hint']);
    expect(texts(log4[0] ?? []).join('\n')).toContain(NO_HINTS_TEXT);
    expect(afterFour.hintsUsed).toBe(3); // unchanged — the fourth "hint" gave nothing
  });

  it('score reflects the three deductions exactly, and hint burned no turns versus a no-hints control', () => {
    const script = [...OPEN_GRATE, ...TO_GROTTO, 'take chalice'];

    // Control: the same commands, no hint ever asked. Not hardcoded — derived
    // from the real state (grate milestone + the chalice's carry points).
    const withoutHints = play(cave, fresh(cave), script).state;
    expect(withoutHints.score).toBeGreaterThan(0);

    const hinted = play(cave, withoutHints, ['hint', 'hint', 'hint']).state;
    expect(hinted.score).toBe(withoutHints.score - 15); // 3 rungs x hintPenalty 5
    expect(hinted.turn).toBe(withoutHints.turn); // the three hints consumed no turns at all

    const { state: afterScore, log: scoreLog } = play(cave, hinted, ['score']);
    expect(texts(scoreLog[0] ?? []).join('\n')).toContain(
      `Your score is ${hinted.score} out of ${cave.manifest.maxScore} points.`,
    );
    expect(afterScore.score).toBe(hinted.score); // `score` itself changes nothing
    expect(afterScore.turn).toBe(hinted.turn); // ...and consumes no turn either
  });
});
