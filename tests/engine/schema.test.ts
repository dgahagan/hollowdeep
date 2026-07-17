import { describe, expect, it } from 'vitest';
import {
  EFFECT_KINDS,
  MODULE_DOCUMENTS,
  zAchievement,
  zAdventureModule,
  zCondition,
  zCreature,
  zEffect,
  zEvent,
  zHints,
  zId,
  zItem,
  zLocation,
  zManifest,
  zScoring,
  zStrings,
  zVocabulary,
  zWalkthrough,
  type AdventureModule,
  type Condition,
  type Effect,
  type Item,
  type Location,
} from '../../src/engine/schema';

// Schema tests for the engine↔content contract (design plan §4.1).
//
// The shape of every test is the same: a valid fixture parses, and a
// representative malformation is REJECTED. The rejection half is what earns
// the suite its keep — a schema that accepts everything also "passes" every
// happy-path test.
//
// These tests also serve as the type test. The file compiles under
// `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`, and
// the annotated fixtures below (`const x: Location = …`) mean a `z.infer` that
// drifts from the intended shape fails `npm run typecheck` rather than
// silently widening to something useless.

// ─── fixtures ────────────────────────────────────────────────────────────────

const validLocation = {
  id: 'entry-hall',
  name: 'Entry Hall',
  brief: 'A cramped hall.',
  full: 'A cramped hall of damp stone. A carving mars the far wall.',
  artId: 'entry-hall',
  light: 'lit',
  exits: {
    n: { to: 'low-passage' },
    out: { to: 'cave-mouth', oneWay: true },
  },
  scenery: [{ names: ['carving', 'wall'], description: 'Angular scratches.', readText: 'ZEEBLE' }],
} as const;

const validItem = {
  id: 'iron-key',
  names: ['key'],
  adjectives: ['iron'],
  brief: 'An iron key lies here.',
  description: 'A stubby iron key, orange with rust.',
  artId: 'iron-key',
  portable: true,
  initialLocation: 'nowhere',
} as const;

const validManifest = {
  id: 'test-cave',
  title: 'Test Cave',
  version: '1.0.0',
  engineVersion: '^1.0.0',
  startLocation: 'road',
  repositoryLocation: 'shed',
  maxScore: 100,
  carryLimit: 7,
  lamp: {
    itemId: 'brass-lamp',
    startFuel: 200,
    warnAt: [50, 20],
    warnMessageId: 'lamp-low',
    exhaustMessageId: 'lamp-dead',
    refuel: { itemId: 'oil-flask', amount: 100 },
  },
  darkness: {
    deathChance: 0.25,
    warningMessageId: 'dark-warning',
    deathMessageId: 'dark-death',
  },
} as const;

// ─── ids ─────────────────────────────────────────────────────────────────────

describe('zId', () => {
  it.each(['road', 'hollow-tree', 'twisty-1', 'inventory', 'nowhere'])('accepts %s', (id) => {
    expect(zId.safeParse(id).success).toBe(true);
  });

  // Case and separator mistakes are the ones that produce "dangling reference"
  // errors far from the typo, so they are rejected at the source.
  it.each(['Road', 'hollow_tree', 'hollow tree', '-road', 'road-', ''])('rejects %o', (id) => {
    expect(zId.safeParse(id).success).toBe(false);
  });
});

// ─── conditions ──────────────────────────────────────────────────────────────

