import { describe, expect, it } from 'vitest';
import { zAdventureModule } from '../../src/engine/schema';
import {
  loadAdventure,
  checkSemverRange,
  ENGINE_VERSION,
  ModuleLoadError,
  type LoadError,
} from '../../src/loader';

// Adventure loader tests (T6). Everything here uses an in-memory
// `Record<path, string>` reader — no `fs`, no network — per the task brief.
//
// The valid fixture is intentionally tiny (2 locations, 2 items, one
// treasure) rather than a full walkthrough-ready module: it exists to prove
// the loader's plumbing (read → JSON.parse → per-document zod parse →
// assemble → version handshake → checkConsistency), not to be a second
// test-cave. `maxScore: 20` = idol's carryPoints(10) + depositPoints(10), so
// `checkConsistency`'s arithmetic check passes on the unmodified fixture.

const BASE = 'adventures/loader-fixture';

function validRaw(): Record<string, unknown> {
  return {
    manifest: {
      id: 'loader-fixture',
      title: 'Loader Fixture',
      version: '1.0.0',
      engineVersion: '^1.0.0',
      startLocation: 'road',
      repositoryLocation: 'shed',
      maxScore: 20,
      carryLimit: 5,
      lamp: { itemId: 'lamp', startFuel: 50, warnAt: [10], warnMessageId: 'lamp-low', exhaustMessageId: 'lamp-dead' },
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
        full: 'A dusty road running past a shed.',
        artId: 'road',
        light: 'lit',
        exits: { e: { to: 'shed' } },
      },
      {
        id: 'shed',
        name: 'Shed',
        brief: 'A small shed.',
        full: 'A small shed, door hanging loose.',
        artId: 'shed',
        light: 'lit',
        exits: { w: { to: 'road' } },
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
        id: 'idol',
        names: ['idol'],
        brief: 'A jade idol lies here.',
        description: 'A small jade idol, cool to the touch.',
        artId: 'idol',
        portable: true,
        initialLocation: 'shed',
        treasure: { carryPoints: 10, depositPoints: 10 },
      },
    ],
    creatures: [],
    vocabulary: { verbs: [], noiseWords: [], magicWords: [] },
    events: [],
    scoring: {
      milestones: [],
      deathPenalty: 5,
      ranks: [{ minScore: 0, title: 'Newcomer' }],
    },
    achievements: [],
    strings: {
      'lamp-low': 'The lamp is getting dim.',
      'lamp-dead': 'The lamp goes out.',
      'dark-warning': 'It is pitch dark.',
      'dark-death': 'You stumble and fall.',
    },
    walkthrough: { steps: [{ cmd: 'look' }], expectedScore: 20 },
  };
}

const VALID_ART_FILES = ['road.svg', 'shed.svg', 'lamp.svg', 'idol.svg'];

/** Stringifies each document under `${base}/<name>.json`, matching `MODULE_DOCUMENTS`' filenames. */
function toFiles(raw: Record<string, unknown>, base: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    files[`${base}/${key}.json`] = JSON.stringify(value);
  }
  return files;
}

function makeReader(files: Record<string, string>): (path: string) => Promise<string> {
  return (path: string) => {
    const text = files[path];
    if (text === undefined) {
      return Promise.reject(new Error(`ENOENT: no such file "${path}"`));
    }
    return Promise.resolve(text);
  };
}

function makeListArt(files: string[]): (dir: string) => Promise<string[]> {
  return () => Promise.resolve(files);
}

/** Runs `loadAdventure` and asserts it rejects with a `ModuleLoadError`, returning it for further assertions. */
async function expectLoadError(
  read: (path: string) => Promise<string>,
  base: string,
  listArt?: (dir: string) => Promise<string[]>,
): Promise<ModuleLoadError> {
  await expect(loadAdventure(read, base, listArt)).rejects.toBeInstanceOf(ModuleLoadError);
  try {
    await loadAdventure(read, base, listArt);
    throw new Error('expected loadAdventure to reject');
  } catch (err) {
    if (err instanceof ModuleLoadError) return err;
    throw err;
  }
}

function hasError(errors: readonly LoadError[], expected: Partial<LoadError>): boolean {
  return errors.some((e) =>
    Object.entries(expected).every(([key, value]) => e[key as keyof LoadError] === value),
  );
}

// ─── happy path ──────────────────────────────────────────────────────────────

