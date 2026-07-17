import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAdventure } from '../../src/loader';
import type { AdventureModule } from '../../src/engine/schema';
import { createGame } from '../../src/engine/state';
import { loadGame, saveGame, serializeSave, SaveError } from '../../src/engine/save';
import { wrapSlot, parseSlotPayload, SLOT_ENVELOPE_VERSION } from '../../src/app/storage';

// T8 (ui-plan §6, cross-task note 5): headless coverage for the slot
// metadata envelope. `storage.ts` promises to keep the engine save payload
// OPAQUE — it never parses or validates `engineSave` itself — so the two
// things worth proving here are (1) the envelope's OWN shape round-trips
// exactly, and (2) `parseSlotPayload` can tell an enveloped slot from a raw
// engine save (the autosave ring, forever; a pre-T8 named slot, until next
// overwritten) without knowing anything about what a `SaveBlob` looks like.
// Whether a given `engineSave` payload is itself VALID is the engine's
// question (`loadGame`), exercised in the last describe block against a
// real module — this is deliberately the same "load a real module, drive a
// real save blob" pattern `tests/app/undo.test.ts` and
// `tests/app/mapLayout.test.ts` already use.

let hollowdeep: AdventureModule;
let testCave: AdventureModule;

async function load(dir: string): Promise<AdventureModule> {
  return loadAdventure(
    (p) => readFile(p, 'utf8'),
    path.resolve(import.meta.dirname, '../../adventures', dir),
    (d) => readdir(d),
  );
}

beforeAll(async () => {
  hollowdeep = await load('hollowdeep');
  testCave = await load('test-cave');
});

describe('wrapSlot + parseSlotPayload — envelope round-trip', () => {
  it('round-trips a wrapped engine save through JSON exactly', () => {
    const state = createGame(hollowdeep, 12345);
    const blob = saveGame(hollowdeep, state, 1_700_000_000_000);

    const envelope = wrapSlot({
      createdAt: 1_700_000_000_000,
      locationName: 'Coach Road',
      score: state.score,
      artId: 'coach-road',
      engineSave: blob,
    });
    expect(envelope.envelopeVersion).toBe(SLOT_ENVELOPE_VERSION);

    const raw = JSON.stringify(envelope);
    const parsed = parseSlotPayload(raw);

    expect(parsed.kind).toBe('envelope');
    if (parsed.kind !== 'envelope') throw new Error('unreachable');
    expect(parsed.envelope.createdAt).toBe(1_700_000_000_000);
    expect(parsed.envelope.locationName).toBe('Coach Road');
    expect(parsed.envelope.score).toBe(state.score);
    expect(parsed.envelope.artId).toBe('coach-road');
    // The whole point of "opaque": the wrapped payload survives byte-for-byte
    // as data, never re-derived or re-shaped by the envelope machinery.
    expect(parsed.envelope.engineSave).toEqual(blob);
  });

  it('omits artId when the slot was saved in the dark, and the envelope omits the key entirely (not `artId: undefined`)', () => {
    const state = createGame(hollowdeep, 12345);
    const blob = saveGame(hollowdeep, state, 1_700_000_000_000);
    const envelope = wrapSlot({
      createdAt: 1_700_000_000_000,
      locationName: 'Somewhere Dark',
      score: 0,
      engineSave: blob,
    });
    expect('artId' in envelope).toBe(false);

    const parsed = parseSlotPayload(JSON.stringify(envelope));
    expect(parsed.kind).toBe('envelope');
    if (parsed.kind !== 'envelope') throw new Error('unreachable');
    expect(parsed.envelope.artId).toBeUndefined();
  });
});

describe('parseSlotPayload — legacy/raw engine saves keep working', () => {
  it('passes a raw (unenveloped) engine save through as `{kind: "raw"}`', () => {
    const state = createGame(hollowdeep, 99);
    const blob = saveGame(hollowdeep, state, 1_650_000_000_000);
    const raw = serializeSave(blob); // exactly what pre-T8 named slots and the autosave ring both write

    const parsed = parseSlotPayload(raw);
    expect(parsed.kind).toBe('raw');
    if (parsed.kind !== 'raw') throw new Error('unreachable');
    // Passed through unvalidated and untouched — `loadGame` is what decides
    // whether it is a real save, not this file.
    expect(parsed.engineSave).toEqual(blob);
  });

  it('a raw payload loads through the engine exactly as it did before T8', () => {
    const state = createGame(testCave, 7);
    const blob = saveGame(testCave, state, 1_650_000_000_000);
    const raw = serializeSave(blob);

    const parsed = parseSlotPayload(raw);
    if (parsed.kind !== 'raw') throw new Error('unreachable');
    const loaded = loadGame(testCave, parsed.engineSave);
    expect(loaded).toEqual(state);
  });
});

describe('parseSlotPayload — corrupted input surfaces an error result, never a throw', () => {
  it('non-JSON text', () => {
    const parsed = parseSlotPayload('this is not json at all {{{');
    expect(parsed.kind).toBe('invalid');
    if (parsed.kind !== 'invalid') throw new Error('unreachable');
    expect(typeof parsed.message).toBe('string');
    expect(parsed.message.length).toBeGreaterThan(0);
  });

  it('valid JSON that is not an object at all (e.g. a bare number or array)', () => {
    expect(parseSlotPayload('42').kind).toBe('raw'); // no envelopeVersion field possible on a number — passes through as raw, same as any other unvalidated blob
    expect(parseSlotPayload('[1,2,3]').kind).toBe('raw');
  });

  it('a malformed envelope (envelopeVersion present, required fields missing) is `invalid`, not silently accepted', () => {
    const parsed = parseSlotPayload(JSON.stringify({ envelopeVersion: SLOT_ENVELOPE_VERSION }));
    expect(parsed.kind).toBe('invalid');
  });
});

describe('an enveloped slot whose engineSave fails loadGame surfaces the real SaveError', () => {
  it('a save for a different adventure: adventure-mismatch', () => {
    const state = createGame(hollowdeep, 1);
    const blob = saveGame(hollowdeep, state, Date.now());
    const envelope = wrapSlot({
      createdAt: Date.now(),
      locationName: 'Coach Road',
      score: 0,
      engineSave: blob,
    });
    const parsed = parseSlotPayload(JSON.stringify(envelope));
    if (parsed.kind !== 'envelope') throw new Error('unreachable');

    // Loading a hollowdeep envelope's engineSave against test-cave's module —
    // exactly the cross-namespace case an import must refuse.
    let caught: unknown;
    try {
      loadGame(testCave, parsed.envelope.engineSave);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SaveError);
    expect((caught as SaveError).code).toBe('adventure-mismatch');
    expect((caught as SaveError).message).toContain('hollowdeep');
  });

  it('a save from a future format version: future-version', () => {
    const state = createGame(hollowdeep, 1);
    const blob = saveGame(hollowdeep, state, Date.now());
    const futureBlob = { ...blob, saveVersion: blob.saveVersion + 1000 };
    const envelope = wrapSlot({
      createdAt: Date.now(),
      locationName: 'Coach Road',
      score: 0,
      engineSave: futureBlob,
    });
    const parsed = parseSlotPayload(JSON.stringify(envelope));
    if (parsed.kind !== 'envelope') throw new Error('unreachable');

    let caught: unknown;
    try {
      loadGame(hollowdeep, parsed.envelope.engineSave);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SaveError);
    expect((caught as SaveError).code).toBe('future-version');
    expect((caught as SaveError).message).toMatch(/newer version/);
  });
});
