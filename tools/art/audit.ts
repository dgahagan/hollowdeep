import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadManifest, resolveSubjects, isClassManifest } from './build-request';

// tools/art/audit.ts — diffs an art manifest against the artIds a module
// actually references (design plan §3, §6; art-implementation-plan T1).
//
// Two kinds of failure:
//   * MISSING  — a module artId (location/item/creature) has no manifest
//     subject for it. The six twisty-maze rooms share one artId ("twisty"),
//     so this counts distinct artIds, never location count.
//   * ORPHANED — a manifest subject that is neither a module artId nor
//     (class dialect only) `class: "marquee"`. Marquee ids are NOT
//     hardcoded here — a subject earns the pass by declaring its class,
//     which is the data-driven form the design plan asks for. The eleven
//     marquee ids themselves live only in dev/art/hollowdeep.json, not in
//     this file. (Flat-dialect manifests, i.e. test-cave, have no `class`
//     field at all, so nothing there can ever pass as a marquee — every
//     flat-dialect subject must be a real module artId. test-cave has no
//     marquees, so this is exactly right for it.)
//
// Usage: npx tsx tools/art/audit.ts <manifest.json> [adventureDir]
//   adventureDir defaults to adventures/<manifest's basename without .json>.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isEnoent(err: unknown): boolean {
  return isRecord(err) && err.code === 'ENOENT';
}

function readArtIds(jsonPath: string): Set<string> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch (err) {
    if (isEnoent(err)) return new Set();
    throw err;
  }
  if (!Array.isArray(raw)) {
    throw new Error(`${jsonPath}: expected a JSON array at the top level`);
  }
  const ids = new Set<string>();
  for (const entry of raw) {
    if (isRecord(entry) && typeof entry.artId === 'string') {
      ids.add(entry.artId);
    }
  }
  return ids;
}

/** Every artId the module references: locations + items + creatures, deduplicated (shared artIds, e.g. the maze, count once). */
export function collectModuleArtIds(adventureDir: string): Set<string> {
  const ids = new Set<string>();
  for (const doc of ['locations.json', 'items.json', 'creatures.json']) {
    for (const id of readArtIds(path.join(adventureDir, doc))) ids.add(id);
  }
  return ids;
}

export interface AuditResult {
  /** Module artIds with no manifest subject for them. */
  missing: string[];
  /** Manifest subjects that are neither a module artId nor class "marquee". */
  orphaned: string[];
}

export function audit(manifestPath: string, adventureDir: string): AuditResult {
  const manifest = loadManifest(manifestPath);
  const moduleArtIds = collectModuleArtIds(adventureDir);
  const subjects = resolveSubjects(manifest);
  const subjectIds = new Set(subjects.map((subject) => subject.id));
  const classDialect = isClassManifest(manifest);

  const missing = [...moduleArtIds].filter((id) => !subjectIds.has(id)).sort();

  const orphaned = subjects
    .filter((subject) => !moduleArtIds.has(subject.id) && !(classDialect && subject.class === 'marquee'))
    .map((subject) => subject.id)
    .sort();

  return { missing, orphaned };
}

/** `dev/art/<name>.json` audits `adventures/<name>` by default. */
export function inferAdventureDir(manifestPath: string): string {
  const base = path.basename(manifestPath, '.json');
  return path.join('adventures', base);
}

function main(): void {
  const [manifestPath, adventureDirArg] = process.argv.slice(2);
  if (manifestPath === undefined) {
    console.error('usage: audit.ts <manifest.json> [adventureDir]');
    process.exit(1);
  }
  const adventureDir = adventureDirArg ?? inferAdventureDir(manifestPath);
  const result = audit(manifestPath, adventureDir);

  if (result.missing.length === 0 && result.orphaned.length === 0) {
    console.log(`✓ ${manifestPath} ⇄ ${adventureDir} — every artId accounted for`);
    return;
  }

  console.log(`✗ ${manifestPath} ⇄ ${adventureDir}`);
  if (result.missing.length > 0) {
    console.log(`  missing (module artId with no manifest subject):`);
    for (const id of result.missing) console.log(`    - ${id}`);
  }
  if (result.orphaned.length > 0) {
    console.log(`  orphaned (manifest subject matching no module artId, and not class "marquee"):`);
    for (const id of result.orphaned) console.log(`    - ${id}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