describe('loadAdventure — happy path', () => {
  it('loads a valid module and returns the parsed result', async () => {
    const files = toFiles(validRaw(), BASE);
    const result = await loadAdventure(makeReader(files), BASE, makeListArt(VALID_ART_FILES));
    expect(result).toEqual(zAdventureModule.parse(validRaw()));
  });

  it('normalizes a trailing slash on baseDir', async () => {
    const files = toFiles(validRaw(), BASE);
    const withSlash = await loadAdventure(
      makeReader(files),
      `${BASE}/`,
      makeListArt(VALID_ART_FILES),
    );
    const withoutSlash = await loadAdventure(
      makeReader(files),
      BASE,
      makeListArt(VALID_ART_FILES),
    );
    expect(withSlash).toEqual(withoutSlash);
  });
});

// ─── schema failure ──────────────────────────────────────────────────────────

describe('loadAdventure — schema failure', () => {
  it('rejects with ModuleLoadError carrying every schema issue, not just the first', async () => {
    const files = toFiles(validRaw(), BASE);
    // Break two documents at once: locations[0] is missing `full`, and
    // manifest.carryLimit is not positive.
    files[`${BASE}/locations.json`] = JSON.stringify([
      { id: 'road', name: 'Road', brief: 'A dusty road.', artId: 'road', light: 'lit', exits: {} },
      {
        id: 'shed',
        name: 'Shed',
        brief: 'A small shed.',
        full: 'A small shed.',
        artId: 'shed',
        light: 'lit',
        exits: {},
      },
    ]);
    const manifest = { ...(validRaw().manifest as Record<string, unknown>), carryLimit: -1 };
    files[`${BASE}/manifest.json`] = JSON.stringify(manifest);

    const error = await expectLoadError(makeReader(files), BASE, makeListArt(VALID_ART_FILES));
    expect(error.errors.length).toBeGreaterThanOrEqual(2);
    expect(hasError(error.errors, { code: 'schema', document: 'locations.json' })).toBe(true);
    expect(hasError(error.errors, { code: 'schema', document: 'manifest.json' })).toBe(true);
  });
});

// ─── consistency failure ─────────────────────────────────────────────────────

describe('loadAdventure — consistency failure', () => {
  it('rejects with ModuleLoadError carrying the consistency error', async () => {
    const raw = validRaw();
    const manifest = { ...(raw.manifest as Record<string, unknown>), repositoryLocation: 'no-such-place' };
    const files = toFiles({ ...raw, manifest }, BASE);

    const error = await expectLoadError(makeReader(files), BASE, makeListArt(VALID_ART_FILES));
    expect(
      hasError(error.errors, {
        code: 'dangling-repository-location',
        document: 'manifest.json',
        id: 'manifest',
        field: 'repositoryLocation',
      }),
    ).toBe(true);
  });
});

// ─── engineVersion handshake ─────────────────────────────────────────────────

describe('loadAdventure — engineVersion handshake', () => {
  it('rejects when the range does not match ENGINE_VERSION', async () => {
    const raw = validRaw();
    const manifest = { ...(raw.manifest as Record<string, unknown>), engineVersion: '^2.0.0' };
    const files = toFiles({ ...raw, manifest }, BASE);

    const error = await expectLoadError(makeReader(files), BASE, makeListArt(VALID_ART_FILES));
    expect(error.errors).toHaveLength(1);
    expect(hasError(error.errors, { code: 'engine-version', document: 'manifest.json', id: 'manifest' })).toBe(
      true,
    );
    expect(error.errors[0]?.message).toContain('^2.0.0');
    expect(error.errors[0]?.message).toContain(ENGINE_VERSION);
  });

  it('accepts a range that matches ENGINE_VERSION', async () => {
    const files = toFiles(validRaw(), BASE);
    await expect(
      loadAdventure(makeReader(files), BASE, makeListArt(VALID_ART_FILES)),
    ).resolves.toBeDefined();
  });
});

// ─── malformed JSON ──────────────────────────────────────────────────────────

describe('loadAdventure — malformed JSON', () => {
  it('rejects with ModuleLoadError instead of throwing a raw SyntaxError', async () => {
    const files = toFiles(validRaw(), BASE);
    files[`${BASE}/items.json`] = '{ this is not valid json ';

    const error = await expectLoadError(makeReader(files), BASE, makeListArt(VALID_ART_FILES));
    expect(hasError(error.errors, { code: 'parse', document: 'items.json' })).toBe(true);
  });
});

