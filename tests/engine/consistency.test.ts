import { describe, expect, it } from 'vitest';
import { zAdventureModule, type AdventureModule } from '../../src/engine/schema';
import { checkConsistency, type ConsistencyError } from '../../src/engine/schema/consistency';

// Consistency checks for the engine↔content contract (design plan §4.2, layer
// 2). Every test derives its broken variant from ONE small valid fixture via
// structuredClone + mutate, per the task brief — this keeps each test's diff
// from the baseline obvious and avoids 35 hand-written near-duplicate
// modules. Assertions key off `code` (plus `document`/`id`/`field`), never
// message prose, matching the golden-test contract T8 will build on.

// ─── the valid fixture ──────────────────────────────────────────────────────
//
// Small, but touches every reference kind checkConsistency validates:
//   - a plain exit (road -> shed), a hidden exit (cave -> vault) revealed by
//     an event, and the reachability BFS following it regardless;
//   - a treasure (idol) with carry+deposit points feeding maxScore;
//   - a locked container (box) with a real keyId;
//   - a lamp (lightSource: true) with a refuel item;
//   - printId, die, award, activateCreature, teleport, moveItem, setFlag,
//     clearFlag, and a once:true addScore effect, all resolving cleanly;
//   - a magic word pointing at a real event;
//   - a milestone whose flag read is satisfied by a real setFlag/clearFlag;
//   - a static creature so spawn.locations and artId get checked too.
//
// maxScore = idol (20 + 25) + vault-milestone (10) + bonus-idol addScore (5,
// once: true) = 60.

