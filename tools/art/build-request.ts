import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

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
//
// Two manifest DIALECTS (design plan §5), both handled by this file:
//
//   * FLAT — test-cave's shape, frozen: one global `style` string and one
//     `gen_w`/`gen_h` pair for the whole manifest. Every subject is the same
//     "class" as far as generation is concerned.
//   * CLASS — hollowdeep's shape: `styles` and `dims` are maps keyed by
//     art class (`scene`/`item`/`creature`/`marquee`), and each subject
//     declares its own `class` to pick which suffix/dims it gets (with an
//     optional per-subject `dims` override).
//
// `parseManifest`/`loadManifest` dispatch on shape (a manifest either has
// `style` or `styles` — the two dialects share no top-level key, and both
// schemas are `strictObject`, so anything that fits neither shape fails
// loudly). `resolveSubjects` turns either dialect into the same dialect-
// independent `ResolvedSubject[]`, which every other tool in `tools/art/`
// (audit, contact-sheet, optimize) builds on instead of re-deriving the
// dialect logic. This file's own CLI output for test-cave is unchanged byte-
// for-byte by this extension — see tests/manual check in the T1 report.

export const ART_CLASSES = ['scene', 'item', 'creature', 'marquee'] as const;
export type ArtClass = (typeof ART_CLASSES)[number];

const zDims = z.tuple([z.number().int().positive(), z.number().int().positive()]);

// ─────────────────────────────────────────────────────────────────────────
// Flat dialect — test-cave, frozen. Do not add fields here for hollowdeep's
// sake; extend the class dialect instead.
// ─────────────────────────────────────────────────────────────────────────

const zFlatSubject = z.strictObject({
  prompt: z.string(),
  seeds: z.array(z.number().int()).optional(),
  chosen_seed: z.number().int().optional(),
});

const zFlatManifest = z.strictObject({
  _readme: z.array(z.string()).optional(),
  style: z.string(),
  gen_w: z.number().int().positive(),
  gen_h: z.number().int().positive(),
  seeds: z.array(z.number().int()),
  subjects: z.record(z.string(), zFlatSubject),
});

export type FlatManifest = z.infer<typeof zFlatManifest>;
export type FlatSubject = FlatManifest['subjects'][string];

// ─────────────────────────────────────────────────────────────────────────
// Class dialect — hollowdeep (design plan §5).
// ─────────────────────────────────────────────────────────────────────────

const zClassSubject = z.strictObject({
  class: z.enum(ART_CLASSES),
  prompt: z.string(),
  seeds: z.array(z.number().int()).optional(),
  chosen_seed: z.number().int().optional(),
  dims: zDims.optional(),
  notes: z.string().optional(),
});

const zClassManifest = z.strictObject({
  _readme: z.array(z.string()).optional(),
  styles: z.record(z.string(), z.string()),
  dims: z.record(z.string(), zDims),
  /**
   * Optional, same shape as `dims`, keyed by class. When a class has an
   * entry here, `optimize.ts` resizes that class's finals down to it instead
   * of shipping at generation size (see optimize.ts's DELIVERED DIMS note).
   * Absent by default — Phase 3 has not locked real display sizes yet
   * (design plan §7).
   */
  delivered: z.record(z.string(), zDims).optional(),
  seeds: z.array(z.number().int()),
  subjects: z.record(z.string(), zClassSubject),
});

export type ClassManifest = z.infer<typeof zClassManifest>;
export type ClassSubject = ClassManifest['subjects'][string];

export type ArtManifest = FlatManifest | ClassManifest;

