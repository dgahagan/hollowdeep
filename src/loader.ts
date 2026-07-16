import {
  zAdventureModule,
  MODULE_DOCUMENTS,
  type AdventureModule,
  type ModuleDocumentName,
} from './engine/schema';
import { checkConsistency, type ConsistencyErrorCode } from './engine/schema/consistency';
import { ENGINE_VERSION } from './engine/engine';

// ─────────────────────────────────────────────────────────────────────────────
// Adventure loader (design plan §7, T6).
//
// Reads a module's ten documents through an injected `read`, zod-parses each
// against its own schema (T4), assembles the whole `AdventureModule`, checks
// the `manifest.engineVersion` handshake, then cross-checks references
// (`checkConsistency`, T5). All failures — read, JSON syntax, schema,
// version, consistency — surface as one typed `ModuleLoadError` carrying the
// FULL list of problems, never a bare `Error` and never just the first one:
// a content author fixing ten dangling refs should see ten.
//
// THE LOADER NEVER FETCHES OR TOUCHES `fs` ITSELF. It is under the
// engine-purity lint override (`eslint.config.js`'s `ENGINE_FILES`) alongside
// `src/engine/**`: no `fetch`, no `window`/`document`/`localStorage`, no
// `Date.now()`/`new Date()`/`Math.random()`, no React. The caller injects a
// `read(path)` function — the browser (T24) passes a `fetch` adapter, tests
// pass an in-memory map, the CLI (T7) passes an `fs` reader.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Re-exported for callers that already import from the loader. The canonical
 * definition lives in `src/engine/engine.ts` (design plan §10) — the engine
 * owns its own version number; the loader only checks manifests against it.
 */
export { ENGINE_VERSION };

/**
 * `LoadError` mirrors `ConsistencyError`'s shape (`document`/`id`/`field`/
 * `message`) so the CLI (T7) can group and print every failure the same way —
 * `document → id → field: message` — regardless of which stage produced it.
 * `code` is deliberately a SEPARATE, wider type rather than a weakened
 * `ConsistencyErrorCode`: that union stays exactly the set of consistency
 * checks (T5), and the loader's own stages (`read`/`parse`/`schema`/
 * `engine-version`) are added alongside it here instead.
 */
export type LoadErrorCode = ConsistencyErrorCode | 'read' | 'parse' | 'schema' | 'engine-version';

/** Every one of the ten adventure documents, plus the `art/` directory (not a JSON document, but still a thing a caller can fail to read). */
export type LoadErrorDocument = ModuleDocumentName | 'art';

export interface LoadError {
  readonly code: LoadErrorCode;
  readonly document: LoadErrorDocument;
  /** The id of the entity the error is attributed to, or a bracketed placeholder when there isn't one (a whole-file read/parse failure, an unnamed array entry). */
  readonly id: string;
  readonly field: string;
  readonly message: string;
}

/**
 * Thrown by `loadAdventure` for ANY failure — read, malformed JSON, schema,
 * engine-version mismatch, or consistency. `errors` carries every problem
 * found at whichever stage failed (never just the first); `message` is a
 * short human-readable count for contexts that only log `.message` (a debugger
 * pane, an uncaught-exception log line) — callers that want the detail read
 * `.errors`.
 */
export class ModuleLoadError extends Error {
  readonly errors: readonly LoadError[];

  constructor(errors: readonly LoadError[]) {
    const count = errors.length;
    super(`adventure module failed to load: ${count} ${count === 1 ? 'error' : 'errors'} (see .errors for details)`);
    this.name = 'ModuleLoadError';
    this.errors = errors;
  }
}

// ── semver range matching ───────────────────────────────────────────────────
//
// `manifest.engineVersion` is a semver RANGE (`^1.0.0`, `~1.2.0`, `1.0.0`,
// `*`); `ENGINE_VERSION` is an exact version. Only the grammar this project
// actually emits is supported — no dependency on the `semver` package for
// four range shapes. An unparseable range is a hard error (never a silent
// pass): a typo in `engineVersion` must not quietly make every engine version
// "compatible".

interface SemverVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

function parseSemverExact(version: string): SemverVersion | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (match === null) return undefined;
  const [, majorStr, minorStr, patchStr] = match;
  if (majorStr === undefined || minorStr === undefined || patchStr === undefined) return undefined;
  return { major: Number(majorStr), minor: Number(minorStr), patch: Number(patchStr) };
}