describe('zCondition', () => {
  it('accepts a multi-field condition (fields AND together)', () => {
    const cond: Condition = zCondition.parse({ flag: 'grate-open', hasItem: 'brass-lamp' });
    expect(cond.flag).toBe('grate-open');
  });

  it('accepts each field the design plan lists', () => {
    expect(zCondition.safeParse({ notFlag: 'rat-warded' }).success).toBe(true);
    expect(zCondition.safeParse({ itemAt: { item: 'idol', location: 'shed' } }).success).toBe(true);
    expect(zCondition.safeParse({ creatureAt: { creature: 'rat', location: 'grotto' } }).success).toBe(true);
    expect(zCondition.safeParse({ visited: 'grotto' }).success).toBe(true);
    expect(zCondition.safeParse({ chance: 0.25 }).success).toBe(true);
  });

  // Added in T9: §8's `zeeble` teleports road<->entry-hall, one word whose
  // effect depends on which end you say it from. `visited` cannot express
  // that — it stays true forever once true.
  it('accepts atLocation, which asks where the player is', () => {
    const cond: Condition = zCondition.parse({ atLocation: 'ledge' });
    expect(cond.atLocation).toBe('ledge');
  });

  // Added with schema v2 — mirrors deathsAtMost exactly (hints-timers plan §5.3).
  it('accepts hintsAtMost and rejects a negative one', () => {
    const cond: Condition = zCondition.parse({ hintsAtMost: 0 });
    expect(cond.hintsAtMost).toBe(0);
    expect(zCondition.safeParse({ hintsAtMost: -1 }).success).toBe(false);
  });

  it('rejects an empty condition rather than treating it as always-true', () => {
    expect(zCondition.safeParse({}).success).toBe(false);
  });

  it('rejects an out-of-range chance', () => {
    expect(zCondition.safeParse({ chance: 1.5 }).success).toBe(false);
    expect(zCondition.safeParse({ chance: -0.1 }).success).toBe(false);
  });

  it('rejects an unknown key', () => {
    expect(zCondition.safeParse({ flagg: 'typo' }).success).toBe(false);
  });
});

// ─── effects ─────────────────────────────────────────────────────────────────

describe('zEffect', () => {
  it('accepts every variant in the frozen v2 union', () => {
    const effects: Effect[] = [
      zEffect.parse({ kind: 'print', text: 'The grate creaks open.' }),
      zEffect.parse({ kind: 'printId', id: 'dark-warning' }),
      zEffect.parse({ kind: 'setFlag', flag: 'grate-open' }),
      zEffect.parse({ kind: 'clearFlag', flag: 'grate-open' }),
      zEffect.parse({ kind: 'moveItem', item: 'iron-key', to: 'hollow-tree' }),
      zEffect.parse({ kind: 'revealExit', location: 'hollow-tree', dir: 'down' }),
      zEffect.parse({ kind: 'addScore', points: 5 }),
      zEffect.parse({ kind: 'teleport', to: 'entry-hall' }),
      zEffect.parse({ kind: 'die', messageId: 'ledge-death' }),
      zEffect.parse({ kind: 'award', achievement: 'first-treasure' }),
      zEffect.parse({ kind: 'endGame', victory: true }),
      zEffect.parse({ kind: 'activateCreature', creature: 'shadow-packrat' }),
      zEffect.parse({ kind: 'startTimer', timer: 'roof-fall', turns: 6 }),
    ];
    expect(effects).toHaveLength(EFFECT_KINDS.length);
    expect(effects.map((e) => e.kind)).toEqual([...EFFECT_KINDS]);
  });

  // The freeze is the point: this is the tripwire for someone adding a variant
  // ad hoc instead of bumping the schema version (see effects.ts banner).
  it('has exactly the 13 frozen v2 kinds', () => {
    expect([...EFFECT_KINDS]).toEqual([
      'print',
      'printId',
      'setFlag',
      'clearFlag',
      'moveItem',
      'revealExit',
      'addScore',
      'teleport',
      'die',
      'award',
      'endGame',
      'activateCreature',
      'startTimer',
    ]);
  });

  it('rejects a startTimer with zero or fractional turns', () => {
    expect(zEffect.safeParse({ kind: 'startTimer', timer: 'roof-fall', turns: 0 }).success).toBe(false);
    expect(zEffect.safeParse({ kind: 'startTimer', timer: 'roof-fall', turns: 1.5 }).success).toBe(false);
  });

  it('defaults setFlag value to true', () => {
    const effect = zEffect.parse({ kind: 'setFlag', flag: 'grate-open' });
    expect(effect).toEqual({ kind: 'setFlag', flag: 'grate-open', value: true });
  });

  it('allows a numeric flag value', () => {
    const effect = zEffect.parse({ kind: 'setFlag', flag: 'rat-encounters', value: 3 });
    expect(effect).toEqual({ kind: 'setFlag', flag: 'rat-encounters', value: 3 });
  });

  it('rejects an unknown kind', () => {
    expect(zEffect.safeParse({ kind: 'summonDragon', creature: 'x' }).success).toBe(false);
  });

  // The reason for a discriminated union over a bag of optionals: one element
  // is exactly one effect, so `do: Effect[]` order is the only ordering.
  it("rejects one variant's fields on another variant", () => {
    expect(zEffect.safeParse({ kind: 'die', victory: true }).success).toBe(false);
    expect(zEffect.safeParse({ kind: 'teleport', to: 'road', points: 5 }).success).toBe(false);
  });

  it('rejects a missing required field', () => {
    expect(zEffect.safeParse({ kind: 'moveItem', item: 'iron-key' }).success).toBe(false);
    expect(zEffect.safeParse({ kind: 'revealExit', location: 'road' }).success).toBe(false);
  });

  it('rejects a bad direction on revealExit', () => {
    expect(zEffect.safeParse({ kind: 'revealExit', location: 'road', dir: 'north' }).success).toBe(
      false,
    );
  });
});

