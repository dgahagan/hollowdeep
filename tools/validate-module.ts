import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { loadAdventure, ModuleLoadError, type LoadError, type LoadErrorDocument } from '../src/loader';

// ─────────────────────────────────────────────────────────────────────────────
// `validate-module` CLI (design plan §4.2, T7).
//
// A thin CLI over `loadAdventure` (T6) with a real `fs` reader — `tools/` is
// NOT under the engine-purity lint override (`eslint.config.js`'s
// `ENGINE_FILES`), so `fs` is legitimate here. All the actual checking lives
// in T4 (zod schemas) and T5 (`checkConsistency`); this file is argv → reader
// → format → exit code, nothing more.
//
// Which modules get checked: the orchestration playbook's gate says
// "consistency checks on adventures/*", so with no argv this globs every
// subdirectory of `adventures/`. Explicit paths on argv override the glob —
// that's how T8's fixtures (under tests/validator/, never under adventures/)
// stay invisible to `npm run validate` while still being reachable by hand.
//
// Exit code: 0 only if every targeted module loaded cleanly (an empty glob
// counts as clean, but it prints why). 1 if any module failed, or a given
// path isn't a directory at all.
// ─────────────────────────────────────────────────────────────────────────────

const ADVENTURES_DIR = 'adventures';

/**
 * The order `LoadErrorDocument` values are grouped in when printing —
 * `MODULE_DOCUMENTS`' document order, plus `art` (not a JSON document, but
 * still a document errors can be attributed to). Hardcoded rather than
 * derived from `MODULE_DOCUMENTS` so this file needs no cast to satisfy
 * `LoadErrorDocument`'s type — every literal below is checked against it.
 */
const DOCUMENT_ORDER: readonly LoadErrorDocument[] = [
  'manifest.json',
  'locations.json',
  'items.json',
  'creatures.json',
  'vocabulary.json',
  'events.json',
  'scoring.json',
  'achievements.json',
  'strings.json',
  'walkthrough.json',
  'art',
];

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasErrnoCode(err: unknown, code: string): boolean {
  return isRecord(err) && err.code === code;
}

/** Reads a module document from disk. Injected into `loadAdventure` per T6's contract. */
function read(filePath: string): Promise<string> {
  return readFile(filePath, 'utf-8');
}

/**
 * Lists a module's `art/` directory. A missing directory is a legitimate
 * state (T9 lands test-cave before T10 lands its art) and is treated as an
 * empty list rather than a crash — `checkConsistency` then reports every
 * `artId` as a real `missing-art-file` error, which is exactly right. Any
 * other read failure (permissions, etc.) is a genuine problem and is left to
 * propagate — `loadAdventure` turns it into a `read`/`art` `LoadError`.
 */
async function listArt(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (hasErrnoCode(err, 'ENOENT')) return [];
    throw err;
  }
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

/** Sorted subdirectories of `adventures/` — the default target set. `[]` (missing/empty dir) is not an error; the caller decides what to say about it. */
async function discoverModules(): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(ADVENTURES_DIR, { withFileTypes: true });
  } catch (err) {
    if (hasErrnoCode(err, 'ENOENT')) return [];
    throw err;
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(ADVENTURES_DIR, entry.name))
    .sort();
}

type DirCheck = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** A path that doesn't exist or isn't a directory gets one clear message instead of ten confusing "failed to read" errors from `loadAdventure`. */
async function checkModuleDir(target: string): Promise<DirCheck> {
  try {
    const stats = await stat(target);
    if (!stats.isDirectory()) {
      return { ok: false, message: `"${target}" is not a directory` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: `"${target}" does not exist or is not accessible: ${errorMessage(err)}` };
  }
}

/**
 * Groups errors by document (in `DOCUMENT_ORDER`), sorted by id then field
 * within each group, and prints each as `document → id → field: message` —
 * the format a content author can fix top-to-bottom without decoding
 * anything.
 */
function printGroupedErrors(errors: readonly LoadError[]): void {
  for (const document of DOCUMENT_ORDER) {
    const inDocument = errors
      .filter((error) => error.document === document)
      .sort((a, b) => a.id.localeCompare(b.id) || a.field.localeCompare(b.field));
    for (const error of inDocument) {
      console.log(`  ${document} → ${error.id} → ${error.field}: ${error.message}`);
    }
  }
}

async function validateOne(target: string): Promise<boolean> {
  const dirCheck = await checkModuleDir(target);
  if (!dirCheck.ok) {
    console.log(`✗ ${target}`);
    console.log(`  ${dirCheck.message}`);
    return false;
  }

  try {
    const module = await loadAdventure(read, target, listArt);
    console.log(
      `✓ ${target} — ${module.locations.length} locations, ${module.items.length} items, ${module.creatures.length} creatures`,
    );
    return true;
  } catch (err) {
    if (err instanceof ModuleLoadError) {
      const count = err.errors.length;
      console.log(`✗ ${target} — ${count} ${count === 1 ? 'error' : 'errors'}`);
      printGroupedErrors(err.errors);
    } else {
      console.log(`✗ ${target} — ${errorMessage(err)}`);
    }
    return false;
  }
}

async function main(): Promise<number> {
  const argvTargets = process.argv.slice(2);
  const targets = argvTargets.length > 0 ? argvTargets : await discoverModules();

  if (targets.length === 0) {
    console.log(`no adventure modules found in ${ADVENTURES_DIR}/ — nothing to validate`);
    return 0;
  }

  let allOk = true;
  for (const target of targets) {
    const ok = await validateOne(target);
    allOk = allOk && ok;
  }

  return allOk ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error(errorMessage(err));
  process.exitCode = 1;
}
