import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAdventure } from '../../src/loader';
import type { AdventureModule, Item } from '../../src/engine/schema';
import type { GameState } from '../../src/engine/types';
import { createGame, getItemState, isCarrying, itemLocation, setItemLocation, setItemState } from '../../src/engine/state';
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

/** Put the player somewhere with a lit lamp, so light is never the reason a test fails. */
function at(locationId: string, extra: Partial<GameState> = {}): GameState {
  let state: GameState = { ...start, locationId, ...extra };
  state = setItemLocation(state, 'brass-lamp', 'inventory');
  state = setItemState(state, 'brass-lamp', { lit: true });
  return state;
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

/**
 * Parse `input` for real against an explicit module/state and run whatever
 * handler is registered for it — real content, not hand-built Command/Target
 * stubs (same helper the T15 test files use). `act` below is the common case
 * (against `module_`, test-cave itself); `actWith` is for the put-cycle
 * regression tests, which need a module tweaked to have a portable
 * container — test-cave's own containers (grate, wooden-box) are both fixed
 * in place, so they cannot exercise this bug at all.
 */
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

/**
 * test-cave's own containers (grate, wooden-box) are both non-portable —
 * `container.open`/`.locked` is enough to test locking and capacity, but a
 * put-in-yourself cycle needs a container you can actually carry, which
 * test-cave has none of. This is a legal module by the schema (nothing forbids
 * a portable container) — engine code cannot tell it apart from any other
 * module, which is exactly why the bug this guards against is real and not
 * specific to test-cave.
 */
function withPortableBox(): AdventureModule {
  const box = module_.items.find((i) => i.id === 'wooden-box');
  if (box === undefined) throw new Error('fixture missing wooden-box');
  const portableBox: Item = { ...box, portable: true, container: { open: true, locked: false, capacity: 2 } };
  return { ...module_, items: module_.items.map((i) => (i.id === 'wooden-box' ? portableBox : i)) };
}

/** `withPortableBox` plus a second portable container, for the transitive-nesting case. */
function withTwoPortableContainers(): AdventureModule {
  const module = withPortableBox();
  const sack: Item = {
    id: 'leather-sack',
    names: ['sack'],
    brief: 'A leather sack lies here.',
    description: 'A supple leather sack, roomy enough for anything you might carry.',
    artId: 'leather-sack',
    portable: true,
    initialLocation: 'deep-vault',
    lightSource: false,
    container: { open: true, locked: false, capacity: 5 },
  };
  return { ...module, items: [...module.items, sack] };
}

/**
 * A lit-lamp starting state for a tweaked module, built from that module's
 * OWN `createGame` — not `start`/`at`, which are baked to `module_`'s own
 * `itemLocations` and would have no entry at all for `leather-sack`.
 */
function atInModule(module: AdventureModule, locationId: string): GameState {
  let state = createGame(module, 42);
  state = { ...state, locationId };
  state = setItemLocation(state, 'brass-lamp', 'inventory');
  state = setItemState(state, 'brass-lamp', { lit: true });
  return state;
}

describe('take', () => {
  it('takes a portable item into inventory and consumes a turn', () => {
    const result = act(at('shed'), 'take flask');
    expect(result.consumesTurn).toBe(true);
    expect(texts(result)).toMatch(/taken/i);
    expect(itemLocation(result.state, 'oil-flask')).toBe('inventory');
  });

  it('a non-portable item nudges rather than errors — refused, not a parse error', () => {
    const result = act(at('hollow-tree'), 'take tree');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).not.toMatch(/^$/);
  });

  it('refuses to take something already carried', () => {
    const carrying = at('shed');
    const result = act(carrying, 'take lamp'); // `at` already carries the lamp
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/already have/i);
  });

  it('refuses at the carry limit (FR-1.2), naming the constraint plainly', () => {
    // carryLimit is 5. `at()` already carries the lamp; fill four more slots
    // by direct state manipulation, then a sixth item at the location should
    // be refused rather than taken.
    let state = at('shed');
    state = setItemLocation(state, 'oil-flask', 'inventory');
    state = setItemLocation(state, 'tin-cup', 'inventory');
    state = setItemLocation(state, 'iron-key', 'inventory');
    state = setItemLocation(state, 'silver-chalice', 'inventory');
    state = setItemLocation(state, 'jade-idol', 'shed'); // the sixth item, in scope but not yet carried

    const result = act(state, 'take idol');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/hands are full/i);
    expect(itemLocation(result.state, 'jade-idol')).toBe('shed'); // untouched
  });

  it('fires the `take` trigger — packrat-arms sets a flag once both treasures are carried', () => {
    let state = at('grotto');
    state = setItemLocation(state, 'jade-idol', 'inventory'); // already holding one treasure
    const result = act(state, 'take chalice'); // now holds both
    expect(result.state.flags['packrat-armed']).toBe(true);
  });
});

