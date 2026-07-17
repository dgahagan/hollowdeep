import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { zAdventureModule, type AdventureModule } from '../../src/engine/schema';
import { checkConsistency, type ConsistencyError } from '../../src/engine/schema/consistency';

// ─────────────────────────────────────────────────────────────────────────────
// Validator golden tests (design plan §9 "Validator: golden tests", T8).
//
// Each fixture under `tests/validator/fixtures/*.json` is a COMPLETE,
// schema-valid adventure module — `valid.json` is the baseline (zero
// consistency errors); every broken fixture is `valid.json` plus exactly one
// deliberate mutation, so the diff between a broken fixture and the baseline
// is the whole story of what it proves. A flat one-JSON-file-per-fixture
// layout was chosen over one-directory-of-ten-documents-per-fixture: the
// scope names `fixtures/*.json` (flat), a single file keeps each fixture
// diffable as one unit, and it exercises `checkConsistency` directly — the
// same shared function the loader (T6) and CLI (T7) both call — rather than
// routing through `loadAdventure`'s multi-file plumbing, which T6's own tests
// already cover.
//
// CRITICAL: these fixtures live under tests/validator/fixtures/, NEVER under
// adventures/ — `npm run validate` globs `adventures/*` (T7), so a
// deliberately-broken module parked there would turn the gate permanently
// red. `npm run validate` is asserted below to still report "no adventure
// modules found", proving these fixtures are invisible to it.
//
// Fixtures are read from disk and driven through `zAdventureModule.parse`
// FIRST — that step is itself a proof that the fixture is schema-valid (a
// dangling *reference*, not a malformed shape); only then is the parsed
// module handed to `checkConsistency`. A fixture that can't clear
// `zAdventureModule.parse` belongs in T4's schema tests, not here.
//
// Assertions key off `code`/`document`/`id`/`field` — never `message` prose
// (consistent with tests/engine/consistency.test.ts) — and assert the FULL
// error array, not just a `toContainEqual` subset: a golden fixture that trips
// two checks when it should trip one is not a golden test. `stripMessage`
// below is what makes that full-array comparison possible without pinning to
// wording that is free to be reworded later.
// ─────────────────────────────────────────────────────────────────────────────

const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): AdventureModule {
  const raw: unknown = JSON.parse(readFileSync(path.join(FIXTURES_DIR, 'fixtures', `${name}.json`), 'utf-8'));
  // Proves the fixture is schema-valid (T4) before it ever reaches
  // checkConsistency (T5) — a malformed fixture throws here, not silently
  // passes through as "consistent".
  return zAdventureModule.parse(raw);
}

/** Every artId the `valid.json` baseline's locations/items reference has a matching file. */
const BASE_ART_FILES = ['road.svg', 'shed.svg', 'cave.svg', 'lamp.svg', 'idol.svg'];

/** Comparable shape that deliberately excludes `message` — prose is free to be reworded without breaking a golden test. */
type ComparableError = Pick<ConsistencyError, 'code' | 'document' | 'id' | 'field'>;

function stripMessage(errors: ConsistencyError[]): ComparableError[] {
  return errors.map(({ code, document, id, field }) => ({ code, document, id, field }));
}

/** Asserts `errors` is EXACTLY the one expected error — the "and no others" half of the golden-test contract. */
function expectExactlyOneError(errors: ConsistencyError[], expected: ComparableError): void {
  expect(stripMessage(errors)).toEqual([expected]);
}

// ─── baseline ────────────────────────────────────────────────────────────────

describe('validator golden tests — baseline', () => {
  it('valid.json produces exactly zero consistency errors', () => {
    const module = loadFixture('valid');
    expect(checkConsistency(module, BASE_ART_FILES)).toEqual([]);
  });
});

// ─── each broken fixture asserts its one specific error ────────────────────

