import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAdventure } from '../../src/loader';
import type { AdventureModule } from '../../src/engine/schema';
import type { GameState } from '../../src/engine/types';
import { createGame } from '../../src/engine/state';
import { step, ENGINE_VERSION } from '../../src/engine/engine';
import {
  MIGRATIONS,
  SAVE_VERSION,
  SaveError,
  deserializeSave,
  loadGame,
  saveGame,
  serializeSave,
} from '../../src/engine/save';

const MODULE_DIR = path.resolve(import.meta.dirname, '../../adventures/test-cave');

let module_: AdventureModule;

beforeAll(async () => {
  module_ = await loadAdventure(
    (p) => readFile(p, 'utf8'),
    MODULE_DIR,
    (dir) => readdir(dir),
  );
});

/** A fixed timestamp — engine code cannot read the clock, and neither should a test. */
const AT = 1_700_000_000_000;

/**
 * A genuinely *played* state, not a fresh one.
 *
 * The round-trip property is trivially true of `createGame`'s output: almost
 * every collection is empty, every optional is absent, and the RNG has never
 * advanced, so a save system that dropped `visited`, `firedEvents`, or
 * `itemState` entirely would still pass. Playing first is what gives those
 * fields something to lose — which is exactly why T21's acceptance asks for
 * "across a played walkthrough" rather than a round trip on a new game.
 */
function played(): GameState {
  let state = createGame(module_, 12345);
  // The walkthrough's own opening (adventures/test-cave/walkthrough.json) —
  // borrowed rather than re-derived, since a hand-written route that quietly
  // wanders off the map leaves the fixture trivial and the tests hollow.
  // The lamp is lit only AFTER stepping north into `low-passage` (the one
  // `light: "dark"` room on this route) on purpose: an unlit turn in the dark
  // is what makes the darkness roll fire, so the fixture's `rng` has actually
  // moved by the time it is saved. Seed 12345's draw misses, so the fixture
  // stays a clean played state rather than a death.
  const script = [
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
    'down',
    'n',
    'light lamp',
    'verbose',
    'look',
  ];
  for (const cmd of script) state = step(module_, state, cmd).state;
  return state;
}

describe('the played fixture actually exercises the state', () => {
  // Guards the tests below: if this drifts to a trivial state, every
  // round-trip assertion quietly stops proving anything.
  it('has advanced the rng, visited rooms, fired events, and set item state', () => {
    const state = played();
    expect(state.turn).toBeGreaterThan(5);
    expect(state.rng).not.toBe(createGame(module_, 12345).rng);
    expect(state.visited.length).toBeGreaterThan(1);
    expect(state.firedEvents.length).toBeGreaterThan(0);
    expect(Object.keys(state.itemState).length).toBeGreaterThan(0);
    expect(state.lampFuel).toBeLessThan(module_.manifest.lamp.startFuel);
    expect(state.verbose).toBe(true);
    expect(state.lastCommand).toBeDefined();
  });
});

describe('round trip', () => {
  it('loadGame(saveGame(s)) deep-equals s, across a played walkthrough', () => {
    const state = played();
    expect(loadGame(module_, saveGame(module_, state, AT))).toEqual(state);
  });

  it('survives the string boundary too — serialize, parse, load', () => {
    const state = played();
    expect(deserializeSave(module_, serializeSave(saveGame(module_, state, AT)))).toEqual(state);
  });

  it('a resumed save plays on identically to a game that was never saved', () => {
    // The property that actually matters to a player, and the one a round-trip
    // deep-equal does NOT prove on its own: a state can compare equal and still
    // diverge on the next turn if something the RNG or the turn loop depends on
    // was silently normalized on the way through.
    const start = played();
    const resumed = deserializeSave(module_, serializeSave(saveGame(module_, start, AT)));

    let a = start;
    let b = resumed;
    for (const cmd of ['look', 'wait', 'wait', 'up', 'inventory', 'wait']) {
      const ra = step(module_, a, cmd);
      const rb = step(module_, b, cmd);
      expect(rb.events).toEqual(ra.events);
      a = ra.state;
      b = rb.state;
    }
    expect(b).toEqual(a);
  });

  it('round-trips a fresh game too', () => {
    const state = createGame(module_, 42);
    expect(loadGame(module_, saveGame(module_, state, AT))).toEqual(state);
  });

  it('normalizes a present-but-undefined optional to an absent key', () => {
    // Zod's `.optional()` hands a present-undefined key straight back, and
    // `{itRefers: undefined}` is a different object to `toEqual` and to
    // `JSON.stringify` than `{}` — so without normalizing, two identical games
    // could produce different saves.
    //
    // The engine cannot construct such a state: `exactOptionalPropertyTypes`
    // rejects `{...state, itRefers: undefined}` outright (engine.ts deletes
    // keys instead of assigning undefined, for exactly this reason). But
    // `loadGame` takes `unknown` — a hand-edited save or a file import owes it
    // no such courtesy — so the blob is built the way one would actually
    // arrive, rather than through a type the compiler refuses to forge.
    const blob = saveGame(module_, createGame(module_, 1), AT);
    const withUndefined: unknown = { ...blob, state: { ...blob.state, itRefers: undefined } };

    const loaded = loadGame(module_, withUndefined);
    expect('itRefers' in loaded).toBe(false);
    expect(loaded).toEqual(createGame(module_, 1));
  });
});