describe('drop', () => {
  it('drops a carried item at the current location and consumes a turn', () => {
    const result = act(at('road'), 'drop lamp');
    expect(result.consumesTurn).toBe(true);
    expect(texts(result)).toMatch(/dropped/i);
    expect(itemLocation(result.state, 'brass-lamp')).toBe('road');
    expect(isCarrying(result.state, 'brass-lamp')).toBe(false);
  });

  it('refuses to drop something not carried, even if it is visible at the location', () => {
    const result = act(at('shed'), 'drop flask'); // flask sits in the shed, uncarried
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/aren't carrying/i);
  });
});

describe('open / close — the steel grate (a lockable "door" with capacity 0)', () => {
  it('refuses to open a locked container', () => {
    const result = act(at('cave-mouth'), 'open grate');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/locked/i);
  });

  it('opens once unlocked, firing the `open` trigger and its flagSet cascade', () => {
    let state = at('cave-mouth');
    state = setItemLocation(state, 'iron-key', 'inventory');
    const unlocked = act(state, 'unlock grate with key');
    expect(unlocked.consumesTurn).toBe(true);
    expect(getItemState(unlocked.state, 'grate').locked).toBe(false);

    const opened = act(unlocked.state, 'open grate');
    expect(opened.consumesTurn).toBe(true);
    // grate-opened prints directly; grate-note fires via the flagSet cascade
    // (systems/events.ts) triggered by grate-opened's own setFlag effect.
    expect(texts(opened)).toMatch(/shriek/i);
    expect(texts(opened)).toMatch(/dark waits/i);
    expect(getItemState(opened.state, 'grate').open).toBe(true);
  });

  it('refuses to close an already-closed container', () => {
    const result = act(at('cave-mouth'), 'close grate');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/already closed/i);
  });

  it('closes an open container', () => {
    let state = at('cave-mouth');
    state = setItemState(state, 'grate', { open: true, locked: false });
    const result = act(state, 'close grate');
    expect(result.consumesTurn).toBe(true);
    expect(getItemState(result.state, 'grate').open).toBe(false);
  });

  it('refuses to open something that is not a container at all', () => {
    const result = act(at('shed'), 'open lamp');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/can't open/i);
  });
});