/** Type guard: the two dialects share no top-level key, so `styles` alone tells them apart. */
export function isClassManifest(manifest: ArtManifest): manifest is ClassManifest {
  return 'styles' in manifest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function formatZodError(error: z.ZodError): string {
  return error.issues.map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`).join('\n');
}

/**
 * Parses raw JSON into whichever dialect it is, by dispatching on the
 * presence of `styles` (class dialect) vs its absence (flat dialect). Both
 * schemas are `strictObject`, so a manifest that is neither shape fails with
 * the zod errors for whichever dialect its `styles` key selected.
 */
export function parseManifest(raw: unknown, sourceLabel = '<manifest>'): ArtManifest {
  if (isRecord(raw) && 'styles' in raw) {
    const result = zClassManifest.safeParse(raw);
    if (!result.success) {
      throw new Error(
        `${sourceLabel}: does not match the class-dialect manifest shape:\n${formatZodError(result.error)}`,
      );
    }
    return result.data;
  }
  const result = zFlatManifest.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `${sourceLabel}: does not match the flat-dialect manifest shape:\n${formatZodError(result.error)}`,
    );
  }
  return result.data;
}

export function loadManifest(manifestPath: string): ArtManifest {
  const raw: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return parseManifest(raw, manifestPath);
}

/**
 * A subject resolved to dialect-independent facts. Every tool downstream of
 * the manifest (audit, contact-sheet, optimize) builds on this instead of
 * re-deriving flat-vs-class logic.
 */
export interface ResolvedSubject {
  id: string;
  /**
   * Flat-dialect subjects carry no `class` field at all (test-cave predates
   * the notion). They default to `'scene'` here purely for grouping/display
   * in tools like contact-sheet — it asserts nothing about the subject.
   */
  class: ArtClass;
  prompt: string;
  /** `prompt` + the class's style suffix — exactly what the generator sees. */
  fullPrompt: string;
  dims: readonly [number, number];
  /** Seeds to actually render: `[chosen_seed]` once chosen, else the subject's own list, else the manifest default. */
  renderSeeds: readonly number[];
  /** The subject's own declared seed list, if any (undefined does not mean "no seeds render" — see `renderSeeds`). */
  declaredSeeds: readonly number[] | undefined;
  chosenSeed: number | undefined;
}

function resolveFlatSubject(id: string, subject: FlatSubject, manifest: FlatManifest): ResolvedSubject {
  const renderSeeds = subject.chosen_seed !== undefined ? [subject.chosen_seed] : (subject.seeds ?? manifest.seeds);
  return {
    id,
    class: 'scene',
    prompt: subject.prompt,
    fullPrompt: subject.prompt + manifest.style,
    dims: [manifest.gen_w, manifest.gen_h],
    renderSeeds,
    declaredSeeds: subject.seeds,
    chosenSeed: subject.chosen_seed,
  };
}

function resolveClassSubject(id: string, subject: ClassSubject, manifest: ClassManifest): ResolvedSubject {
  const dims = subject.dims ?? manifest.dims[subject.class];
  if (dims === undefined) {
    throw new Error(
      `subject "${id}": class "${subject.class}" has no entry in manifest.dims and no per-subject dims override`,
    );
  }
  const styleSuffix = manifest.styles[subject.class];
  if (styleSuffix === undefined) {
    throw new Error(`subject "${id}": class "${subject.class}" has no entry in manifest.styles`);
  }
  const renderSeeds = subject.chosen_seed !== undefined ? [subject.chosen_seed] : (subject.seeds ?? manifest.seeds);
  return {
    id,
    class: subject.class,
    prompt: subject.prompt,
    fullPrompt: subject.prompt + styleSuffix,
    dims,
    renderSeeds,
    declaredSeeds: subject.seeds,
    chosenSeed: subject.chosen_seed,
  };
}

/** Expands every subject in manifest-declaration order (object key order), regardless of dialect. */
export function resolveSubjects(manifest: ArtManifest): ResolvedSubject[] {
  if (isClassManifest(manifest)) {
    return Object.entries(manifest.subjects).map(([id, subject]) => resolveClassSubject(id, subject, manifest));
  }
  return Object.entries(manifest.subjects).map(([id, subject]) => resolveFlatSubject(id, subject, manifest));
}

/** One `host_gen.py` request entry. */
export interface RequestEntry {
  name: string;
  prompt: string;
  seed: number;
  gen_w: number;
  gen_h: number;
  out: string;
}

/** Expands resolved subjects into request entries, writing candidates under `outDir`. */
export function buildEntries(subjects: readonly ResolvedSubject[], outDir: string): RequestEntry[] {
  return subjects.flatMap((subject) =>
    subject.renderSeeds.map((seed) => ({
      name: `${subject.id}_s${seed}`,
      prompt: subject.fullPrompt,
      seed,
      gen_w: subject.dims[0],
      gen_h: subject.dims[1],
      out: path.join(outDir, `${subject.id}_s${seed}.png`),
    })),
  );
}

function main(): void {
  const [manifestPath, outDirArg] = process.argv.slice(2);
  if (manifestPath === undefined) {
    console.error('usage: build-request.ts <manifest.json> [outDir]');
    process.exit(1);
  }

  const manifest = loadManifest(manifestPath);
  const outDir = path.resolve(outDirArg ?? 'dev/art-candidates');
  const subjects = resolveSubjects(manifest);
  const entries = buildEntries(subjects, outDir);

  process.stdout.write(JSON.stringify({ entries }, null, 2));
  console.error(`${subjects.length} subjects -> ${entries.length} renders -> ${outDir}`);
}

// Only run the CLI when this file is the entry point, not when imported by
// audit.ts/contact-sheet.ts/optimize.ts/validate-art.ts.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