// ─── locations ───────────────────────────────────────────────────────────────

describe('zLocation', () => {
  it('accepts a valid location', () => {
    const loc: Location = zLocation.parse(validLocation);
    expect(loc.exits.n?.to).toBe('low-passage');
  });

  it('applies exit defaults', () => {
    const loc = zLocation.parse(validLocation);
    expect(loc.exits.n).toEqual({ to: 'low-passage', hidden: false, oneWay: false });
  });

  // z.record(enum, …) in Zod 4 demands every key; exits must stay partial or
  // every location would have to declare all twelve directions.
  it('accepts a partial set of directions', () => {
    const loc = zLocation.parse({ ...validLocation, exits: { up: { to: 'road' } } });
    expect(Object.keys(loc.exits)).toEqual(['up']);
    expect(loc.exits.down).toBeUndefined();
  });

  it('accepts a location with no exits at all', () => {
    expect(zLocation.safeParse({ ...validLocation, exits: {} }).success).toBe(true);
  });

  it('accepts a conditional exit with a blocked message', () => {
    const parsed = zLocation.parse({
      ...validLocation,
      exits: {
        down: {
          to: 'entry-hall',
          if: [{ flag: 'grate-open' }],
          blockedMessage: 'The grate is locked.',
        },
      },
    });
    expect(parsed.exits.down?.if?.[0]?.flag).toBe('grate-open');
  });

  it('rejects a bad light enum', () => {
    expect(zLocation.safeParse({ ...validLocation, light: 'dim' }).success).toBe(false);
  });

  it('rejects a bad direction key', () => {
    expect(
      zLocation.safeParse({ ...validLocation, exits: { north: { to: 'road' } } }).success,
    ).toBe(false);
  });

  it('rejects a missing required field', () => {
    const { full: _full, ...withoutFull } = validLocation;
    expect(zLocation.safeParse(withoutFull).success).toBe(false);
  });

  it('rejects an unknown extra key (a typo must not be a silent no-op)', () => {
    expect(zLocation.safeParse({ ...validLocation, decsription: 'oops' }).success).toBe(false);
  });
});

// ─── items ───────────────────────────────────────────────────────────────────