const rawValidModule = {
  manifest: {
    id: 'consistency-fixture',
    title: 'Consistency Fixture',
    version: '1.0.0',
    engineVersion: '^1.0.0',
    startLocation: 'road',
    repositoryLocation: 'shed',
    maxScore: 60,
    carryLimit: 7,
    lamp: {
      itemId: 'lamp',
      startFuel: 100,
      warnAt: [20],
      warnMessageId: 'lamp-low',
      exhaustMessageId: 'lamp-dead',
      refuel: { itemId: 'oil-flask', amount: 50 },
    },
    darkness: {
      deathChance: 0.1,
      warningMessageId: 'dark-warning',
      deathMessageId: 'dark-death',
    },
  },
  locations: [
    {
      id: 'road',
      name: 'Road',
      brief: 'A dusty road.',
      full: 'A dusty road running past a cave mouth.',
      artId: 'road',
      light: 'lit',
      exits: { e: { to: 'shed' }, n: { to: 'cave' } },
    },
    {
      id: 'shed',
      name: 'Shed',
      brief: 'A small shed.',
      full: 'A small shed, its door hanging loose.',
      artId: 'shed',
      light: 'lit',
      exits: { w: { to: 'road' } },
    },
    {
      id: 'cave',
      name: 'Cave',
      brief: 'A dark cave.',
      full: 'A dark, damp cave.',
      artId: 'cave',
      light: 'dark',
      exits: { s: { to: 'road' }, down: { to: 'vault', hidden: true } },
    },
    {
      id: 'vault',
      name: 'Vault',
      brief: 'A hidden vault.',
      full: 'A hidden vault behind the cave.',
      artId: 'vault',
      light: 'dark',
      exits: { up: { to: 'cave' } },
    },
  ],
  items: [
    {
      id: 'lamp',
      names: ['lamp'],
      brief: 'A brass lamp lies here.',
      description: 'A dependable brass lamp.',
      artId: 'lamp',
      portable: true,
      initialLocation: 'inventory',
      lightSource: true,
    },
    {
      id: 'oil-flask',
      names: ['flask'],
      brief: 'An oil flask lies here.',
      description: 'A small flask of lamp oil.',
      artId: 'oil-flask',
      portable: true,
      initialLocation: 'inventory',
    },
    {
      id: 'idol',
      names: ['idol'],
      brief: 'A jade idol lies here.',
      description: 'A small jade idol, cool to the touch.',
      artId: 'idol',
      portable: true,
      initialLocation: 'cave',
      treasure: { carryPoints: 20, depositPoints: 25 },
    },
    {
      id: 'key',
      names: ['key'],
      brief: 'A small key lies here.',
      description: 'A small brass key.',
      artId: 'key',
      portable: true,
      initialLocation: 'vault',
    },
    {
      id: 'box',
      names: ['box'],
      brief: 'A wooden box sits here.',
      description: 'A sturdy wooden box.',
      artId: 'box',
      portable: false,
      initialLocation: 'shed',
      container: { open: false, locked: true, keyId: 'key', capacity: 3 },
    },
  ],
  creatures: [
    {
      id: 'rat',
      names: ['rat'],
      description: 'A watchful cave rat.',
      artId: 'rat',
      behavior: 'static',
      spawn: { locations: ['cave'] },
    },
  ],
  vocabulary: {
    verbs: [],
    noiseWords: [],
    magicWords: [{ word: 'zeeble', eventId: 'teleport-home' }],
  },
  events: [
    {
      id: 'reveal-vault',
      once: true,
      on: { type: 'enter', target: 'cave' },
      do: [
        { kind: 'revealExit', location: 'cave', dir: 'down' },
        { kind: 'printId', id: 'reveal-msg' },
        { kind: 'setFlag', flag: 'vault-open' },
      ],
    },
    {
      id: 'clear-vault-open',
      once: false,
      on: { type: 'drop', target: 'idol' },
      do: [{ kind: 'clearFlag', flag: 'vault-open' }],
    },
    {
      id: 'activate-rat',
      once: true,
      on: { type: 'enter', target: 'vault' },
      do: [{ kind: 'activateCreature', creature: 'rat' }],
    },
    {
      id: 'bonus-idol',
      once: true,
      on: { type: 'take', target: 'idol' },
      do: [{ kind: 'addScore', points: 5 }],
    },
    {
      id: 'award-first-treasure',
      once: true,
      on: { type: 'take', target: 'idol' },
      do: [{ kind: 'award', achievement: 'first-treasure' }],
    },
    {
      id: 'stash-key',
      once: true,
      on: { type: 'open', target: 'box' },
      do: [{ kind: 'moveItem', item: 'key', to: 'box' }],
    },
    {
      id: 'trap-die',
      once: false,
      on: { type: 'enter', target: 'vault' },
      if: [{ chance: 0.1 }],
      do: [{ kind: 'die', messageId: 'trap-death' }],
    },
    {
      id: 'teleport-home',
      once: false,
      on: { type: 'word', word: 'zeeble' },
      do: [{ kind: 'teleport', to: 'road' }],
    },
  ],
  scoring: {
    milestones: [{ id: 'vault-milestone', points: 10, when: [{ flag: 'vault-open' }] }],
    deathPenalty: 10,
    ranks: [
      { minScore: 0, title: 'Tourist' },
      { minScore: 35, title: 'Spelunker' },
    ],
  },
  achievements: [
    { id: 'first-treasure', name: 'Magpie', description: 'Pick up your first treasure.' },
  ],
  strings: {
    'lamp-low': 'The lamp is getting dim.',
    'lamp-dead': 'The lamp goes out.',
    'dark-warning': 'It is pitch dark.',
    'dark-death': 'You stumble and fall.',
    'reveal-msg': 'A section of the floor grinds aside, revealing a passage down.',
    'trap-death': 'The floor gives way beneath you.',
  },
  walkthrough: {
    steps: [{ cmd: 'look' }],
    expectedScore: 60,
  },
};

const validModule: AdventureModule = zAdventureModule.parse(rawValidModule);

