import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAdventure } from '../../src/loader';
import type { AdventureModule } from '../../src/engine/schema';
import type { GameState } from '../../src/engine/types';
import { createGame, isFlagSet, setItemLocation, setItemState } from '../../src/engine/state';
import { isExitRevealed } from '../../src/engine/systems/events';
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

/** Same, but genuinely no light — the lamp stays on the shed shelf, unlit. */
function darkAt(locationId: string, extra: Partial<GameState> = {}): GameState {
  return { ...start, locationId, ...extra };
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
 * Parse `input` for real against `module_`/`state` and run whatever handler
 * is registered for it — real test-cave content, not hand-built Command/Target
 * stubs.
 */
function act(state: GameState, input: string): ActionResult {
  const result = parse(module_, state, input);
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
  return handler(module_, state, result);
}

function texts(result: ActionResult): string {
  return result.events.map((e) => e.text).join(' | ');
}

describe('look', () => {
  it('always shows the FULL description, even after the location has been visited', () => {
    const location = module_.locations.find((l) => l.id === 'road');
    if (location === undefined) throw new Error('missing road');
    const result = act(at('road'), 'look'); // road is visited from game start
    expect(result.events.some((e) => e.text === location.full)).toBe(true);
    expect(result.consumesTurn).toBe(true);
  });

  it('lists visible items', () => {
    const result = act(at('shed'), 'look');
    expect(texts(result)).toMatch(/lamp|flask|cup/i);
  });

  it('lists visible creatures', () => {
    const result = act(at('entry-hall'), 'look'); // the pale newt lives here, always active
    expect(texts(result)).toMatch(/newt/i);
  });

  it('in the dark without light, shows only the darkness warning — no room contents leak', () => {
    const warning = module_.strings[module_.manifest.darkness.warningMessageId];
    const result = act(darkAt('low-passage'), 'look');
    expect(result.events).toEqual([{ kind: 'text', text: warning }]);
    expect(result.consumesTurn).toBe(true);
  });

  it('shows normally in the dark once carrying a lit lamp', () => {
    const location = module_.locations.find((l) => l.id === 'low-passage');
    if (location === undefined) throw new Error('missing low-passage');
    const result = act(at('low-passage'), 'look');
    expect(result.events.some((e) => e.text === location.full)).toBe(true);
  });
});

describe('examine', () => {
  it('prints an item\'s description and sets itRefers (FR-2.5)', () => {
    const result = act(at('shed'), 'examine lamp');
    expect(texts(result)).toMatch(/carbide/i);
    expect(result.state.itRefers).toBe('brass-lamp');
    expect(result.consumesTurn).toBe(true);
  });

  it('prints a creature\'s description without touching itRefers', () => {
    const before = at('entry-hall');
    const result = act(before, 'examine newt');
    expect(texts(result)).toMatch(/newt|blind/i);
    expect(result.state.itRefers).toBe(before.itRefers);
  });

  it('prints scenery\'s description without touching itRefers', () => {
    const before = at('road');
    const result = act(before, 'examine hill');
    expect(texts(result)).toMatch(/gravel|weeds/i);
    expect(result.state.itRefers).toBe(before.itRefers);
  });
});

describe('read', () => {
  it('prints readText for an item and fires the `read` trigger', () => {
    // wall-carving (an Item) in the grotto teaches `zeeble`.
    const before = at('grotto');
    expect(isFlagSet(before, 'zeeble-known')).toBe(false);
    const result = act(before, 'read carving');
    expect(texts(result)).toMatch(/zeeble/i);
    expect(isFlagSet(result.state, 'zeeble-known')).toBe(true);
    expect(result.consumesTurn).toBe(true);
  });

  it('the read trigger fires once — rereading does not repeat the "you learn it" text', () => {
    const learned = act(at('grotto'), 'read carving').state;
    const again = act(learned, 'read carving');
    expect(texts(again)).toMatch(/zeeble/i); // readText itself still prints
    expect(texts(again)).not.toMatch(/pebble in your mouth/i);
  });

  it('prints readText for scenery, with no trigger to fire (scenery has no id)', () => {
    // entry-hall's carving is Scenery, distinct from the grotto's wall-carving Item.
    const result = act(at('entry-hall'), 'read carving');
    expect(texts(result)).toMatch(/kept below/i);
  });

  it('refuses when the target has no readText', () => {
    const result = act(at('shed'), 'read lamp');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/nothing written/i);
  });
});

