import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { inferAdventureDir } from './audit';
import {
  isClassManifest,
  loadManifest,
  resolveSubjects,
  type ArtClass,
  type ArtManifest,
  type ResolvedSubject,
} from './build-request';

// tools/art/optimize.ts — for every subject with a `chosen_seed`, resize (if
// needed) and encode the raw candidate to WebP, writing finals into an
// adventure's art/ directory (design plan §5/§6/§8; art-implementation-plan
// T1/T7).
//
// DELIVERED DIMS — the decision this file makes concrete: the manifest's
// `dims` are GENERATION dims, and design plan §5 says delivered files are
// downscaled to "<= 2x their largest on-screen display size", a number Phase
// 3 has not locked yet (§7's one coordination point; cross-task note 6). So
// by default this emits at the manifest dims AS-IS — no resize, generation
// size ships as delivered size, generously oversized until Phase 3's real
// numbers exist. A manifest MAY add an optional top-level `delivered` map
// (same shape as `dims`, keyed by class) to opt a class into resizing before
// re-curation is needed; when present for a subject's class, that becomes
// the encode target instead. This keeps "ship smaller later" a re-run of
// this tool against the same manifest + raws, not a re-decision (design plan
// §7).
//
// Budget: every `scene`-class output over 150 KB (FR-4.3) fails the run,
// listing every offending file and its size — quality step-down is a
// decision for a human to make and record, never a silent retry loop here.
//
// Usage:
//   npx tsx tools/art/optimize.ts <manifest.json> \
//     [--candidates <dir>] [--out <dir>] [--subjects id,id,...]
//
// `--out` defaults to adventures/<manifest's basename>/art — pass a temp dir
// to prove the pipeline without touching committed art.

const SCENE_BUDGET_BYTES = 150 * 1024; // FR-4.3
const WEBP_QUALITY = 82; // one fixed pass; see budget note above

function deliveredDims(manifest: ArtManifest, subject: ResolvedSubject): readonly [number, number] {
  if (isClassManifest(manifest)) {
    const delivered = manifest.delivered?.[subject.class];
    if (delivered !== undefined) return delivered;
  }
  return subject.dims;
}

interface Args {
  manifestPath: string;
  candidatesDir: string;
  outDir: string;
  subjectsFilter: Set<string> | undefined;
}

function usage(): never {
  console.error(
    'usage: optimize.ts <manifest.json> [--candidates <dir>] [--out <dir>] [--subjects id,id,...]',
  );
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const [manifestPath, ...rest] = argv;
  if (manifestPath === undefined) usage();

  let candidatesDir = 'dev/art-candidates';
  let outDirArg: string | undefined;
  let subjectsFilter: Set<string> | undefined;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--candidates') {
      const value = rest[++i];
      if (value === undefined) usage();
      candidatesDir = value;
    } else if (arg === '--out') {
      const value = rest[++i];
      if (value === undefined) usage();
      outDirArg = value;
    } else if (arg === '--subjects') {
      const value = rest[++i];
      if (value === undefined) usage();
      subjectsFilter = new Set(
        value
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      );
    } else {
      usage();
    }
  }

  return {
    manifestPath,
    candidatesDir,
    outDir: outDirArg ?? path.join(inferAdventureDir(manifestPath), 'art'),
    subjectsFilter,
  };
}

interface OptimizedResult {
  id: string;
  artClass: ArtClass;
  bytes: number;
  outPath: string;
}

async function optimizeSubject(
  subject: ResolvedSubject,
  seed: number,
  manifest: ArtManifest,
  candidatesDir: string,
  outDir: string,
): Promise<OptimizedResult | { missing: string }> {
  const src = path.join(candidatesDir, `${subject.id}_s${seed}.png`);
  if (!existsSync(src)) return { missing: src };

  const target = deliveredDims(manifest, subject);
  const needsResize = target[0] !== subject.dims[0] || target[1] !== subject.dims[1];
  let pipeline = sharp(src);
  if (needsResize) pipeline = pipeline.resize(target[0], target[1], { fit: 'cover' });

  const buffer = await pipeline.webp({ quality: subject.quality ?? WEBP_QUALITY }).toBuffer();
  const outPath = path.join(outDir, `${subject.id}.webp`);
  writeFileSync(outPath, buffer);

  return { id: subject.id, artClass: subject.class, bytes: buffer.length, outPath };
}

function isMissing(result: OptimizedResult | { missing: string }): result is { missing: string } {
  return 'missing' in result;
}

async function main(): Promise<void> {
  const { manifestPath, candidatesDir, outDir, subjectsFilter } = parseArgs(process.argv.slice(2));
  const manifest = loadManifest(manifestPath);
  const subjects = resolveSubjects(manifest).filter(
    (s) => s.chosenSeed !== undefined && (subjectsFilter === undefined || subjectsFilter.has(s.id)),
  );

  if (subjects.length === 0) {
    console.log('no subjects with a chosen_seed to optimize' + (subjectsFilter ? ' matching --subjects' : ''));
    return;
  }

  mkdirSync(outDir, { recursive: true });

  const results: OptimizedResult[] = [];
  const missing: string[] = [];

  for (const subject of subjects) {
    const seed = subject.chosenSeed;
    if (seed === undefined) continue; // filtered above; narrows for TS
    const result = await optimizeSubject(subject, seed, manifest, candidatesDir, outDir);
    if (isMissing(result)) {
      missing.push(result.missing);
    } else {
      results.push(result);
    }
  }

  console.log(`optimized ${results.length}/${subjects.length} subject(s) -> ${outDir}`);
  for (const r of results) {
    console.log(`  ${r.id} (${r.artClass}) — ${(r.bytes / 1024).toFixed(1)} KB -> ${r.outPath}`);
  }

  let failed = false;

  if (missing.length > 0) {
    failed = true;
    console.error('\nmissing raw candidates for chosen seeds (generate them first):');
    for (const m of missing) console.error(`  ${m}`);
  }

  const overBudget = results.filter((r) => r.artClass === 'scene' && r.bytes > SCENE_BUDGET_BYTES);
  if (overBudget.length > 0) {
    failed = true;
    console.error(`\nscene budget exceeded (> ${(SCENE_BUDGET_BYTES / 1024).toFixed(0)} KB):`);
    for (const r of overBudget) console.error(`  ${r.id} — ${(r.bytes / 1024).toFixed(1)} KB (${r.outPath})`);
  }

  process.exitCode = failed ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