// One format, matching the fixture manifest's `artFormat` (defaults to 'svg').
// An earlier version deliberately mixed .svg/.png/.webp to prove the artId
// match was extension-agnostic — which turned out to be the bug, not a feature:
// the UI can only request ONE extension, so a validator that accepts any of
// them passes modules the app cannot load.
const validArtFiles = [
  'road.svg',
  'shed.svg',
  'cave.svg',
  'vault.svg',
  'lamp.svg',
  'oil-flask.svg',
  'idol.svg',
  'key.svg',
  'box.svg',
  'rat.svg',
];

/** Clone the valid module and apply a mutation, for a readable one-off broken variant. */
function mutate(fn: (m: AdventureModule) => void): AdventureModule {
  const clone = structuredClone(validModule);
  fn(clone);
  return clone;
}

function hasError(
  errors: ConsistencyError[],
  expected: Partial<ConsistencyError>,
): boolean {
  return errors.some((e) =>
    Object.entries(expected).every(([key, value]) => e[key as keyof ConsistencyError] === value),
  );
}

// ─── baseline ────────────────────────────────────────────────────────────────

describe('checkConsistency — clean module', () => {
  it('produces exactly [] for a valid module', () => {
    expect(checkConsistency(validModule, validArtFiles)).toEqual([]);
  });
});

// ─── reference checks ───────────────────────────────────────────────────────