describe('search', () => {
  it('search tree reveals the iron key (once)', () => {
    const before = at('hollow-tree');
    const result = act(before, 'search tree');
    expect(texts(result)).toMatch(/iron key/i);
    expect(result.state.itemLocations['iron-key']).toBe('hollow-tree');
    expect(result.consumesTurn).toBe(true);
  });

  it('searching the tree again says it is empty, not the reveal text a second time', () => {
    const found = act(at('hollow-tree'), 'search tree').state;
    const again = act(found, 'search tree');
    expect(texts(again)).toMatch(/empty/i);
    expect(texts(again)).not.toMatch(/close your hand/i);
  });

  it('search door in the grotto reveals the hidden hatch exit', () => {
    const before = at('grotto');
    expect(isExitRevealed(before, 'grotto', 'down')).toBe(false);
    const result = act(before, 'search door');
    expect(texts(result)).toMatch(/hatch/i);
    expect(isExitRevealed(result.state, 'grotto', 'down')).toBe(true);
    expect(result.consumesTurn).toBe(true);
  });

  it('searching something with no search event finds nothing, but still takes a turn', () => {
    const result = act(at('deep-vault'), 'search box');
    expect(texts(result)).toMatch(/nothing of interest/i);
    expect(result.consumesTurn).toBe(true);
  });
});

describe('open-container contents — look / examine / search reveal what is inside (the jade-idol discoverability fix)', () => {
  const IDOL_BRIEF = /jade idol squats in the box/i;

  /** deep-vault with the box unlocked and standing open; the idol starts inside it. */
  function boxOpen(): GameState {
    return setItemState(at('deep-vault'), 'wooden-box', { locked: false, open: true });
  }

  it('look lists the contents of an open container after its own brief', () => {
    const result = act(boxOpen(), 'look');
    expect(texts(result)).toMatch(IDOL_BRIEF);
  });

  it('look does NOT list the contents while the container is closed', () => {
    const result = act(at('deep-vault'), 'look');
    expect(texts(result)).not.toMatch(IDOL_BRIEF);
  });

  it('examine on an open container appends its contents', () => {
    const result = act(boxOpen(), 'examine box');
    expect(texts(result)).toMatch(IDOL_BRIEF);
  });

  it('examine on the closed container stays a static description', () => {
    const result = act(at('deep-vault'), 'examine box');
    expect(texts(result)).not.toMatch(IDOL_BRIEF);
  });

  it('search on an open container with no search event lists contents instead of "nothing of interest"', () => {
    const result = act(boxOpen(), 'search box');
    expect(texts(result)).toMatch(IDOL_BRIEF);
    expect(texts(result)).not.toMatch(/nothing of interest/i);
    expect(result.consumesTurn).toBe(true);
  });

  it('search on an open but EMPTY container still finds nothing of interest', () => {
    const emptied = setItemLocation(boxOpen(), 'jade-idol', 'deep-vault');
    const result = act(emptied, 'search box');
    expect(texts(result)).toMatch(/nothing of interest/i);
  });
});

describe('examine emits an inspect event — the item/creature art finally shows (FR-4.1)', () => {
  it('examining a visible item carries its artId', () => {
    const result = act(at('shed'), 'examine flask');
    const inspect = result.events.find((e) => e.kind === 'inspect');
    expect(inspect).toBeDefined();
    if (inspect?.kind === 'inspect') {
      expect(inspect.artId).toBe('oil-flask');
      expect(inspect.text).toBe('flask');
    }
  });

  it('examining a creature carries its artId too', () => {
    const state: GameState = {
      ...at('grotto'),
      creatures: {
        ...at('grotto').creatures,
        'pale-newt': { active: true, locationId: 'grotto', encounterTurns: 0, activatedTurn: 0, hasStolen: false },
      },
    };
    const result = act(state, 'examine newt');
    expect(result.events.some((e) => e.kind === 'inspect' && e.artId === 'pale-newt')).toBe(true);
  });

  it('examining in the dark stays text-only — no art of what cannot be seen', () => {
    // Carry the lamp UNLIT into the dark vault; examining it by touch works,
    // but the painting must not leak.
    let state = darkAt('deep-vault');
    state = setItemLocation(state, 'brass-lamp', 'inventory');
    const result = act(state, 'examine lamp');
    expect(result.events.some((e) => e.kind === 'inspect')).toBe(false);
  });
});
