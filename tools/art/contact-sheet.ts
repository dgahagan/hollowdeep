import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ART_CLASSES,
  loadManifest,
  resolveSubjects,
  type ArtClass,
  type ResolvedSubject,
} from './build-request';

// tools/art/contact-sheet.ts — manifest + a candidates directory -> one
// static HTML page per art class, for human curation (design plan §4/§6;
// art-implementation-plan T1/T3-T6).
//
// Renders EVERY candidate PNG found on disk for a subject (not just its
// `chosen_seed`), because the whole point of a contact sheet is choosing
// between seeds. A subject with no `chosen_seed` yet is marked PENDING and
// sorts first within its section's styling (a red-tinted background), so a
// reviewer can't miss what still needs a verdict; subjects that already have
// a chosen seed still render, with that seed marked "chosen" — useful when
// revisiting a NEEDS-HUMAN retry.
//
// DELIVERED SCALE: standing rule 5 (art-implementation-plan) says verdicts
// come from delivered scale, never raw. Phase 3 has not locked the scene
// panel's real display size (design plan §7), so this uses generation
// dims / 2 as a placeholder "delivered" size — CSS width/height on the
// <img>, not a resize of the file. When Phase 3's real numbers land, only
// this ratio needs to change, not the rest of the tool.
//
// Usage:
//   npx tsx tools/art/contact-sheet.ts <manifest.json> \
//     [--candidates <dir>] [--out <dir>] [--class scene|item|creature|marquee]
//
// `--candidates` defaults to dev/art-candidates/; `--out` defaults to the
// candidates dir; `--class` restricts to one class (default: one sheet per
// class present in the manifest).

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isArtClass(value: string): value is ArtClass {
  return (ART_CLASSES as readonly string[]).includes(value);
}

interface Candidate {
  seed: number;
  file: string;
}

/** Every `<id>_s<seed>.png` found in `candidatesDir` for `id`, sorted by seed. Missing dir -> no candidates, not an error (nothing generated yet is a legitimate state). */
function candidatesFor(id: string, candidatesDir: string): Candidate[] {
  let entries: string[];
  try {
    entries = readdirSync(candidatesDir);
  } catch {
    return [];
  }
  const re = new RegExp(`^${escapeRegExp(id)}_s(\\d+)\\.png$`);
  const matches: Candidate[] = [];
  for (const entry of entries) {
    const m = re.exec(entry);
    if (m?.[1] !== undefined) matches.push({ seed: Number(m[1]), file: entry });
  }
  matches.sort((a, b) => a.seed - b.seed);
  return matches;
}

function renderSubjectSection(subject: ResolvedSubject, candidatesDir: string, outDir: string): string {
  const candidates = candidatesFor(subject.id, candidatesDir);
  const pending = subject.chosenSeed === undefined;
  const [w, h] = subject.dims;
  const dispW = Math.round(w / 2);
  const dispH = Math.round(h / 2);

  const body =
    candidates.length === 0
      ? '<p class="none">no candidates rendered yet</p>'
      : `<div class="candidates">${candidates
          .map(({ seed, file }) => {
            const src = path.relative(outDir, path.join(candidatesDir, file));
            const chosen = subject.chosenSeed === seed;
            return `<figure class="${chosen ? 'chosen' : ''}">
    <img src="${escapeHtml(src)}" width="${dispW}" height="${dispH}" alt="${escapeHtml(subject.id)} seed ${seed}" loading="lazy">
    <figcaption>${escapeHtml(subject.id)} &middot; seed ${seed}${chosen ? ' &#9733; chosen' : ''}</figcaption>
  </figure>`;
          })
          .join('\n')}</div>`;

  const promptText = subject.prompt.length > 0 ? escapeHtml(subject.prompt) : '(prompt not yet written)';

  return `<section class="subject${pending ? ' pending' : ''}">
  <h2>${escapeHtml(subject.id)}${pending ? ' — PENDING (no chosen_seed)' : ''}</h2>
  <p class="prompt">${promptText}</p>
  ${body}
</section>`;
}

function renderSheet(className: ArtClass, subjects: readonly ResolvedSubject[], candidatesDir: string, outDir: string): string {
  const sections = subjects.map((subject) => renderSubjectSection(subject, candidatesDir, outDir)).join('\n');
  const pendingCount = subjects.filter((s) => s.chosenSeed === undefined).length;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Contact sheet — ${className}</title>
<style>
  body { font-family: system-ui, sans-serif; background: #14141a; color: #e8e8ec; margin: 0; padding: 24px; }
  h1 { font-size: 1.2rem; font-weight: 600; }
  h1 small { color: #9a9aa4; font-weight: 400; }
  .subject { border-top: 1px solid #333; padding: 16px 0; }
  .subject.pending { background: #2a1414; }
  .subject h2 { margin: 0 0 4px; font-size: 1rem; }
  .prompt { color: #9a9aa4; font-size: 0.85rem; margin: 0 0 10px; max-width: 60em; }
  .candidates { display: flex; flex-wrap: wrap; gap: 12px; }
  figure { margin: 0; }
  figure img { display: block; background: #000; }
  figcaption { font-size: 0.78rem; color: #aaa; text-align: center; margin-top: 2px; }
  .chosen figcaption { color: #6f6; font-weight: 600; }
  .none { color: #f77; font-style: italic; }
</style>
</head>
<body>
<h1>Contact sheet — ${className} <small>(${subjects.length} subjects, ${pendingCount} pending)</small></h1>
<p class="prompt">Images at delivered scale (generation dims &divide; 2 — a placeholder until Phase 3 locks the real display size; see tools/art/contact-sheet.ts).</p>
${sections}
</body>
</html>
`;
}

interface Args {
  manifestPath: string;
  candidatesDir: string;
  outDir: string;
  classFilter: ArtClass | undefined;
}

function usage(): never {
  console.error(
    'usage: contact-sheet.ts <manifest.json> [--candidates <dir>] [--out <dir>] [--class scene|item|creature|marquee]',
  );
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const [manifestPath, ...rest] = argv;
  if (manifestPath === undefined) usage();

  let candidatesDir = 'dev/art-candidates';
  let outDirArg: string | undefined;
  let classFilter: ArtClass | undefined;

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
    } else if (arg === '--class') {
      const value = rest[++i];
      if (value === undefined || !isArtClass(value)) usage();
      classFilter = value;
    } else {
      usage();
    }
  }

  return { manifestPath, candidatesDir, outDir: outDirArg ?? candidatesDir, classFilter };
}

function main(): void {
  const { manifestPath, candidatesDir, outDir, classFilter } = parseArgs(process.argv.slice(2));
  const manifest = loadManifest(manifestPath);
  const subjects = resolveSubjects(manifest);

  const byClass = new Map<ArtClass, ResolvedSubject[]>();
  for (const subject of subjects) {
    if (classFilter !== undefined && subject.class !== classFilter) continue;
    const list = byClass.get(subject.class) ?? [];
    list.push(subject);
    byClass.set(subject.class, list);
  }

  if (byClass.size === 0) {
    console.log('no subjects to render (check --class filter)');
    return;
  }

  mkdirSync(outDir, { recursive: true });

  for (const [className, classSubjects] of byClass) {
    const html = renderSheet(className, classSubjects, candidatesDir, outDir);
    const outPath = path.join(outDir, `contact-sheet-${className}.html`);
    writeFileSync(outPath, html, 'utf8');
    const pending = classSubjects.filter((s) => s.chosenSeed === undefined).length;
    console.log(`${outPath} — ${classSubjects.length} subjects (${pending} pending)`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