describe('checkConsistency — dangling references', () => {
  it('flags a dangling exit target', () => {
    const broken = mutate((m) => {
      const road = m.locations.find((l) => l.id === 'road');
      if (road?.exits.e) road.exits.e.to = 'nowhere-place';
    });
    const errors = checkConsistency(broken, validArtFiles);
    expect(
      hasError(errors, {
        code: 'dangling-exit-target',
        document: 'locations.json',
        id: 'road',
        field: 'exits.e.to',
      }),
    ).toBe(true);
  });

  it('flags a dangling item initialLocation', () => {
    const broken = mutate((m) => {
      const idol = m.items.find((i) => i.id === 'idol');
      if (idol) idol.initialLocation = 'nowhere-place';
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-item-initial-location',
        document: 'items.json',
        id: 'idol',
        field: 'initialLocation',
      }),
    ).toBe(true);
  });

  it('accepts an initialLocation that resolves to a container item', () => {
    const clone = mutate((m) => {
      const key = m.items.find((i) => i.id === 'key');
      if (key) key.initialLocation = 'box';
    });
    expect(
      checkConsistency(clone, validArtFiles).some((e) => e.field === 'initialLocation'),
    ).toBe(false);
  });

  it('flags a dangling container.keyId', () => {
    const broken = mutate((m) => {
      const box = m.items.find((i) => i.id === 'box');
      if (box?.container) box.container.keyId = 'no-such-item';
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-container-key',
        document: 'items.json',
        id: 'box',
        field: 'container.keyId',
      }),
    ).toBe(true);
  });

  it('flags a dangling creature spawn location', () => {
    const broken = mutate((m) => {
      const rat = m.creatures.find((c) => c.id === 'rat');
      if (rat) rat.spawn.locations = ['nowhere-place'];
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-spawn-location',
        document: 'creatures.json',
        id: 'rat',
        field: 'spawn.locations[0]',
      }),
    ).toBe(true);
  });

  it('flags a dangling creature stashLocation', () => {
    const broken = mutate((m) => {
      const rat = m.creatures.find((c) => c.id === 'rat');
      if (rat) rat.stashLocation = 'nowhere-place';
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-stash-location',
        document: 'creatures.json',
        id: 'rat',
        field: 'stashLocation',
      }),
    ).toBe(true);
  });

  it('flags a dangling moveItem.item', () => {
    const broken = mutate((m) => {
      const event = m.events.find((e) => e.id === 'stash-key');
      const effect = event?.do[0];
      if (effect?.kind === 'moveItem') effect.item = 'no-such-item';
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-move-item-item',
        document: 'events.json',
        id: 'stash-key',
        field: 'do[0].item',
      }),
    ).toBe(true);
  });

  it('flags a dangling moveItem.to', () => {
    const broken = mutate((m) => {
      const event = m.events.find((e) => e.id === 'stash-key');
      const effect = event?.do[0];
      if (effect?.kind === 'moveItem') effect.to = 'nowhere-place';
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-move-item-target',
        document: 'events.json',
        id: 'stash-key',
        field: 'do[0].to',
      }),
    ).toBe(true);
  });

  it('flags a revealExit pointing at an unknown location', () => {
    const broken = mutate((m) => {
      const event = m.events.find((e) => e.id === 'reveal-vault');
      const effect = event?.do[0];
      if (effect?.kind === 'revealExit') effect.location = 'nowhere-place';
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-reveal-exit-location',
        document: 'events.json',
        id: 'reveal-vault',
        field: 'do[0].location',
      }),
    ).toBe(true);
  });

  it('flags a revealExit naming a direction the location has no exit for', () => {
    const broken = mutate((m) => {
      const event = m.events.find((e) => e.id === 'reveal-vault');
      const effect = event?.do[0];
      if (effect?.kind === 'revealExit') effect.dir = 'n';
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'reveal-exit-target-missing',
        document: 'events.json',
        id: 'reveal-vault',
        field: 'do[0].dir',
      }),
    ).toBe(true);
  });

  it('flags a revealExit targeting an exit that is not hidden (a no-op)', () => {
    const broken = mutate((m) => {
      const cave = m.locations.find((l) => l.id === 'cave');
      if (cave?.exits.down) cave.exits.down.hidden = false;
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'reveal-exit-not-hidden',
        document: 'events.json',
        id: 'reveal-vault',
        field: 'do[0].dir',
      }),
    ).toBe(true);
  });

  it('flags a dangling teleport target', () => {
    const broken = mutate((m) => {
      const event = m.events.find((e) => e.id === 'teleport-home');
      const effect = event?.do[0];
      if (effect?.kind === 'teleport') effect.to = 'nowhere-place';
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-teleport-target',
        document: 'events.json',
        id: 'teleport-home',
        field: 'do[0].to',
      }),
    ).toBe(true);
  });

  it('flags a dangling printId', () => {
    const broken = mutate((m) => {
      const event = m.events.find((e) => e.id === 'reveal-vault');
      const effect = event?.do[1];
      if (effect?.kind === 'printId') effect.id = 'no-such-string';
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-print-id',
        document: 'events.json',
        id: 'reveal-vault',
        field: 'do[1].id',
      }),
    ).toBe(true);
  });

  it('flags a dangling die.messageId', () => {
    const broken = mutate((m) => {
      const event = m.events.find((e) => e.id === 'trap-die');
      const effect = event?.do[0];
      if (effect?.kind === 'die') effect.messageId = 'no-such-string';
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-die-message',
        document: 'events.json',
        id: 'trap-die',
        field: 'do[0].messageId',
      }),
    ).toBe(true);
  });

  it('flags a dangling award.achievement', () => {
    const broken = mutate((m) => {
      const event = m.events.find((e) => e.id === 'award-first-treasure');
      const effect = event?.do[0];
      if (effect?.kind === 'award') effect.achievement = 'no-such-achievement';
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-award-achievement',
        document: 'events.json',
        id: 'award-first-treasure',
        field: 'do[0].achievement',
      }),
    ).toBe(true);
  });

  it('flags a dangling activateCreature.creature', () => {
    const broken = mutate((m) => {
      const event = m.events.find((e) => e.id === 'activate-rat');
      const effect = event?.do[0];
      if (effect?.kind === 'activateCreature') effect.creature = 'no-such-creature';
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-activate-creature',
        document: 'events.json',
        id: 'activate-rat',
        field: 'do[0].creature',
      }),
    ).toBe(true);
  });

  it('flags a dangling magic word eventId', () => {
    const broken = mutate((m) => {
      const mw = m.vocabulary.magicWords[0];
      if (mw) mw.eventId = 'no-such-event';
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-magic-word-event',
        document: 'vocabulary.json',
        id: 'zeeble',
        field: 'magicWords[0].eventId',
      }),
    ).toBe(true);
  });

  it('flags a dangling manifest.startLocation (and skips reachability, not manufacturing orphans)', () => {
    const broken = mutate((m) => {
      m.manifest.startLocation = 'nowhere-place';
    });
    const errors = checkConsistency(broken, validArtFiles);
    expect(
      hasError(errors, {
        code: 'dangling-start-location',
        document: 'manifest.json',
        id: 'manifest',
        field: 'startLocation',
      }),
    ).toBe(true);
    expect(errors.some((e) => e.code === 'orphan-location')).toBe(false);
  });

  it('flags a dangling manifest.repositoryLocation', () => {
    const broken = mutate((m) => {
      m.manifest.repositoryLocation = 'nowhere-place';
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-repository-location',
        document: 'manifest.json',
        id: 'manifest',
        field: 'repositoryLocation',
      }),
    ).toBe(true);
  });

  it('flags a dangling manifest.lamp.itemId', () => {
    const broken = mutate((m) => {
      m.manifest.lamp.itemId = 'no-such-item';
    });
    const errors = checkConsistency(broken, validArtFiles);
    expect(
      hasError(errors, {
        code: 'dangling-lamp-item',
        document: 'manifest.json',
        id: 'manifest',
        field: 'lamp.itemId',
      }),
    ).toBe(true);
    // The item doesn't exist, so lightSource can't be checked either.
    expect(errors.some((e) => e.code === 'lamp-item-not-light-source')).toBe(false);
  });

  it('flags a lamp itemId that resolves but has no lightSource', () => {
    const broken = mutate((m) => {
      const lamp = m.items.find((i) => i.id === 'lamp');
      if (lamp) lamp.lightSource = false;
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'lamp-item-not-light-source',
        document: 'manifest.json',
        id: 'manifest',
        field: 'lamp.itemId',
      }),
    ).toBe(true);
  });

  it('flags a dangling manifest.lamp.refuel.itemId', () => {
    const broken = mutate((m) => {
      if (m.manifest.lamp.refuel) m.manifest.lamp.refuel.itemId = 'no-such-item';
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-lamp-refuel-item',
        document: 'manifest.json',
        id: 'manifest',
        field: 'lamp.refuel.itemId',
      }),
    ).toBe(true);
  });

  it('flags a dangling manifest.lamp.warnMessageId', () => {
    const broken = mutate((m) => {
      m.manifest.lamp.warnMessageId = 'no-such-string';
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-lamp-warn-message',
        document: 'manifest.json',
        id: 'manifest',
        field: 'lamp.warnMessageId',
      }),
    ).toBe(true);
  });

  it('flags a dangling manifest.lamp.exhaustMessageId', () => {
    const broken = mutate((m) => {
      m.manifest.lamp.exhaustMessageId = 'no-such-string';
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-lamp-exhaust-message',
        document: 'manifest.json',
        id: 'manifest',
        field: 'lamp.exhaustMessageId',
      }),
    ).toBe(true);
  });

  it('flags a dangling manifest.darkness.warningMessageId', () => {
    const broken = mutate((m) => {
      m.manifest.darkness.warningMessageId = 'no-such-string';
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-darkness-warning-message',
        document: 'manifest.json',
        id: 'manifest',
        field: 'darkness.warningMessageId',
      }),
    ).toBe(true);
  });

  it('flags a dangling manifest.darkness.deathMessageId', () => {
    const broken = mutate((m) => {
      m.manifest.darkness.deathMessageId = 'no-such-string';
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-darkness-death-message',
        document: 'manifest.json',
        id: 'manifest',
        field: 'darkness.deathMessageId',
      }),
    ).toBe(true);
  });
});

