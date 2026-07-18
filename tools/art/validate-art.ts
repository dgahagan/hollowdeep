import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { audit, inferAdventureDir } from './audit';
import { loadManifest, resolveSubjects, type ArtManifest } from './build-request';

// tools/art/validate-art.ts — `npm run validate:art`. For every
// dev/art/*.json: schema-validate whichever dialect it is (build-request.ts
// does the parsing), then run audit.ts against its adventure (design plan
// §6/§8; art-implementation-plan T1).
//
// Two modes:
//   * default — the gate mode (wired into `npm run gate`). Prompts may be
//     empty strings and seeds/chosen_seed unpicked; a manifest still under
//     production (T2-T6 of art-implementation-plan) is expected to look like
//     this and must not fail the gate.
//   * --strict — every subject must have a non-empty prompt, a recorded seed
//     list, a `chosen_seed`, AND its final file on disk at
//     adventures/<adventureId>/art/<artId>.webp. This is the T7+ mode (the
//     atomic flip replaces default mode with --strict in the gate script).
//
// Which manifests get checked: no argv -> every dev/art/*.json (glob).
// Explicit paths on argv override the glob, matching validate-module.ts's
// convention.
//
// Exit code: 0 only if every targeted manifest is schema-valid AND passes
// audit AND (in --strict) every subject is finaled. 1 otherwise.

const ART_DIR = 'dev/art';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isEnoent(err: unknown): boolean {
  return isRecord(err) && err.code === 'ENOENT';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function discoverManifests(): string[] {
  let entries: string[];
  try {
    entries = readdirSync(ART_DIR);
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
  return entries
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => path.join(ART_DIR, entry))
    .sort();
}

interface ValidationOutcome {
  ok: boolean;
  lines: string[];
}

function checkStrict(manifest: ArtManifest, adventureId: string): string[] {
  const lines: string[] = [];
  for (const subject of resolveSubjects(manifest)) {
    const problems: string[] = [];
    if (subject.prompt.trim().length === 0) problems.push('empty prompt');
    // The candidate pool a subject was curated from: its own list, else the
    // manifest-level default (schema-required). T7 fix — the original check
    // demanded per-subject lists, which neither manifest ever writes, so
    // strict could never pass; determinism needs prompt + chosen_seed + dims,
    // with the pool recorded at either level.
    const seedPool = subject.declaredSeeds ?? manifest.seeds;
    if (seedPool.length === 0) problems.push('no seeds recorded');
    if (subject.chosenSeed === undefined) problems.push('no chosen_seed');
    const finalPath = path.join('adventures', adventureId, 'art', `${subject.id}.webp`);
    if (!existsSync(finalPath)) problems.push(`missing final "${finalPath}"`);
    if (problems.length > 0) lines.push(`    - ${subject.id}: ${problems.join(', ')}`);
  }
  if (lines.length === 0) return [];
  return ['  strict-mode failures:', ...lines];
}

function validateOne(manifestPath: string, strict: boolean): ValidationOutcome {
  let manifest: ArtManifest;
  try {
    manifest = loadManifest(manifestPath);
  } catch (err) {
    return { ok: false, lines: [`  ${errorMessage(err)}`] };
  }

  const adventureDir = inferAdventureDir(manifestPath);
  const adventureId = path.basename(adventureDir);
  const auditResult = audit(manifestPath, adventureDir);

  const lines: string[] = [];
  let ok = true;

  if (auditResult.missing.length > 0) {
    ok = false;
    lines.push('  missing (module artId with no manifest subject):');
    for (const id of auditResult.missing) lines.push(`    - ${id}`);
  }
  if (auditResult.orphaned.length > 0) {
    ok = false;
    lines.push('  orphaned (manifest subject matching no module artId, not class "marquee"):');
    for (const id of auditResult.orphaned) lines.push(`    - ${id}`);
  }

  if (strict) {
    const strictLines = checkStrict(manifest, adventureId);
    if (strictLines.length > 0) {
      ok = false;
      lines.push(...strictLines);
    }
  }

  return { ok, lines };
}

function main(): void {
  const argv = process.argv.slice(2);
  const strict = argv.includes('--strict');
  const explicitTargets = argv.filter((arg) => arg !== '--strict');
  const targets = explicitTargets.length > 0 ? explicitTargets : discoverManifests();

  if (targets.length === 0) {
    console.log(`no art manifests found in ${ART_DIR}/ — nothing to validate`);
    return;
  }

  let allOk = true;
  for (const target of targets) {
    const { ok, lines } = validateOne(target, strict);
    allOk = allOk && ok;
    console.log(`${ok ? '✓' : '✗'} ${target}${strict ? ' (--strict)' : ''}`);
    for (const line of lines) console.log(line);
  }

  process.exitCode = allOk ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