describe('the envelope', () => {
  it('records the save format, engine, adventure, and timestamp', () => {
    const blob = saveGame(module_, createGame(module_, 1), AT);
    expect(blob.saveVersion).toBe(SAVE_VERSION);
    expect(blob.engineVersion).toBe(ENGINE_VERSION);
    expect(blob.adventureId).toBe(module_.manifest.id);
    expect(blob.adventureVersion).toBe(module_.manifest.version);
    expect(blob.createdAt).toBe(AT);
  });

  it('takes the timestamp from the caller — the engine never reads a clock', () => {
    expect(saveGame(module_, createGame(module_, 1), 5).createdAt).toBe(5);
    expect(saveGame(module_, createGame(module_, 1), 9).createdAt).toBe(9);
  });
});

describe('typed rejections — never a silent repair (FR-5.3)', () => {
  function expectSaveError(fn: () => unknown, code: string): SaveError {
    try {
      fn();
    } catch (error) {
      expect(error).toBeInstanceOf(SaveError);
      const saveError = error as SaveError;
      expect(saveError.code).toBe(code);
      return saveError;
    }
    throw new Error(`expected a SaveError with code "${code}", but nothing was thrown`);
  }

  it('refuses a save for a different adventure', () => {
    const blob = { ...saveGame(module_, createGame(module_, 1), AT), adventureId: 'hollowdeep' };
    const error = expectSaveError(() => loadGame(module_, blob), 'adventure-mismatch');
    expect(error.details['saveAdventureId']).toBe('hollowdeep');
    expect(error.details['loadedAdventureId']).toBe(module_.manifest.id);
  });

  it('refuses a save from a newer build rather than guessing at it', () => {
    const blob = { ...saveGame(module_, createGame(module_, 1), AT), saveVersion: SAVE_VERSION + 1 };
    const error = expectSaveError(() => loadGame(module_, blob), 'future-version');
    expect(error.details['saveVersion']).toBe(SAVE_VERSION + 1);
  });

  it('reports the wrong adventure even when the version is also unloadable', () => {
    // Both are true; "that's a different adventure" is the more useful thing to
    // be told, so it is checked first.
    const blob = {
      ...saveGame(module_, createGame(module_, 1), AT),
      adventureId: 'hollowdeep',
      saveVersion: SAVE_VERSION + 99,
    };
    expectSaveError(() => loadGame(module_, blob), 'adventure-mismatch');
  });

  it('refuses a blob that is not a save at all', () => {
    expectSaveError(() => loadGame(module_, { hello: 'world' }), 'malformed');
    expectSaveError(() => loadGame(module_, null), 'malformed');
    expectSaveError(() => loadGame(module_, 'a string'), 'malformed');
    expectSaveError(() => loadGame(module_, 42), 'malformed');
  });

  it('refuses an envelope carrying unknown extra keys', () => {
    const blob = { ...saveGame(module_, createGame(module_, 1), AT), somethingElse: true };
    expectSaveError(() => loadGame(module_, blob), 'malformed');
  });

  it('refuses a damaged state, and says which field', () => {
    const blob = saveGame(module_, createGame(module_, 1), AT);
    const damaged = { ...blob, state: { ...blob.state, turn: 'not a number' } };
    const error = expectSaveError(() => loadGame(module_, damaged), 'malformed');
    expect(JSON.stringify(error.details['issues'])).toContain('turn');
  });

  it('refuses a state missing a required field rather than defaulting it', () => {
    const blob = saveGame(module_, createGame(module_, 1), AT);
    const { score: _score, ...withoutScore } = blob.state;
    const error = expectSaveError(() => loadGame(module_, { ...blob, state: withoutScore }), 'malformed');
    expect(JSON.stringify(error.details['issues'])).toContain('score');
  });

  it('refuses unreadable text', () => {
    expectSaveError(() => deserializeSave(module_, 'not json {{{'), 'malformed');
  });

  it('refuses a save too old to have a migration path', () => {
    // A v0 blob with 0 deleted from the registry has no route forward. Restored
    // immediately — MIGRATIONS is module state shared with the tests below.
    const real = MIGRATIONS[0];
    try {
      delete MIGRATIONS[0];
      const blob = { ...saveGame(module_, createGame(module_, 1), AT), saveVersion: 0 };
      const error = expectSaveError(() => loadGame(module_, blob), 'no-migration-path');
      expect(error.details['missingMigrationFrom']).toBe(0);
    } finally {
      if (real !== undefined) MIGRATIONS[0] = real;
    }
  });
});