// ─── condition reference checks ─────────────────────────────────────────────

// Added in T9. A trigger's `target` is a reference like any other, and a
// typo'd one is the quietest bug available: the event simply never fires and
// the content reads as though it should.
describe('checkConsistency — trigger targets', () => {
  it('flags an enter trigger naming an unknown location', () => {
    const broken = mutate((m) => {
      const event = m.events[0];
      if (event) event.on = { type: 'enter', target: 'no-such-place' };
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-trigger-target',
        document: 'events.json',
        field: 'on.target',
      }),
    ).toBe(true);
  });

  it('flags a search trigger naming an unknown item', () => {
    const broken = mutate((m) => {
      const event = m.events[0];
      if (event) event.on = { type: 'search', target: 'no-such-item' };
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-trigger-target',
        document: 'events.json',
        field: 'on.target',
      }),
    ).toBe(true);
  });

  it('flags a verb trigger naming a verb the module never declares', () => {
    const broken = mutate((m) => {
      const event = m.events[0];
      if (event) event.on = { type: 'verb', target: 'pirouette' };
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-trigger-target',
        document: 'events.json',
        field: 'on.target',
      }),
    ).toBe(true);
  });

  it('accepts a verb trigger naming a declared verb', () => {
    const ok = mutate((m) => {
      m.vocabulary.verbs.push({ id: 'jump', words: ['jump'], patterns: ['V'] });
      const event = m.events[0];
      if (event) event.on = { type: 'verb', target: 'jump' };
    });
    expect(
      checkConsistency(ok, validArtFiles).filter((e) => e.code === 'dangling-trigger-target'),
    ).toEqual([]);
  });
});