// ─── missing / unreadable document ───────────────────────────────────────────

describe('loadAdventure — missing document', () => {
  it('rejects with ModuleLoadError instead of an unhandled rejection', async () => {
    const files = toFiles(validRaw(), BASE);
    delete files[`${BASE}/events.json`];

    const error = await expectLoadError(makeReader(files), BASE, makeListArt(VALID_ART_FILES));
    expect(hasError(error.errors, { code: 'read', document: 'events.json' })).toBe(true);
  });

  it('reports every missing document, not just the first, thanks to concurrent reads', async () => {
    const files = toFiles(validRaw(), BASE);
    delete files[`${BASE}/events.json`];
    delete files[`${BASE}/achievements.json`];

    const error = await expectLoadError(makeReader(files), BASE, makeListArt(VALID_ART_FILES));
    expect(hasError(error.errors, { code: 'read', document: 'events.json' })).toBe(true);
    expect(hasError(error.errors, { code: 'read', document: 'achievements.json' })).toBe(true);
  });
});

// ─── listArt: provided vs. omitted ───────────────────────────────────────────

describe('loadAdventure — listArt', () => {
  it('fires missing-art-file errors when listArt is provided and a file is missing', async () => {
    const files = toFiles(validRaw(), BASE);
    const incompleteArt = VALID_ART_FILES.filter((f) => f !== 'idol.svg');

    const error = await expectLoadError(makeReader(files), BASE, makeListArt(incompleteArt));
    expect(
      hasError(error.errors, { code: 'missing-art-file', document: 'items.json', id: 'idol' }),
    ).toBe(true);
  });

  it('suppresses missing-art-file errors when listArt is omitted', async () => {
    const files = toFiles(validRaw(), BASE);
    // No listArt argument at all — art can't be checked, so it mustn't be
    // reported as universally missing either.
    const result = await loadAdventure(makeReader(files), BASE);
    expect(result.manifest.id).toBe('loader-fixture');
  });
});

// ─── semver range matcher ────────────────────────────────────────────────────

describe('checkSemverRange', () => {
  it('"*" and "" match any version', () => {
    expect(checkSemverRange('*', '1.0.0')).toEqual({ ok: true, satisfies: true });
    expect(checkSemverRange('', '9.9.9')).toEqual({ ok: true, satisfies: true });
  });

  it('caret ranges allow same-major upgrades but not major bumps', () => {
    expect(checkSemverRange('^1.0.0', '1.0.0')).toEqual({ ok: true, satisfies: true });
    expect(checkSemverRange('^1.0.0', '1.4.2')).toEqual({ ok: true, satisfies: true });
    expect(checkSemverRange('^1.0.0', '2.0.0')).toEqual({ ok: true, satisfies: false });
    expect(checkSemverRange('^1.2.0', '1.1.9')).toEqual({ ok: true, satisfies: false });
  });

  it('caret ranges on 0.x versions only allow patch bumps (npm semantics)', () => {
    expect(checkSemverRange('^0.2.3', '0.2.9')).toEqual({ ok: true, satisfies: true });
    expect(checkSemverRange('^0.2.3', '0.3.0')).toEqual({ ok: true, satisfies: false });
    expect(checkSemverRange('^0.0.3', '0.0.4')).toEqual({ ok: true, satisfies: false });
    expect(checkSemverRange('^0.0.3', '0.0.3')).toEqual({ ok: true, satisfies: true });
  });

  it('tilde ranges allow only patch-level changes', () => {
    expect(checkSemverRange('~1.2.0', '1.2.5')).toEqual({ ok: true, satisfies: true });
    expect(checkSemverRange('~1.2.0', '1.3.0')).toEqual({ ok: true, satisfies: false });
    expect(checkSemverRange('~1.2.3', '1.2.1')).toEqual({ ok: true, satisfies: false });
  });

  it('an exact version range matches only that exact version', () => {
    expect(checkSemverRange('1.0.0', '1.0.0')).toEqual({ ok: true, satisfies: true });
    expect(checkSemverRange('1.0.0', '1.0.1')).toEqual({ ok: true, satisfies: false });
  });

  it('an unparseable range is an error, never a silent pass', () => {
    const result = checkSemverRange('>=1.0.0 <2.0.0', '1.5.0');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('unparseable');
    }
  });

  it('an unparseable version is also an error', () => {
    const result = checkSemverRange('^1.0.0', 'not-a-version');
    expect(result.ok).toBe(false);
  });
});