describe('migrations', () => {
  /** A v0 state: today's shape, minus the field v0 predates. */
  function v0Blob(): Record<string, unknown> {
    const blob = saveGame(module_, { ...createGame(module_, 7), lampWarned: [40] }, AT);
    const { lampWarned: _lampWarned, ...v0State } = blob.state;
    return { ...blob, saveVersion: 0, state: v0State };
  }

  it('the fabricated v0 blob really is missing the field, or this proves nothing', () => {
    expect('lampWarned' in (v0Blob()['state'] as object)).toBe(false);
  });

  it('a v0 blob fails to load without its migration', () => {
    // The other half of the proof: v0 is genuinely unloadable as-is, so the
    // test below is exercising the migration rather than a schema that would
    // have accepted the old shape anyway.
    const real = MIGRATIONS[0];
    try {
      MIGRATIONS[0] = (state) => state; // a migration that does nothing
      expect(() => loadGame(module_, v0Blob())).toThrow(SaveError);
    } finally {
      if (real !== undefined) MIGRATIONS[0] = real;
    }
  });

  it('migrates a v0 blob to the current version', () => {
    const loaded = loadGame(module_, v0Blob());
    expect(loaded.lampWarned).toEqual([]);
    expect(loaded.turn).toBe(0);
    expect(loaded.locationId).toBe(module_.manifest.startLocation);
  });

  it('a migrated save is a real, playable state', () => {
    // A migration can produce something that parses and is still nonsense. The
    // only convincing check is that the turn loop accepts it.
    const loaded = loadGame(module_, v0Blob());
    const result = step(module_, loaded, 'look');
    expect(result.events.some((e) => e.kind === 'text')).toBe(true);
    expect(result.state.turn).toBe(1);
  });

  it('does not run migrations on a current-version save', () => {
    const state = played();
    const before = state.lampWarned;
    expect(loadGame(module_, saveGame(module_, state, AT)).lampWarned).toEqual(before);
  });

  it('every migration in the registry is contiguous up to SAVE_VERSION', () => {
    // A gap makes every save older than it unloadable, and the gap would
    // otherwise only be discovered by the player who owns that save.
    for (let version = 0; version < SAVE_VERSION; version++) {
      expect(MIGRATIONS[version], `missing migration from v${version}`).toBeDefined();
    }
  });

  it('leaves no migration keyed at or above SAVE_VERSION', () => {
    // Such an entry can never run: loadGame stops at SAVE_VERSION. It would
    // mean someone bumped a version and forgot to bump SAVE_VERSION with it.
    for (const key of Object.keys(MIGRATIONS)) {
      expect(Number(key)).toBeLessThan(SAVE_VERSION);
    }
  });
});