describe('checkConsistency — condition references', () => {
  it('flags condition.atLocation naming an unknown location', () => {
    const broken = mutate((m) => {
      const milestone = m.scoring.milestones[0];
      if (milestone?.when[0]) milestone.when[0].atLocation = 'no-such-place';
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-condition-at-location',
        document: 'scoring.json',
        id: 'vault-milestone',
        field: 'when[0].atLocation',
      }),
    ).toBe(true);
  });

  it('flags condition.hasItem naming an unknown item', () => {
    const broken = mutate((m) => {
      const milestone = m.scoring.milestones[0];
      if (milestone?.when[0]) milestone.when[0].hasItem = 'no-such-item';
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-condition-has-item',
        document: 'scoring.json',
        id: 'vault-milestone',
        field: 'when[0].hasItem',
      }),
    ).toBe(true);
  });

  it('flags condition.itemAt.item naming an unknown item', () => {
    const broken = mutate((m) => {
      const milestone = m.scoring.milestones[0];
      if (milestone?.when[0]) milestone.when[0].itemAt = { item: 'no-such-item', location: 'road' };
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-condition-item-at-item',
        document: 'scoring.json',
        id: 'vault-milestone',
        field: 'when[0].itemAt.item',
      }),
    ).toBe(true);
  });

  it('flags condition.itemAt.location naming an unknown location', () => {
    const broken = mutate((m) => {
      const milestone = m.scoring.milestones[0];
      if (milestone?.when[0]) milestone.when[0].itemAt = { item: 'idol', location: 'nowhere-place' };
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-condition-item-at-location',
        document: 'scoring.json',
        id: 'vault-milestone',
        field: 'when[0].itemAt.location',
      }),
    ).toBe(true);
  });

  it('accepts condition.itemAt.location resolving to a container item', () => {
    const clone = mutate((m) => {
      const milestone = m.scoring.milestones[0];
      if (milestone?.when[0]) milestone.when[0].itemAt = { item: 'key', location: 'box' };
    });
    expect(
      checkConsistency(clone, validArtFiles).some((e) => e.field?.includes('itemAt')),
    ).toBe(false);
  });

  it('flags condition.creatureAt.creature naming an unknown creature', () => {
    const broken = mutate((m) => {
      const milestone = m.scoring.milestones[0];
      if (milestone?.when[0])
        milestone.when[0].creatureAt = { creature: 'no-such-creature', location: 'cave' };
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-condition-creature-at-creature',
        document: 'scoring.json',
        id: 'vault-milestone',
        field: 'when[0].creatureAt.creature',
      }),
    ).toBe(true);
  });

  it('flags condition.creatureAt.location naming an unknown location', () => {
    const broken = mutate((m) => {
      const milestone = m.scoring.milestones[0];
      if (milestone?.when[0])
        milestone.when[0].creatureAt = { creature: 'rat', location: 'nowhere-place' };
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-condition-creature-at-location',
        document: 'scoring.json',
        id: 'vault-milestone',
        field: 'when[0].creatureAt.location',
      }),
    ).toBe(true);
  });

  it('flags condition.visited naming an unknown location', () => {
    const broken = mutate((m) => {
      const milestone = m.scoring.milestones[0];
      if (milestone?.when[0]) milestone.when[0].visited = 'nowhere-place';
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'dangling-condition-visited',
        document: 'scoring.json',
        id: 'vault-milestone',
        field: 'when[0].visited',
      }),
    ).toBe(true);
  });
});