describe('zItem', () => {
  it('accepts a valid item and defaults lightSource to false', () => {
    const item: Item = zItem.parse(validItem);
    expect(item.lightSource).toBe(false);
  });

  it('accepts a treasure', () => {
    const item = zItem.parse({
      ...validItem,
      id: 'jade-idol',
      treasure: { carryPoints: 20, depositPoints: 25 },
    });
    expect(item.treasure?.depositPoints).toBe(25);
  });

  it('accepts a container and defaults locked to false', () => {
    const item = zItem.parse({
      ...validItem,
      id: 'wooden-box',
      portable: false,
      container: { open: false, capacity: 3 },
    });
    expect(item.container?.locked).toBe(false);
  });

  it('accepts a locked container with a key', () => {
    expect(
      zItem.safeParse({
        ...validItem,
        id: 'wooden-box',
        container: { open: false, locked: true, keyId: 'iron-key', capacity: 3 },
      }).success,
    ).toBe(true);
  });

  // `container` is where open/closed/locked state lives, so it is also how a
  // door is modelled — §8's grate is openable, lockable, and holds nothing.
  it('accepts a capacity-0 container (an openable that holds nothing, e.g. a grate)', () => {
    expect(
      zItem.safeParse({
        ...validItem,
        id: 'grate',
        portable: false,
        container: { open: false, locked: true, keyId: 'iron-key', capacity: 0 },
      }).success,
    ).toBe(true);
  });

  it('rejects a negative capacity', () => {
    expect(
      zItem.safeParse({
        ...validItem,
        id: 'grate',
        container: { open: false, capacity: -1 },
      }).success,
    ).toBe(false);
  });

  it('rejects a locked container with no key (nothing could ever open it)', () => {
    expect(
      zItem.safeParse({
        ...validItem,
        id: 'wooden-box',
        container: { open: false, locked: true, capacity: 3 },
      }).success,
    ).toBe(false);
  });

  it('rejects an unattainable treasure (points on a non-portable item)', () => {
    expect(
      zItem.safeParse({
        ...validItem,
        portable: false,
        treasure: { carryPoints: 20, depositPoints: 25 },
      }).success,
    ).toBe(false);
  });

  it('rejects an empty names list', () => {
    expect(zItem.safeParse({ ...validItem, names: [] }).success).toBe(false);
  });

  it('rejects negative treasure points', () => {
    expect(
      zItem.safeParse({ ...validItem, treasure: { carryPoints: -5, depositPoints: 25 } }).success,
    ).toBe(false);
  });

  it('rejects an unknown extra key', () => {
    expect(zItem.safeParse({ ...validItem, weight: 3 }).success).toBe(false);
  });
});

// ─── creatures ───────────────────────────────────────────────────────────────