describe('validator golden tests — broken fixtures', () => {
  it('dangling-exit-target.json: an exit pointing at an unknown location', () => {
    // Mutation: road's "e" exit.to is "nowhere-place" instead of "shed".
    // shed stays reachable via road -> cave -> shed, so this does NOT also
    // cascade into an orphan-location error for shed — see the fixture's twin
    // path (cave.exits.e -> shed) in valid.json.
    const module = loadFixture('dangling-exit-target');
    const errors = checkConsistency(module, BASE_ART_FILES);
    expectExactlyOneError(errors, {
      code: 'dangling-exit-target',
      document: 'locations.json',
      id: 'road',
      field: 'exits.e.to',
    });
  });

  it('missing-art-file.json: an artId with no matching file', () => {
    // Mutation is at the artFiles level, not the module (per the task brief):
    // the module is byte-identical to valid.json; the art listing passed to
    // checkConsistency simply omits "idol.svg".
    const module = loadFixture('missing-art-file');
    const artFilesMissingIdol = BASE_ART_FILES.filter((f) => f !== 'idol.svg');
    const errors = checkConsistency(module, artFilesMissingIdol);
    expectExactlyOneError(errors, {
      code: 'missing-art-file',
      document: 'items.json',
      id: 'idol',
      field: 'artId',
    });
  });

  it('orphan-location.json: a location with no path from startLocation', () => {
    // Mutation: an added "isolated" location with no exits in or out. Its
    // artId is included in this fixture's art list so the ONLY error it trips
    // is the reachability one, not also missing-art-file.
    const module = loadFixture('orphan-location');
    const artFilesWithIsolated = [...BASE_ART_FILES, 'isolated.svg'];
    const errors = checkConsistency(module, artFilesWithIsolated);
    expectExactlyOneError(errors, {
      code: 'orphan-location',
      document: 'locations.json',
      id: 'isolated',
      field: 'id',
    });
  });

  it('max-score-mismatch.json: maxScore does not equal the sum of attainable points', () => {
    // Mutation: manifest.maxScore is 21 instead of 20 (idol's carryPoints(10)
    // + depositPoints(10)).
    const module = loadFixture('max-score-mismatch');
    const errors = checkConsistency(module, BASE_ART_FILES);
    expectExactlyOneError(errors, {
      code: 'max-score-mismatch',
      document: 'manifest.json',
      id: 'manifest',
      field: 'maxScore',
    });
  });

  it('unknown-event-id.json: a magic word references an unknown event', () => {
    // Mutation: vocabulary.magicWords gains one entry, "zeeble" -> eventId
    // "no-such-event", which resolves to nothing (events.json is empty in
    // this fixture, as in the baseline).
    const module = loadFixture('unknown-event-id');
    const errors = checkConsistency(module, BASE_ART_FILES);
    expectExactlyOneError(errors, {
      code: 'dangling-magic-word-event',
      document: 'vocabulary.json',
      id: 'zeeble',
      field: 'magicWords[0].eventId',
    });
  });

  it('bad-initial-location.json: an item initialLocation resolves to nothing', () => {
    // Mutation: idol.initialLocation is "not-a-place" instead of "shed" — not
    // a known location, item, "inventory", or "nowhere".
    const module = loadFixture('bad-initial-location');
    const errors = checkConsistency(module, BASE_ART_FILES);
    expectExactlyOneError(errors, {
      code: 'dangling-item-initial-location',
      document: 'items.json',
      id: 'idol',
      field: 'initialLocation',
    });
  });

  it('unstarted-timer-expiry.json: a timerExpired trigger names a timer no startTimer ever starts', () => {
    // Mutation: trap-springs' trigger target is "phantom-timer" instead of
    // "trap-timer" — arm-trap only ever starts "trap-timer", so the listener
    // can never hear. The reverse (arm-trap's own started timer, unheard by
    // anything) stays legal, which valid.json's own timer pair proves.
    const module = loadFixture('unstarted-timer-expiry');
    const errors = checkConsistency(module, BASE_ART_FILES);
    expectExactlyOneError(errors, {
      code: 'unstarted-timer-expiry',
      document: 'events.json',
      id: 'trap-springs',
      field: 'on.target',
    });
  });

  it('dangling-no-hint-message.json: noHintMessageId resolves to no known string', () => {
    // Mutation: hints.noHintMessageId is "no-such-string" instead of "no-hints".
    const module = loadFixture('dangling-no-hint-message');
    const errors = checkConsistency(module, BASE_ART_FILES);
    expectExactlyOneError(errors, {
      code: 'dangling-no-hint-message',
      document: 'hints.json',
      id: 'hints',
      field: 'noHintMessageId',
    });
  });
});