// ─── flags: reads must be written ───────────────────────────────────────────

describe('checkConsistency — flag reads vs writes', () => {
  it('flags a condition reading a flag no effect ever sets', () => {
    const broken = mutate((m) => {
      const milestone = m.scoring.milestones[0];
      if (milestone?.when[0]) milestone.when[0].flag = 'never-written-flag';
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'unwritten-flag-read',
        document: 'scoring.json',
        id: 'vault-milestone',
        field: 'when[0].flag',
      }),
    ).toBe(true);
  });

  it('flags a flagSet trigger target no effect ever sets', () => {
    const broken = mutate((m) => {
      m.events.push({
        id: 'watch-for-flag',
        once: false,
        on: { type: 'flagSet', target: 'never-written-flag' },
        do: [{ kind: 'print', text: 'Something shifts.' }],
      });
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'unwritten-flag-read',
        document: 'events.json',
        id: 'watch-for-flag',
        field: 'on.target',
      }),
    ).toBe(true);
  });

  it('does not flag a flag that is both read and written', () => {
    // vault-open is read by the milestone and written by reveal-vault/clear-vault-open.
    expect(
      checkConsistency(validModule, validArtFiles).some((e) => e.code === 'unwritten-flag-read'),
    ).toBe(false);
  });
});

// ─── reachability ────────────────────────────────────────────────────────────

describe('checkConsistency — reachability', () => {
  it('does not flag a location only reachable via a hidden exit', () => {
    // vault is reachable only through cave's hidden `down` exit; the BFS must
    // follow hidden exits, or this would wrongly report an orphan.
    expect(
      checkConsistency(validModule, validArtFiles).some((e) => e.code === 'orphan-location'),
    ).toBe(false);
  });

  it('flags a location with no path from startLocation', () => {
    const broken = mutate((m) => {
      m.locations.push({
        id: 'isolated',
        name: 'Isolated Room',
        brief: 'A room with no way in.',
        full: 'A room with no way in.',
        artId: 'isolated',
        light: 'lit',
        exits: {},
      });
    });
    const errors = checkConsistency(broken, [...validArtFiles, 'isolated.svg']);
    expect(
      hasError(errors, {
        code: 'orphan-location',
        document: 'locations.json',
        id: 'isolated',
        field: 'id',
      }),
    ).toBe(true);
  });
});

// ─── art files ───────────────────────────────────────────────────────────────