describe('zCreature', () => {
  const validStalker = {
    id: 'cave-rat',
    names: ['rat'],
    description: 'A rat the size of a terrier.',
    artId: 'cave-rat',
    behavior: 'stalker',
    spawn: { locations: ['grotto', 'twisty-1'], afterTurn: 5 },
    moveEvery: 3,
    aggression: 0.3,
    wardOff: { itemIds: ['brass-lamp'] },
    deathMessageId: 'rat-death',
  } as const;

  const validThief = {
    id: 'shadow-packrat',
    names: ['packrat', 'shadow'],
    description: 'Something small and acquisitive.',
    artId: 'shadow-packrat',
    behavior: 'thief',
    spawn: { locations: ['twisty-1'], if: [{ flag: 'carrying-treasure' }] },
    stealsTreasure: true,
    stashLocation: 'twisty-2',
    stealAfterTurns: 4,
  } as const;

  it('accepts a valid stalker', () => {
    expect(zCreature.parse(validStalker).aggression).toBe(0.3);
  });

  it('accepts a valid thief', () => {
    expect(zCreature.parse(validThief).stashLocation).toBe('twisty-2');
  });

  it('accepts a static creature with none of the behavior knobs', () => {
    expect(
      zCreature.safeParse({
        id: 'stone-idol',
        names: ['idol'],
        description: 'It watches.',
        artId: 'stone-idol',
        behavior: 'static',
        spawn: { locations: ['grotto'] },
      }).success,
    ).toBe(true);
  });

  // The regression guard for the 2026-07-15 deterministic-thief decision.
  // A thief that rolls breaks seed-independent completability (T23), and it
  // fails at a distance — as a flaky seed — so it is refused at the source.
  it('rejects a thief with an aggression roll (the thief consumes no RNG)', () => {
    const result = zCreature.safeParse({ ...validThief, aggression: 0.5 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('deterministic'))).toBe(true);
    }
  });

  it('rejects a thief with no stashLocation (stolen treasure would be unrecoverable)', () => {
    const { stashLocation: _s, ...noStash } = validThief;
    expect(zCreature.safeParse(noStash).success).toBe(false);
  });

  it('rejects a thief with no stealAfterTurns', () => {
    const { stealAfterTurns: _t, ...noTiming } = validThief;
    expect(zCreature.safeParse(noTiming).success).toBe(false);
  });

  it('rejects a stalker with no aggression (it could never attack)', () => {
    const { aggression: _a, ...noAggression } = validStalker;
    expect(zCreature.safeParse(noAggression).success).toBe(false);
  });

  it('rejects a stalker with no moveEvery (it could never move)', () => {
    const { moveEvery: _m, ...noMove } = validStalker;
    expect(zCreature.safeParse(noMove).success).toBe(false);
  });

  it('rejects a bad behavior enum', () => {
    expect(zCreature.safeParse({ ...validStalker, behavior: 'wanderer' }).success).toBe(false);
  });

  it('rejects an out-of-range aggression', () => {
    expect(zCreature.safeParse({ ...validStalker, aggression: 1.5 }).success).toBe(false);
  });

  it('rejects an empty spawn locations list', () => {
    expect(zCreature.safeParse({ ...validStalker, spawn: { locations: [] } }).success).toBe(false);
  });

  it('rejects an unknown extra key', () => {
    expect(zCreature.safeParse({ ...validStalker, hitPoints: 3 }).success).toBe(false);
  });
});

// ─── events ──────────────────────────────────────────────────────────────────

describe('zEvent', () => {
  const validEvent = {
    id: 'reveal-key',
    once: true,
    on: { type: 'excavate', target: 'tree' },
    do: [{ kind: 'moveItem', item: 'iron-key', to: 'hollow-tree' }],
  };

  it('accepts a valid event and defaults once to false', () => {
    const event = zEvent.parse({
      id: 'grate-creak',
      on: { type: 'enter', target: 'cave-mouth' },
      do: [{ kind: 'print', text: 'The grate creaks.' }],
    });
    expect(event.once).toBe(false);
  });

  it('accepts each trigger type the design plan lists', () => {
    // `search` and `verb` were added in T9 — §8's `search tree` and `jump`
    // hazard have no other expression. `timerExpired` arrived with schema v2
    // (its target is a timer id). See event.ts.
    const types = ['enter', 'take', 'drop', 'use', 'read', 'open', 'search', 'verb', 'flagSet', 'timerExpired'];
    for (const type of types) {
      expect(
        zEvent.safeParse({
          id: 'e',
          on: { type, target: 'thing' },
          do: [{ kind: 'print', text: 'x' }],
        }).success,
      ).toBe(true);
    }
    expect(
      zEvent.safeParse({
        id: 'e',
        on: { type: 'turnStart', turn: 10 },
        do: [{ kind: 'print', text: 'x' }],
      }).success,
    ).toBe(true);
    expect(
      zEvent.safeParse({
        id: 'e',
        on: { type: 'word', word: 'zeeble' },
        do: [{ kind: 'teleport', to: 'entry-hall' }],
      }).success,
    ).toBe(true);
  });

  it('rejects a trigger type outside the frozen list', () => {
    expect(zEvent.safeParse(validEvent).success).toBe(false);
  });

  it('rejects a turnStart trigger with no turn', () => {
    expect(
      zEvent.safeParse({ id: 'e', on: { type: 'turnStart' }, do: [{ kind: 'print', text: 'x' }] })
        .success,
    ).toBe(false);
  });

  it('rejects a word trigger with no word', () => {
    expect(
      zEvent.safeParse({ id: 'e', on: { type: 'word' }, do: [{ kind: 'print', text: 'x' }] })
        .success,
    ).toBe(false);
  });

  it('rejects a verb trigger with no target verb', () => {
    expect(
      zEvent.safeParse({ id: 'e', on: { type: 'verb' }, do: [{ kind: 'die' }] }).success,
    ).toBe(false);
  });

  it('rejects a timerExpired trigger with no target timer', () => {
    expect(
      zEvent.safeParse({ id: 'e', on: { type: 'timerExpired' }, do: [{ kind: 'die' }] }).success,
    ).toBe(false);
  });

  it('rejects an event that does nothing', () => {
    expect(zEvent.safeParse({ id: 'e', on: { type: 'enter', target: 'road' }, do: [] }).success).toBe(
      false,
    );
  });
});