function compareSemver(a: SemverVersion, b: SemverVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/** `^x.y.z`: the widest change that doesn't touch the leftmost non-zero component (standard npm/semver caret semantics). */
function satisfiesCaret(target: SemverVersion, actual: SemverVersion): boolean {
  if (compareSemver(actual, target) < 0) return false;
  if (target.major > 0) return actual.major === target.major;
  if (target.minor > 0) return actual.major === 0 && actual.minor === target.minor;
  return actual.major === 0 && actual.minor === 0 && actual.patch === target.patch;
}

/** `~x.y.z`: patch-level changes only. */
function satisfiesTilde(target: SemverVersion, actual: SemverVersion): boolean {
  if (compareSemver(actual, target) < 0) return false;
  return actual.major === target.major && actual.minor === target.minor;
}

export type SemverRangeCheck =
  | { readonly ok: true; readonly satisfies: boolean }
  | { readonly ok: false; readonly message: string };

/**
 * Checks `version` against `range`. Supported grammar: `*` or `""` (any
 * version), `^x.y.z` (caret), `~x.y.z` (tilde), and an exact `x.y.z`. Returns
 * `{ok: false, message}` for a range outside that grammar or an unparseable
 * `version` — the caller must treat that as an error, not a pass.
 *
 * Pure and side-effect-free so it is directly unit-testable without going
 * through `loadAdventure`.
 */
export function checkSemverRange(range: string, version: string): SemverRangeCheck {
  const actual = parseSemverExact(version);
  if (actual === undefined) {
    return { ok: false, message: `not a valid version: "${version}"` };
  }

  const trimmed = range.trim();
  if (trimmed === '' || trimmed === '*') {
    return { ok: true, satisfies: true };
  }

  if (trimmed.startsWith('^')) {
    const target = parseSemverExact(trimmed.slice(1));
    if (target === undefined) return { ok: false, message: `unparseable semver range: "${range}"` };
    return { ok: true, satisfies: satisfiesCaret(target, actual) };
  }

  if (trimmed.startsWith('~')) {
    const target = parseSemverExact(trimmed.slice(1));
    if (target === undefined) return { ok: false, message: `unparseable semver range: "${range}"` };
    return { ok: true, satisfies: satisfiesTilde(target, actual) };
  }

  const exact = parseSemverExact(trimmed);
  if (exact !== undefined) {
    return { ok: true, satisfies: compareSemver(actual, exact) === 0 };
  }

  return { ok: false, message: `unparseable semver range: "${range}"` };
}

// ── small pure helpers ──────────────────────────────────────────────────────

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function valueAtPath(raw: unknown, path: readonly PropertyKey[]): unknown {
  let current: unknown = raw;
  for (const key of path) {
    if (isRecord(current)) {
      current = current[key];
    } else if (Array.isArray(current) && typeof key === 'number') {
      current = current[key];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Best-effort entity id for a schema issue, so a schema failure gets the same
 * `document → id → field` shape as a consistency error. Walks from the full
 * path up to the root looking for the deepest ancestor that carries a string
 * `id` (an item/location/event/… entry) — that's what a content author
 * recognizes. Falls back to the first path segment (a `strings.json` key, an
 * array index) or `"(document)"` for a whole-document issue (e.g. the file's
 * top-level shape is wrong).
 */
function issueId(document: LoadErrorDocument, raw: unknown, path: readonly PropertyKey[]): string {
  if (document === 'manifest.json') return 'manifest';
  for (let depth = path.length; depth >= 1; depth--) {
    const ancestor = valueAtPath(raw, path.slice(0, depth));
    if (isRecord(ancestor) && typeof ancestor.id === 'string') {
      return ancestor.id;
    }
  }
  const first = path[0];
  return first === undefined ? '(document)' : String(first);
}

function issueField(path: readonly PropertyKey[]): string {
  return path.length === 0 ? '(root)' : path.map(String).join('.');
}

/**
 * `MODULE_DOCUMENTS`' filenames (`locations.json`) and `AdventureModule`'s
 * field names (`locations`) differ only by the `.json` suffix — deriving one
 * from the other keeps "what documents exist" stated exactly once, in
 * `MODULE_DOCUMENTS` (src/engine/schema/index.ts), rather than re-listed here.
 */
function documentKey(filename: ModuleDocumentName): string {
  return filename.slice(0, filename.length - '.json'.length);
}

function normalizeBaseDir(baseDir: string): string {
  return baseDir.endsWith('/') ? baseDir : `${baseDir}/`;
}

type ReadOutcome =
  | { readonly filename: ModuleDocumentName; readonly ok: true; readonly text: string }
  | { readonly filename: ModuleDocumentName; readonly ok: false; readonly error: string };

// ── the loader ───────────────────────────────────────────────────────────────

/**
 * Loads, validates, and cross-checks an adventure module.
 *
 * `read` is injected by the caller — this function never fetches or touches
 * `fs`. `baseDir` is the adventure's directory (`adventures/test-cave`, with
 * or without a trailing slash); documents are read from `${baseDir}/<file>`.
 *
 * `listArt` is optional. When provided, it lists `<baseDir>/art/` and that
 * listing is passed to `checkConsistency` so missing art files are reported.
 * When omitted, art files are NOT checked: `checkConsistency` needs *some*
 * file list, but passing `[]` would make every single `artId` look missing
 * (an empty list matches nothing) and manufacture spurious errors for every
 * caller that legitimately can't list a directory (a unit test with no art
 * fixture, a browser without directory listing). So this function still calls
 * `checkConsistency` with `[]` when `listArt` is omitted (reusing one code
 * path rather than forking it), but then filters `missing-art-file` back out
 * of the result before it ever reaches a `ModuleLoadError`.
 *
 * Throws `ModuleLoadError` — never a bare `Error` — carrying every problem
 * found at whichever stage failed: unreadable files, malformed JSON, schema
 * violations, an engine-version mismatch, or consistency errors.
 */
export async function loadAdventure(
  read: (path: string) => Promise<string>,
  baseDir: string,
  listArt?: (dir: string) => Promise<string[]>,
): Promise<AdventureModule> {
  const dir = normalizeBaseDir(baseDir);
  const filenames = Object.keys(MODULE_DOCUMENTS) as ModuleDocumentName[]; // MODULE_DOCUMENTS's own keys are exactly ModuleDocumentName by construction (schema/index.ts) — this reads them, it doesn't re-list them.

  // Concurrent reads (Promise.all), but each read's failure is caught inside
  // its own task rather than left to reject the outer promise: that way one
  // missing file never turns into an unhandled rejection for the others, and
  // every failed read is collected, not just the first.
  const outcomes = await Promise.all(
    filenames.map(async (filename): Promise<ReadOutcome> => {
      try {
        const text = await read(`${dir}${filename}`);
        return { filename, ok: true, text };
      } catch (err) {
        return { filename, ok: false, error: errorMessage(err) };
      }
    }),
  );

  const errors: LoadError[] = [];
  const parsedByFilename = new Map<ModuleDocumentName, unknown>();

  for (const outcome of outcomes) {
    if (!outcome.ok) {
      errors.push({
        code: 'read',
        document: outcome.filename,
        id: '(document)',
        field: '(read)',
        message: `failed to read "${dir}${outcome.filename}": ${outcome.error}`,
      });
      continue;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(outcome.text);
    } catch (err) {
      errors.push({
        code: 'parse',
        document: outcome.filename,
        id: '(document)',
        field: '(parse)',
        message: `invalid JSON in "${dir}${outcome.filename}": ${errorMessage(err)}`,
      });
      continue;
    }

    const schema = MODULE_DOCUMENTS[outcome.filename];
    const result = schema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({
          code: 'schema',
          document: outcome.filename,
          id: issueId(outcome.filename, raw, issue.path),
          field: issueField(issue.path),
          message: issue.message,
        });
      }
      continue;
    }

    parsedByFilename.set(outcome.filename, result.data);
  }

  if (errors.length > 0) {
    throw new ModuleLoadError(errors);
  }

  // Every document parsed individually against the exact schema
  // `zAdventureModule` also uses for that field, so re-assembling and parsing
  // the whole module here is expected to always succeed. Still routed through
  // safeParse (rather than assumed) so a future schema/assembly drift fails
  // as a typed ModuleLoadError instead of an unhandled zod exception.
  const assembled: Record<string, unknown> = {};
  for (const [filename, data] of parsedByFilename) {
    assembled[documentKey(filename)] = data;
  }
  const assembledResult = zAdventureModule.safeParse(assembled);
  if (!assembledResult.success) {
    throw new ModuleLoadError(
      assembledResult.error.issues.map((issue) => ({
        code: 'schema' as const,
        document: 'manifest.json' as const,
        id: issueId('manifest.json', assembled, issue.path),
        field: issueField(issue.path),
        message: issue.message,
      })),
    );
  }
  const adventureModule = assembledResult.data;

  // Engine/adventure version handshake (design plan §10).
  const rangeCheck = checkSemverRange(adventureModule.manifest.engineVersion, ENGINE_VERSION);
  if (!rangeCheck.ok) {
    throw new ModuleLoadError([
      {
        code: 'engine-version',
        document: 'manifest.json',
        id: 'manifest',
        field: 'engineVersion',
        message: `manifest.engineVersion "${adventureModule.manifest.engineVersion}" is ${rangeCheck.message}`,
      },
    ]);
  }
  if (!rangeCheck.satisfies) {
    throw new ModuleLoadError([
      {
        code: 'engine-version',
        document: 'manifest.json',
        id: 'manifest',
        field: 'engineVersion',
        message: `adventure requires engineVersion "${adventureModule.manifest.engineVersion}" but the running engine is "${ENGINE_VERSION}"`,
      },
    ]);
  }

  // Consistency (T5). See the doc comment above for why `[]` is passed and
  // then filtered, rather than skipping the call, when `listArt` is omitted.
  let artFiles: string[] = [];
  if (listArt !== undefined) {
    try {
      artFiles = await listArt(`${dir}art/`);
    } catch (err) {
      throw new ModuleLoadError([
        {
          code: 'read',
          document: 'art',
          id: '(directory)',
          field: '(listArt)',
          message: `failed to list art directory "${dir}art/": ${errorMessage(err)}`,
        },
      ]);
    }
  }
  const consistencyErrors = checkConsistency(adventureModule, artFiles);
  const relevantConsistencyErrors =
    listArt === undefined
      ? consistencyErrors.filter((error) => error.code !== 'missing-art-file')
      : consistencyErrors;

  if (relevantConsistencyErrors.length > 0) {
    throw new ModuleLoadError(relevantConsistencyErrors);
  }

  return adventureModule;
}