describe('checkConsistency — art files', () => {
  it('flags an artId with no matching file', () => {
    const artFilesMissingKey = validArtFiles.filter((f) => f !== 'key.svg');
    const errors = checkConsistency(validModule, artFilesMissingKey);
    expect(
      hasError(errors, {
        code: 'missing-art-file',
        document: 'items.json',
        id: 'key',
        field: 'artId',
      }),
    ).toBe(true);
  });

  it('matches an artId against the format the manifest declares', () => {
    expect(
      checkConsistency(validModule, validArtFiles).some((e) => e.code === 'missing-art-file'),
    ).toBe(false);
  });

  it('flags art shipped in a format the manifest does not declare', () => {
    // THE BUG THIS CLOSES: the check used to accept any extension, so a module
    // shipping .webp while the UI asked for .svg validated green and served
    // broken images. A validator that passes what the app cannot load is worse
    // than none, because it is believed.
    const webpFiles = validArtFiles.map((f) => f.replace(/\.svg$/, '.webp'));
    const errors = checkConsistency(validModule, webpFiles).filter((e) => e.code === 'missing-art-file');
    expect(errors.length).toBeGreaterThan(0);
    // And it says WHY, rather than just "missing" — the file is right there.
    expect(errors[0]?.message).toContain('another format');
  });

  it('accepts that same webp art once the manifest declares webp', () => {
    const webpModule = zAdventureModule.parse({
      ...rawValidModule,
      manifest: { ...rawValidModule.manifest, artFormat: 'webp' },
    });
    const webpFiles = validArtFiles.map((f) => f.replace(/\.svg$/, '.webp'));
    expect(
      checkConsistency(webpModule, webpFiles).some((e) => e.code === 'missing-art-file'),
    ).toBe(false);
  });
});

// ─── maxScore reconciliation ─────────────────────────────────────────────────

describe('checkConsistency — maxScore reconciliation', () => {
  it('flags a maxScore that does not match the sum of attainable points', () => {
    const broken = mutate((m) => {
      m.manifest.maxScore = 61;
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'max-score-mismatch',
        document: 'manifest.json',
        id: 'manifest',
        field: 'maxScore',
      }),
    ).toBe(true);
  });

  it('flags a positive addScore in a repeatable (once: false) event as unbounded', () => {
    const broken = mutate((m) => {
      const event = m.events.find((e) => e.id === 'bonus-idol');
      if (event) event.once = false;
    });
    const errors = checkConsistency(broken, validArtFiles);
    expect(
      hasError(errors, {
        code: 'unbounded-score-effect',
        document: 'events.json',
        id: 'bonus-idol',
        field: 'do[0].points',
      }),
    ).toBe(true);
  });

  it('does not flag a negative addScore in a repeatable event', () => {
    const clone = mutate((m) => {
      m.events.push({
        id: 'repeatable-penalty',
        once: false,
        on: { type: 'enter', target: 'cave' },
        do: [{ kind: 'addScore', points: -1 }],
      });
      // Keep maxScore reconciled: a negative once:false addScore doesn't
      // count toward the sum either way.
    });
    expect(
      checkConsistency(clone, validArtFiles).some((e) => e.code === 'unbounded-score-effect'),
    ).toBe(false);
  });
});

// ─── duplicate ids ───────────────────────────────────────────────────────────

describe('checkConsistency — duplicate ids', () => {
  it('flags two locations sharing an id', () => {
    const broken = mutate((m) => {
      const shed = m.locations.find((l) => l.id === 'shed');
      if (shed) m.locations.push({ ...shed });
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'duplicate-id',
        document: 'locations.json',
        id: 'shed',
        field: 'id',
      }),
    ).toBe(true);
  });

  it('flags two events sharing an id', () => {
    const broken = mutate((m) => {
      const event = m.events.find((e) => e.id === 'trap-die');
      if (event) m.events.push({ ...event });
    });
    expect(
      hasError(checkConsistency(broken, validArtFiles), {
        code: 'duplicate-id',
        document: 'events.json',
        id: 'trap-die',
        field: 'id',
      }),
    ).toBe(true);
  });
});