// ─── vocabulary ──────────────────────────────────────────────────────────────

describe('zVocabulary', () => {
  it('accepts an empty vocabulary and defaults every list', () => {
    expect(zVocabulary.parse({})).toEqual({ verbs: [], noiseWords: [], magicWords: [] });
  });

  it('accepts a verb with several patterns', () => {
    const vocab = zVocabulary.parse({
      verbs: [{ id: 'oil', words: ['oil', 'lubricate'], patterns: ['VN', 'VNPN'] }],
      noiseWords: ['the', 'a'],
      magicWords: [{ word: 'zeeble', eventId: 'zeeble-teleport' }],
    });
    expect(vocab.verbs[0]?.patterns).toEqual(['VN', 'VNPN']);
  });

  it('rejects a bad pattern', () => {
    expect(
      zVocabulary.safeParse({ verbs: [{ id: 'oil', words: ['oil'], patterns: ['VNP'] }] }).success,
    ).toBe(false);
  });

  it('rejects a verb with no words', () => {
    expect(zVocabulary.safeParse({ verbs: [{ id: 'oil', words: [], patterns: ['VN'] }] }).success).toBe(
      false,
    );
  });
});

// ─── scoring ─────────────────────────────────────────────────────────────────

describe('zScoring', () => {
  const validScoring = {
    milestones: [{ id: 'grate-opened', points: 10, when: [{ flag: 'grate-open' }] }],
    deathPenalty: 10,
    hintPenalty: 5,
    ranks: [
      { minScore: 0, title: 'Tourist' },
      { minScore: 50, title: 'Spelunker' },
      { minScore: 100, title: 'Master Cartographer' },
    ],
  };

  it('accepts a valid scoring table', () => {
    expect(zScoring.parse(validScoring).ranks).toHaveLength(3);
  });

  it('rejects a rank table with no floor', () => {
    expect(
      zScoring.safeParse({ ...validScoring, ranks: [{ minScore: 50, title: 'Spelunker' }] }).success,
    ).toBe(false);
  });

  it('rejects duplicate rank thresholds (array order must not decide the winner)', () => {
    expect(
      zScoring.safeParse({
        ...validScoring,
        ranks: [
          { minScore: 0, title: 'Tourist' },
          { minScore: 0, title: 'Trespasser' },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects a milestone with no when clause', () => {
    expect(
      zScoring.safeParse({ ...validScoring, milestones: [{ id: 'grate-opened', points: 10 }] })
        .success,
    ).toBe(false);
  });

  it('rejects a negative death penalty (it is a deduction, stored positive)', () => {
    expect(zScoring.safeParse({ ...validScoring, deathPenalty: -10 }).success).toBe(false);
  });

  it('rejects a missing or negative hint penalty (same deduction rules as deathPenalty)', () => {
    const { hintPenalty: _h, ...noHintPenalty } = validScoring;
    expect(zScoring.safeParse(noHintPenalty).success).toBe(false);
    expect(zScoring.safeParse({ ...validScoring, hintPenalty: -5 }).success).toBe(false);
  });
});

// ─── hints ───────────────────────────────────────────────────────────────────

describe('zHints', () => {
  const validHints = {
    noHintMessageId: 'no-hints',
    hints: [
      {
        id: 'pump-gate',
        when: [{ all: [{ visited: 'shaft-head' }, { notFlag: 'pump-drained' }] }],
        ladder: ['A nudge.', 'A hint.', 'The solution.'],
      },
    ],
  };

  it('accepts a full ladder', () => {
    const hints = zHints.parse(validHints);
    expect(hints.hints[0]?.ladder).toHaveLength(3);
  });

  it('accepts the minimal legal document — required, but may be empty', () => {
    expect(zHints.parse({ noHintMessageId: 'no-hints', hints: [] }).hints).toEqual([]);
  });

  it('rejects a missing noHintMessageId (an adventure may offer no hints, but not silently)', () => {
    expect(zHints.safeParse({ hints: [] }).success).toBe(false);
  });

  it('rejects an empty ladder', () => {
    expect(
      zHints.safeParse({
        ...validHints,
        hints: [{ id: 'x', when: [{ flag: 'f' }], ladder: [] }],
      }).success,
    ).toBe(false);
  });

  it('rejects a hint with no when clause (an always-available hint is a typo)', () => {
    expect(
      zHints.safeParse({
        ...validHints,
        hints: [{ id: 'x', when: [], ladder: ['A nudge.'] }],
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown key', () => {
    expect(
      zHints.safeParse({
        ...validHints,
        hints: [{ id: 'x', when: [{ flag: 'f' }], ladder: ['A nudge.'], until: [] }],
      }).success,
    ).toBe(false);
  });
});

// ─── achievements, strings, walkthrough ──────────────────────────────────────

describe('zAchievement', () => {
  it('accepts a valid achievement and defaults hidden to false', () => {
    const achievement = zAchievement.parse({
      id: 'first-treasure',
      name: 'Magpie',
      description: 'Pick up your first treasure.',
    });
    expect(achievement.hidden).toBe(false);
  });

  it('rejects a missing description', () => {
    expect(zAchievement.safeParse({ id: 'first-treasure', name: 'Magpie' }).success).toBe(false);
  });
});

describe('zStrings', () => {
  it('accepts a string table', () => {
    expect(zStrings.parse({ 'dark-death': 'You stumble in the dark.' })['dark-death']).toBe(
      'You stumble in the dark.',
    );
  });

  it('rejects a non-kebab key', () => {
    expect(zStrings.safeParse({ darkDeath: 'x' }).success).toBe(false);
  });

  it('rejects an empty message', () => {
    expect(zStrings.safeParse({ 'dark-death': '' }).success).toBe(false);
  });
});

describe('zWalkthrough', () => {
  it('accepts steps with string and array expectations', () => {
    const walkthrough = zWalkthrough.parse({
      steps: [
        { cmd: 'n' },
        { cmd: 'take lamp', expect: 'Taken.' },
        { cmd: 'look', expect: ['shed', 'shelf'] },
      ],
      expectedScore: 100,
      expectedRank: 'Master Cartographer',
      expectedAchievements: ['first-treasure', 'no-deaths'],
    });
    expect(walkthrough.steps).toHaveLength(3);
  });

  it('defaults expectedAchievements to an empty list', () => {
    const walkthrough = zWalkthrough.parse({ steps: [{ cmd: 'look' }], expectedScore: 0 });
    expect(walkthrough.expectedAchievements).toEqual([]);
  });

  it('rejects an empty walkthrough', () => {
    expect(zWalkthrough.safeParse({ steps: [], expectedScore: 100 }).success).toBe(false);
  });

  it('rejects an empty command', () => {
    expect(zWalkthrough.safeParse({ steps: [{ cmd: '' }], expectedScore: 0 }).success).toBe(false);
  });
});

// ─── manifest ────────────────────────────────────────────────────────────────

describe('zManifest', () => {
  it('accepts a valid manifest', () => {
    expect(zManifest.parse(validManifest).carryLimit).toBe(7);
  });

  it('defaults refuel.consumesItem to true', () => {
    expect(zManifest.parse(validManifest).lamp.refuel?.consumesItem).toBe(true);
  });

  it('accepts a lamp with no refuel mechanic', () => {
    const { refuel: _r, ...lampNoRefuel } = validManifest.lamp;
    expect(zManifest.safeParse({ ...validManifest, lamp: lampNoRefuel }).success).toBe(true);
  });

  it('rejects a non-semver version', () => {
    expect(zManifest.safeParse({ ...validManifest, version: '1.0' }).success).toBe(false);
    expect(zManifest.safeParse({ ...validManifest, version: 'v1.0.0' }).success).toBe(false);
  });

  it('rejects an out-of-range darkness deathChance', () => {
    expect(
      zManifest.safeParse({
        ...validManifest,
        darkness: { ...validManifest.darkness, deathChance: 2 },
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate lamp warnAt thresholds', () => {
    expect(
      zManifest.safeParse({ ...validManifest, lamp: { ...validManifest.lamp, warnAt: [20, 20] } })
        .success,
    ).toBe(false);
  });

  it('rejects a zero carryLimit', () => {
    expect(zManifest.safeParse({ ...validManifest, carryLimit: 0 }).success).toBe(false);
  });

  it('rejects an unknown extra key', () => {
    expect(zManifest.safeParse({ ...validManifest, author: 'nobody' }).success).toBe(false);
  });
});

// ─── the assembled module ────────────────────────────────────────────────────

describe('zAdventureModule', () => {
  const minimalModule = {
    manifest: validManifest,
    locations: [validLocation],
    items: [validItem],
    creatures: [],
    vocabulary: {},
    events: [],
    scoring: {
      milestones: [],
      deathPenalty: 10,
      hintPenalty: 5,
      ranks: [{ minScore: 0, title: 'Tourist' }],
    },
    achievements: [],
    strings: { 'dark-warning': 'It is pitch dark.', 'dark-death': 'You fall.' },
    walkthrough: { steps: [{ cmd: 'look' }], expectedScore: 0 },
    hints: { noHintMessageId: 'dark-warning', hints: [] },
  };

  it('assembles a whole module', () => {
    const parsed: AdventureModule = zAdventureModule.parse(minimalModule);
    expect(parsed.manifest.id).toBe('test-cave');
    expect(parsed.locations).toHaveLength(1);
    expect(parsed.vocabulary.verbs).toEqual([]);
  });

  it('rejects a module with no locations', () => {
    expect(zAdventureModule.safeParse({ ...minimalModule, locations: [] }).success).toBe(false);
  });

  it('rejects a missing document', () => {
    const { scoring: _s, ...noScoring } = minimalModule;
    expect(zAdventureModule.safeParse(noScoring).success).toBe(false);
  });

  it('rejects an unknown document', () => {
    expect(zAdventureModule.safeParse({ ...minimalModule, journal: [] }).success).toBe(false);
  });

  it('maps every document filename to a schema', () => {
    expect(Object.keys(MODULE_DOCUMENTS).sort()).toEqual(
      [
        'achievements.json',
        'creatures.json',
        'events.json',
        'hints.json',
        'items.json',
        'locations.json',
        'manifest.json',
        'scoring.json',
        'strings.json',
        'vocabulary.json',
        'walkthrough.json',
      ].sort(),
    );
  });

  // The document map and the assembled module must not drift apart: one lists
  // the files on disk, the other the parsed result, and the loader (T6) walks
  // the first to build the second.
  it('has one document per module key', () => {
    expect(Object.keys(MODULE_DOCUMENTS)).toHaveLength(
      Object.keys(zAdventureModule.shape).length,
    );
  });
});