describe('lock / unlock — the wooden box needs the iron key specifically', () => {
  it('refuses to unlock without carrying the key at all', () => {
    // Put the key in plain view at deep-vault, but do not carry it — proves
    // the refusal is "not carried", not "key does not exist".
    let state = at('deep-vault');
    state = setItemLocation(state, 'iron-key', 'deep-vault');
    const result = act(state, 'unlock box with key');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/aren't carrying/i);
    expect(getItemState(result.state, 'wooden-box').locked).toBe(true);
  });

  it('refuses with the wrong item — the lamp does not fit the box', () => {
    const result = act(at('deep-vault'), 'unlock box with lamp'); // `at` carries the lamp
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/doesn't fit/i);
    expect(getItemState(result.state, 'wooden-box').locked).toBe(true);
  });

  it('unlocks with the iron key, but does not also open it', () => {
    let state = at('deep-vault');
    state = setItemLocation(state, 'iron-key', 'inventory');
    const result = act(state, 'unlock box with key');
    expect(result.consumesTurn).toBe(true);
    expect(getItemState(result.state, 'wooden-box').locked).toBe(false);
    expect(getItemState(result.state, 'wooden-box').open).toBe(false);
  });

  it('lets the jade idol be taken only after unlock + open — nested container contents', () => {
    let state = at('deep-vault');
    state = setItemLocation(state, 'iron-key', 'inventory');

    // Before opening: the idol is nested inside a closed container, so it is
    // not even in the parser's scope yet — a real "container nesting" check,
    // not a hand-built one, since jade-idol's initialLocation IS wooden-box.
    expect(parse(module_, state, 'take idol').kind).toBe('error');

    const unlocked = act(state, 'unlock box with key').state;
    const opened = act(unlocked, 'open box').state;
    expect(itemLocation(opened, 'jade-idol')).toBe('wooden-box');

    const taken = act(opened, 'take idol');
    expect(taken.consumesTurn).toBe(true);
    expect(itemLocation(taken.state, 'jade-idol')).toBe('inventory');
  });

  it('refuses to lock an already-locked container', () => {
    let state = at('deep-vault');
    state = setItemLocation(state, 'iron-key', 'inventory');
    const result = act(state, 'lock box with key');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/already locked/i);
  });

  it('refuses to lock a container that is currently open', () => {
    let state = at('deep-vault');
    state = setItemLocation(state, 'iron-key', 'inventory');
    state = setItemState(state, 'wooden-box', { open: true, locked: false });
    const result = act(state, 'lock box with key');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/close the box first/i);
  });

  it('locks a closed, unlocked container with the right key', () => {
    let state = at('deep-vault');
    state = setItemLocation(state, 'iron-key', 'inventory');
    state = setItemState(state, 'wooden-box', { open: false, locked: false });
    const result = act(state, 'lock box with key');
    expect(result.consumesTurn).toBe(true);
    expect(getItemState(result.state, 'wooden-box').locked).toBe(true);
  });
});

describe('put — capacity refusal (the wooden box holds 2, and the idol already fills one slot)', () => {
  function openBox(state: GameState): GameState {
    let s = setItemLocation(state, 'iron-key', 'inventory');
    s = act(s, 'unlock box with key').state;
    s = act(s, 'open box').state;
    return s;
  }

  it('accepts an item while there is room', () => {
    let state = openBox(at('deep-vault'));
    state = setItemLocation(state, 'oil-flask', 'inventory');
    const result = act(state, 'put flask in box');
    expect(result.consumesTurn).toBe(true);
    expect(itemLocation(result.state, 'oil-flask')).toBe('wooden-box');
  });

  it('refuses once the container is at capacity', () => {
    let state = openBox(at('deep-vault'));
    state = setItemLocation(state, 'oil-flask', 'inventory');
    state = act(state, 'put flask in box').state; // box now holds idol + flask = 2/2
    state = setItemLocation(state, 'tin-cup', 'inventory');

    const result = act(state, 'put cup in box');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/no more room/i);
    expect(itemLocation(result.state, 'tin-cup')).toBe('inventory'); // untouched
  });

  it('refuses to put something into a closed container', () => {
    // `at()` carries the lamp, which is always in scope regardless of the
    // box's state — the box item itself is visible even locked and closed;
    // only its CONTENTS are hidden until it opens (parse.ts's `addContents`).
    const result = act(at('deep-vault'), 'put lamp in box');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/closed/i);
  });

  it('refuses to put something you are not carrying', () => {
    let state = openBox(at('deep-vault'));
    state = setItemLocation(state, 'tin-cup', 'deep-vault'); // visible at the location, not carried
    const result = act(state, 'put cup in box');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/aren't carrying/i);
  });
});

