import { readFileSync } from 'node:fs';
import path from 'node:path';

// Expand an art manifest into a host_gen.py request file (CLAUDE.md's Art
// Pipeline). Manifest is the committed source of truth; the request is a
// derived, throwaway build artifact.
//
//   npx tsx tools/art/build-request.ts dev/art/test-cave.json > /tmp/req.json
//   distrobox-host-exec ~/pixelart-venv/bin/python tools/art/host_gen.py /tmp/req.json
//
// Two modes, which is the whole point of `chosen_seed`:
//   * no `chosen_seed` -> render every candidate seed, for contact-sheet review
//   * `chosen_seed: N` -> render only N, so a re-run after picking is one image
//
// The style suffix is appended here rather than repeated per subject, so a
// change to the medium is one edit and every subject moves together. That is
// the property that keeps a set looking like a set.

interface Subject {
  prompt: string;
  seeds?: number[];
  chosen_seed?: number;
}

interface Manifest {
  style: string;
  gen_w: number;
  gen_h: number;
  seeds: number[];
  subjects: Record<string, Subject>;
}

const [manifestPath, outDirArg] = process.argv.slice(2);
if (manifestPath === undefined) {
  console.error('usage: build-request.ts <manifest.json> [outDir]');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
const outDir = path.resolve(outDirArg ?? 'dev/art-candidates');

const entries = Object.entries(manifest.subjects).flatMap(([id, subject]) => {
  const seeds = subject.chosen_seed !== undefined ? [subject.chosen_seed] : (subject.seeds ?? manifest.seeds);
  return seeds.map((seed) => ({
    name: `${id}_s${seed}`,
    prompt: subject.prompt + manifest.style,
    seed,
    gen_w: manifest.gen_w,
    gen_h: manifest.gen_h,
    out: path.join(outDir, `${id}_s${seed}.png`),
  }));
});

process.stdout.write(JSON.stringify({ entries }, null, 2));
console.error(
  `${Object.keys(manifest.subjects).length} subjects -> ${entries.length} renders -> ${outDir}`,
);
