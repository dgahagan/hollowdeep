import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAdventure } from '../../src/loader';
import type { AdventureModule } from '../../src/engine/schema';
import type { GameState } from '../../src/engine/types';
import { createGame, setItemLocation } from '../../src/engine/state';
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
 * is registered for it — real test-cave content, not hand-built Command stubs.
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

describe('inventory — consumes no turn (checking your pockets is free)', () => {
  it('says so when carrying nothing', () => {
    const result = act(start, 'inventory');
    expect(texts(result)).toMatch(/empty-handed/i);
    expect(result.consumesTurn).toBe(false);
  });

  it('lists what you are carrying', () => {
    const carrying = setItemLocation(setItemLocation(start, 'brass-lamp', 'inventory'), 'oil-flask', 'inventory');
    const result = act(carrying, 'inventory');
    expect(texts(result)).toMatch(/lamp/i);
    expect(texts(result)).toMatch(/flask/i);
    expect(result.consumesTurn).toBe(false);
  });

  it('lists items by name, never by their in-room `brief`', () => {
    const carrying = setItemLocation(setItemLocation(start, 'brass-lamp', 'inventory'), 'oil-flask', 'inventory');
    const out = texts(act(carrying, 'inventory'));

    // The bug this pins: `brief` is the adventure's line for an item lying in
    // a room ("A brass lamp sits on the shelf, waiting to be useful."), so
    // listing inventory with it tells the player their carried lamp is on a
    // shelf somewhere. Matching /lamp/i alone cannot catch that — the word
    // appears in both the name and the brief — so assert the in-situ prose is
    // absent, which is the part only the wrong field produces.
    expect(out).not.toMatch(/sits on the shelf/i);
    expect(out).not.toMatch(/leans in the corner/i);
    expect(out).toContain('lamp');
    expect(out).toContain('flask');
  });

  it('the shortcut `i` behaves identically', () => {
    const result = act(start, 'i');
    expect(texts(result)).toMatch(/empty-handed/i);
    expect(result.consumesTurn).toBe(false);
  });
});

describe('score — consumes no turn', () => {
  it('reports the current score out of maxScore', () => {
    const result = act({ ...start, score: 45 }, 'score');
    expect(texts(result)).toContain('45');
    expect(texts(result)).toContain(String(module_.manifest.maxScore));
    expect(result.consumesTurn).toBe(false);
  });
});

describe('wait — the one meta verb that spends a turn', () => {
  it('consumes a turn', () => {
    const result = act(start, 'wait');
    expect(result.consumesTurn).toBe(true);
  });

  it('the shortcut `z` behaves identically', () => {
    const result = act(start, 'z');
    expect(result.consumesTurn).toBe(true);
  });
});

describe('verbose / brief — consume no turn', () => {
  it('verbose sets state.verbose true', () => {
    const result = act(start, 'verbose');
    expect(result.state.verbose).toBe(true);
    expect(result.consumesTurn).toBe(false);
  });

  it('brief sets state.verbose false', () => {
    const result = act({ ...start, verbose: true }, 'brief');
    expect(result.state.verbose).toBe(false);
    expect(result.consumesTurn).toBe(false);
  });
});

describe('help — consumes no turn, never lists magic words (FR-1.9)', () => {
  it('gives a short how-to-play with core verbs and shortcuts', () => {
    const result = act(start, 'help');
    expect(result.consumesTurn).toBe(false);
    expect(texts(result)).toMatch(/look/i);
    expect(texts(result)).toMatch(/take/i);
  });

  it('never mentions a magic word', () => {
    const result = act(start, 'help');
    const helpText = texts(result).toLowerCase();
    for (const magic of module_.vocabulary.magicWords) {
      expect(helpText).not.toContain(magic.word.toLowerCase());
    }
  });
});
