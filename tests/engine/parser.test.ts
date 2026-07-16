import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAdventure } from '../../src/loader';
import type { AdventureModule } from '../../src/engine/schema';
import type { GameState } from '../../src/engine/types';
import { createGame, setItemLocation, setItemState } from '../../src/engine/state';
import { tokenize, dropNoise } from '../../src/engine/parser/tokenize';
import { buildVocabulary, CORE_VERBS } from '../../src/engine/parser/vocab';
import { commandSyntaxError, parse, type ParseResult } from '../../src/engine/parser/parse';

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

/** Put the player somewhere with a lit lamp, so scope is not dark-limited. */
function at(locationId: string, extra: Partial<GameState> = {}): GameState {
  let state = { ...start, locationId, ...extra };
  state = setItemLocation(state, 'brass-lamp', 'inventory');
  state = setItemState(state, 'brass-lamp', { lit: true });
  return state;
}

describe('tokenize', () => {
  it('lowercases and splits', () => {
    expect(tokenize('Take The Lamp')).toEqual(['take', 'the', 'lamp']);
  });

  it('treats punctuation as a separator', () => {
    expect(tokenize('take lamp.')).toEqual(['take', 'lamp']);
    expect(tokenize('take lamp, please!')).toEqual(['take', 'lamp', 'please']);
  });

  it('collapses whitespace', () => {
    expect(tokenize('  take    lamp  ')).toEqual(['take', 'lamp']);
  });

  it('returns nothing for empty input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('dropNoise', () => {
  it('drops noise words', () => {
    expect(dropNoise(['take', 'the', 'lamp'], new Set(['the']))).toEqual(['take', 'lamp']);
  });

  it('keeps the original if everything was noise', () => {
    // Better to nudge about "the" than to complain about an empty command.
    expect(dropNoise(['the'], new Set(['the']))).toEqual(['the']);
  });
});

describe('vocabulary', () => {
  it('ships core verbs in-engine', () => {
    const vocab = buildVocabulary(module_);
    for (const verb of CORE_VERBS) {
      expect(vocab.verbWords.get(verb.words[0] ?? '')).toBe(verb.id);
    }
  });

  it('lets a module ADD synonyms to a core verb without losing the core word', () => {
    // test-cave extends `use` with `oil`. Both must work.
    const vocab = buildVocabulary(module_);
    expect(vocab.verbWords.get('oil')).toBe('use');
    expect(vocab.verbWords.get('use')).toBe('use');
  });

  it('cannot remove a core verb', () => {
    // Structural: the merge starts from CORE_VERBS and only unions into it, so
    // there is no expressible way for content to take `take` away.
    const stripped: AdventureModule = {
      ...module_,
      vocabulary: { verbs: [], noiseWords: [], magicWords: [] },
    };
    expect(buildVocabulary(stripped).verbWords.get('take')).toBe('take');
  });

  it('merges module noise words with the core set', () => {
    const vocab = buildVocabulary(module_);
    expect(vocab.noiseWords.has('the')).toBe(true);
    expect(vocab.noiseWords.has('please')).toBe(true);
  });
});

describe('parse — directions (FR-2.3)', () => {
  it.each([
    ['n', 'n'],
    ['north', 'n'],
    ['se', 'se'],
    ['southeast', 'se'],
    ['u', 'up'],
    ['up', 'up'],
    ['d', 'down'],
    ['in', 'in'],
    ['out', 'out'],
  ])('a bare %s is go %s', (input, direction) => {
    expect(parse(module_, start, input)).toEqual({ kind: 'go', direction });
  });

  it('go north is the same command as north', () => {
    expect(parse(module_, start, 'go north')).toEqual(parse(module_, start, 'north'));
  });

  it('rejects go somewhere that is not a direction', () => {
    const result = parse(module_, start, 'go sideways');
    expect(result.kind).toBe('error');
  });
});

describe('parse — grammar', () => {
  it('V', () => {
    expect(parse(module_, start, 'look')).toEqual({ kind: 'verb', verb: 'look' });
    expect(parse(module_, start, 'inventory')).toEqual({ kind: 'verb', verb: 'inventory' });
  });

  it('V N', () => {
    const state = at('shed');
    expect(parse(module_, state, 'take flask')).toMatchObject({
      kind: 'verb-noun',
      verb: 'take',
      target: { kind: 'item', id: 'oil-flask' },
    });
  });

  it('V N prep N', () => {
    let state = at('cave-mouth');
    state = setItemLocation(state, 'iron-key', 'inventory');
    expect(parse(module_, state, 'unlock grate with key')).toMatchObject({
      kind: 'verb-noun-prep-noun',
      verb: 'unlock',
      target: { kind: 'item', id: 'grate' },
      prep: 'with',
      secondTarget: { kind: 'item', id: 'iron-key' },
    });
  });

  it('parses the module-extended verb in VNPN', () => {
    // test-cave's `oil door with flask` — `oil` is a module synonym for `use`.
    let state = at('grotto');
    state = setItemLocation(state, 'oil-flask', 'inventory');
    expect(parse(module_, state, 'oil door with flask')).toMatchObject({
      kind: 'verb-noun-prep-noun',
      verb: 'use',
      target: { kind: 'item', id: 'rusted-door' },
      secondTarget: { kind: 'item', id: 'oil-flask' },
    });
  });

  it('drops a preposition sitting straight after the verb', () => {
    // `look at carving` is a VN command wearing a preposition.
    const state = at('entry-hall');
    expect(parse(module_, state, 'look at carving')).toMatchObject({
      kind: 'verb-noun',
      verb: 'look',
      target: { kind: 'scenery' },
    });
  });

  it('still parses a real VNPN whose preposition is `at`', () => {
    // ...which is why `at` is not a noise word.
    let state = at('grotto');
    state = setItemLocation(state, 'iron-key', 'inventory');
    state = { ...state, creatures: { ...state.creatures, 'cave-rat': { locationId: 'grotto', active: true, encounterTurns: 0, activatedTurn: 1, hasStolen: false } } };
    expect(parse(module_, state, 'throw key at rat')).toMatchObject({
      kind: 'verb-noun-prep-noun',
      verb: 'throw',
      secondTarget: { kind: 'creature', id: 'cave-rat' },
    });
  });

  it('drops noise words', () => {
    const state = at('shed');
    expect(parse(module_, state, 'take the lamp please')).toMatchObject({
      kind: 'verb-noun',
      target: { kind: 'item', id: 'brass-lamp' },
    });
  });

  it('reports a verb used in a shape it does not have', () => {
    const state = at('shed');
    const result = parse(module_, state, 'score the lamp');
    expect(result.kind).toBe('error');
  });
});

describe('parse — synonyms (FR-2.2)', () => {
  it.each([
    ['take lamp', 'take'],
    ['get lamp', 'take'],
    ['grab lamp', 'take'],
  ])('%s resolves to the %s verb', (input, verb) => {
    expect(parse(module_, at('shed'), input)).toMatchObject({ kind: 'verb-noun', verb });
  });

  it('matches an item by any of its names', () => {
    const state = at('shed');
    // The resolved target is what matters; `noun` deliberately keeps whichever
    // word the player actually used, so the echo reads back naturally.
    expect(parse(module_, state, 'take lamp')).toMatchObject({
      target: { kind: 'item', id: 'brass-lamp' },
      noun: 'lamp',
    });
    expect(parse(module_, state, 'take lantern')).toMatchObject({
      target: { kind: 'item', id: 'brass-lamp' },
      noun: 'lantern',
    });
  });
});

describe('parse — scope resolution', () => {
  it('resolves an item at the current location', () => {
    expect(parse(module_, at('shed'), 'examine cup')).toMatchObject({
      target: { kind: 'item', id: 'tin-cup' },
    });
  });

  it('does not resolve an item in another room', () => {
    const result = parse(module_, at('road'), 'take chalice');
    expect(result).toMatchObject({ kind: 'error' });
    if (result.kind === 'error') expect(result.message).toContain('see no');
  });

  it('resolves a carried item from anywhere', () => {
    const state = setItemLocation(at('ledge'), 'iron-key', 'inventory');
    expect(parse(module_, state, 'examine key')).toMatchObject({
      target: { kind: 'item', id: 'iron-key' },
    });
  });

  it('resolves a creature', () => {
    const state = at('entry-hall');
    expect(parse(module_, state, 'examine newt')).toMatchObject({
      target: { kind: 'creature', id: 'pale-newt' },
    });
  });

  it('does not resolve an inactive creature', () => {
    const state = at('twisty-1');
    expect(parse(module_, state, 'examine rat').kind).toBe('error');
  });

  it('resolves scenery', () => {
    expect(parse(module_, at('road'), 'examine road')).toMatchObject({
      target: { kind: 'scenery', locationId: 'road', index: 0 },
    });
  });

  it('matches a multi-word name', () => {
    expect(parse(module_, at('shed'), 'examine trophy shelf')).toMatchObject({
      target: { kind: 'scenery' },
    });
  });

  describe('containers', () => {
    it('hides the contents of a CLOSED container', () => {
      // The idol in the shut box is the puzzle — leaking it into scope would
      // let `take idol` reach through a locked lid.
      const state = at('deep-vault');
      expect(parse(module_, state, 'take idol').kind).toBe('error');
    });

    it('exposes the contents of an OPEN container', () => {
      const state = setItemState(at('deep-vault'), 'wooden-box', { open: true, locked: false });
      expect(parse(module_, state, 'take idol')).toMatchObject({
        target: { kind: 'item', id: 'jade-idol' },
      });
    });
  });

  describe('darkness', () => {
    it('puts nothing but inventory in scope in the dark', () => {
      const dark = { ...start, locationId: 'deep-vault' };
      const result = parse(module_, dark, 'examine box');
      expect(result).toMatchObject({ kind: 'error' });
      if (result.kind === 'error') expect(result.message).toContain('too dark');
    });

    it('keeps your own pockets reachable in the dark', () => {
      // `light lamp` is the one command that MUST work in a dark room.
      let dark = { ...start, locationId: 'low-passage' };
      dark = setItemLocation(dark, 'brass-lamp', 'inventory');
      expect(parse(module_, dark, 'light lamp')).toMatchObject({
        kind: 'verb-noun',
        verb: 'light',
        target: { kind: 'item', id: 'brass-lamp' },
      });
    });
  });
});

describe('parse — adjectives and ambiguity (FR-2.4)', () => {
  /** Carry the chalice into the shed, where the tin cup lives. Both are "cup". */
  function bothCups(): GameState {
    return setItemLocation(at('shed'), 'silver-chalice', 'inventory');
  }

  it('asks which one when a noun matches two things', () => {
    const result = parse(module_, bothCups(), 'take cup');
    expect(result.kind).toBe('disambiguation');
    if (result.kind === 'disambiguation') {
      expect(result.options).toHaveLength(2);
      expect(result.question).toContain('Which cup');
      expect(result.originalCommand).toBe('take cup');
    }
  });

  it('an adjective narrows it to one', () => {
    expect(parse(module_, bothCups(), 'take tin cup')).toMatchObject({
      kind: 'verb-noun',
      target: { kind: 'item', id: 'tin-cup' },
    });
    expect(parse(module_, bothCups(), 'take silver cup')).toMatchObject({
      kind: 'verb-noun',
      target: { kind: 'item', id: 'silver-chalice' },
    });
  });

  it('an unshared name is never ambiguous', () => {
    expect(parse(module_, bothCups(), 'take chalice')).toMatchObject({
      target: { kind: 'item', id: 'silver-chalice' },
    });
  });

  it('rejects an adjective that belongs to the other thing', () => {
    // "tin chalice" must not resolve: `tin` is not the chalice's adjective.
    expect(parse(module_, bothCups(), 'take tin chalice').kind).toBe('error');
  });

  it('offers distinguishing labels, not bare ids', () => {
    const result = parse(module_, bothCups(), 'take cup');
    if (result.kind === 'disambiguation') {
      expect(result.options).toEqual(expect.arrayContaining(['tin cup', 'silver chalice']));
    }
  });
});

describe('parse — pronouns (FR-2.5)', () => {
  it('resolves `it` via itRefers', () => {
    const state = { ...at('shed'), itRefers: 'brass-lamp' };
    expect(parse(module_, state, 'take it')).toMatchObject({
      kind: 'verb-noun',
      target: { kind: 'item', id: 'brass-lamp' },
    });
  });

  it('fails helpfully when `it` refers to nothing', () => {
    expect(parse(module_, at('shed'), 'take it').kind).toBe('error');
  });

  it('fails when the referent has left scope', () => {
    // A pronoun pointing at something two rooms away is worse than admitting
    // we don't know what it means.
    const state = { ...at('road'), itRefers: 'silver-chalice' };
    expect(parse(module_, state, 'take it').kind).toBe('error');
  });
});

describe('parse — magic words (FR-1.9)', () => {
  it('matches a magic word BEFORE the unknown-word nudge', () => {
    expect(parse(module_, start, 'zeeble')).toEqual({
      kind: 'magic-word',
      word: 'zeeble',
      eventId: 'zeeble-descend',
    });
  });

  it('matches even before the player has learned it — the parser is not the gate', () => {
    // Whether saying it DOES anything is the event's guard to decide (FR-1.9);
    // rejecting the word here would leak that it is a real word.
    expect(parse(module_, start, 'zeeble').kind).toBe('magic-word');
  });

  it('does not let a magic word shadow a real verb', () => {
    const shadowed: AdventureModule = {
      ...module_,
      vocabulary: { ...module_.vocabulary, magicWords: [{ word: 'look', eventId: 'zeeble-descend' }] },
    };
    expect(parse(shadowed, start, 'look')).toEqual({ kind: 'verb', verb: 'look' });
  });
});

describe('parse — again (FR-2.3)', () => {
  it.each(['again', 'g'])('%s is the again command', (input) => {
    expect(parse(module_, start, input)).toEqual({ kind: 'again' });
  });
});

describe('parse — forgiving failures (FR-2.4)', () => {
  it('says something for empty input', () => {
    expect(parse(module_, start, '')).toMatchObject({ kind: 'error' });
    expect(parse(module_, start, '   ')).toMatchObject({ kind: 'error' });
  });

  // Transposition is the typo people actually make, and it is two Levenshtein
  // edits — hence Damerau distance in the parser.
  it.each([
    ['tkae lamp', 'take'],
    ['exmaine lamp', 'examine'],
    ['serach tree', 'search'],
    ['dorp lamp', 'drop'],
  ])('suggests the nearest verb for the typo in %s', (input, expected) => {
    const result = parse(module_, at('shed'), input);
    expect(result).toMatchObject({ kind: 'error' });
    if (result.kind === 'error') expect(result.suggestion).toContain(expected);
  });

  it('does not "correct" a word that is nothing like a verb', () => {
    const result = parse(module_, at('shed'), 'frobnicate');
    if (result.kind === 'error') expect(result.suggestion).not.toMatch(/Did you mean/);
  });

  it('suggests a VALID NEARBY ACTION for an unknown word, never a verb list', () => {
    const result = parse(module_, at('shed'), 'frobnicate');
    expect(result).toMatchObject({ kind: 'error' });
    if (result.kind === 'error') {
      expect(result.suggestion).toBeDefined();
      // The bar is a real thing in this room, not jargon.
      expect(result.suggestion).toMatch(/examine|shed|road|lamp|flask|cup/i);
      expect(result.suggestion).not.toMatch(/VNPN|grammar|token|parse/i);
    }
  });

  it('never mentions engine jargon in a failure', () => {
    const inputs = ['frobnicate', 'take unicorn', 'go sideways', 'xyzzy', ''];
    for (const input of inputs) {
      const result = parse(module_, at('shed'), input);
      if (result.kind !== 'error') continue;
      const text = `${result.message} ${result.suggestion ?? ''}`;
      expect(text).not.toMatch(/undefined|null|VNPN|ParseError|token|AST/i);
    }
  });

  it('points at the lamp when the room is dark', () => {
    const dark = { ...start, locationId: 'low-passage' };
    const result = parse(module_, dark, 'examine walls');
    if (result.kind === 'error') expect(result.suggestion).toContain('light lamp');
  });
});

describe('commandSyntaxError — the walkthrough check (T5 TODO(T13))', () => {
  it('accepts every command in test-cave\'s walkthrough', () => {
    for (const step of module_.walkthrough.steps) {
      expect(commandSyntaxError(module_, step.cmd), step.cmd).toBeUndefined();
    }
  });

  it('accepts verbs, directions, and magic words', () => {
    expect(commandSyntaxError(module_, 'take lamp')).toBeUndefined();
    expect(commandSyntaxError(module_, 'n')).toBeUndefined();
    expect(commandSyntaxError(module_, 'zeeble')).toBeUndefined();
    expect(commandSyntaxError(module_, 'oil door with flask')).toBeUndefined();
  });

  it('rejects an unknown head word', () => {
    expect(commandSyntaxError(module_, 'frobnicate the grate')).toContain('frobnicate');
  });

  it('rejects an empty command', () => {
    expect(commandSyntaxError(module_, '')).toBeDefined();
  });

  it('does NOT judge nouns — they are state-dependent', () => {
    // `take unicorn` is syntactically fine; there is no state here to say the
    // unicorn does not exist, and `take key` is legitimately unresolvable until
    // `search tree` puts the key in the world. T23 catches the rest.
    expect(commandSyntaxError(module_, 'take unicorn')).toBeUndefined();
  });
});

describe('parse — purity', () => {
  it('never mutates the state it is given', () => {
    const frozen = structuredClone(start);
    const inputs = ['look', 'take lamp', 'zeeble', 'frobnicate', 'n', 'take cup'];
    for (const input of inputs) parse(module_, start, input);
    expect(start).toEqual(frozen);
  });

  it('is deterministic', () => {
    const a: ParseResult = parse(module_, at('shed'), 'take cup');
    const b: ParseResult = parse(module_, at('shed'), 'take cup');
    expect(a).toEqual(b);
  });
});