describe('use — a trigger fire and nothing else (SCOPE ADDITION to T16)', () => {
  it('oiling the rusted door fires oil-the-door and sets the flag', () => {
    let state = at('grotto');
    state = setItemLocation(state, 'oil-flask', 'inventory');
    const result = act(state, 'oil door with flask');
    expect(result.consumesTurn).toBe(true);
    expect(texts(result)).toMatch(/rust gives up its grudge/i);
    expect(result.state.flags['door-oiled']).toBe(true);
  });

  it('oiling it again hits the already-oiled event, not the first-time text', () => {
    let state = at('grotto');
    state = setItemLocation(state, 'oil-flask', 'inventory');
    const first = act(state, 'oil door with flask').state;
    const second = act(first, 'oil door with flask');
    expect(second.consumesTurn).toBe(true);
    expect(texts(second)).toMatch(/already slick/i);
    expect(texts(second)).not.toMatch(/grudge/i);
  });

  it('using something with no matching `use` event nudges and consumes no turn', () => {
    const result = act(at('shed'), 'use lamp');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/nothing happens/i);
  });

  it('using a creature target has no item id to trigger against — nudges, no turn', () => {
    const result = act(at('entry-hall'), 'use newt');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/nothing happens/i);
  });
});

describe('put — refuses to nest a container inside itself (regression: portable containers)', () => {
  // test-cave's own containers (grate, wooden-box) are both `portable: false`,
  // so this bug cannot be reproduced against real test-cave data at all — it
  // needs a container you can actually carry, which is exactly why the fix
  // and its tests use `withPortableBox`/`withTwoPortableContainers` above.
  // Every assertion below checks STATE, not just the refusal text: a handler
  // that refuses and then moves the item anyway would still pass a
  // message-only test.

  it('refuses `put box in box`, leaving the box carried and its contents intact', () => {
    const testModule = withPortableBox();
    let state = atInModule(testModule, 'deep-vault');
    state = setItemLocation(state, 'wooden-box', 'inventory');

    const before = state;
    const result = actWith(testModule, state, 'put box in box');

    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/quite a trick/i);
    expect(result.state).toEqual(before);
    expect(itemLocation(result.state, 'wooden-box')).toBe('inventory');
    expect(itemLocation(result.state, 'jade-idol')).toBe('wooden-box');
  });

  it('refuses `put box in sack` when the sack is already inside the box — no orphaned two-cycle', () => {
    const testModule = withTwoPortableContainers();
    let state = atInModule(testModule, 'deep-vault');
    state = setItemLocation(state, 'wooden-box', 'inventory');
    state = setItemLocation(state, 'leather-sack', 'wooden-box'); // already nested inside the carried box

    const before = state;
    const result = actWith(testModule, state, 'put box in sack');

    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/chase its own tail/i);
    expect(result.state).toEqual(before);
    expect(itemLocation(result.state, 'wooden-box')).toBe('inventory');
    expect(itemLocation(result.state, 'leather-sack')).toBe('wooden-box');
    expect(itemLocation(result.state, 'jade-idol')).toBe('wooden-box');
  });

  it('still allows an ordinary put once the cycle candidates are out of the way', () => {
    // Guards against a check so eager it refuses legitimate puts: the box and
    // sack are both real containers in scope, just not nested in each other,
    // and the idol being moved is neither of them.
    const testModule = withTwoPortableContainers();
    let state = atInModule(testModule, 'deep-vault');
    state = setItemLocation(state, 'wooden-box', 'inventory');
    state = setItemLocation(state, 'leather-sack', 'inventory'); // carried, not nested in the box
    state = setItemLocation(state, 'jade-idol', 'inventory'); // carried, so it's legal to put

    const result = actWith(testModule, state, 'put idol in sack');
    expect(result.consumesTurn).toBe(true);
    expect(itemLocation(result.state, 'jade-idol')).toBe('leather-sack');
  });
});
