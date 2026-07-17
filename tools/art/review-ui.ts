import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadManifest, resolveSubjects, type ArtClass, type ResolvedSubject } from './build-request';

// tools/art/review-ui.ts — an INTERACTIVE curation page (design plan §4/§6;
// the static tools/art/contact-sheet.ts is the read-only sibling). One
// self-contained HTML page for the subjects in a manifest: click a seed to
// choose it, type a per-subject comment, then Copy/Download a verdicts JSON
// the orchestrator ingests directly — no more transcribing "subject: seed" by
// hand, and retry reasons ("too many lamps") travel with the pick.
//
// Verdicts JSON shape (what the buttons emit):
//   { "<subjectId>": { "chosen_seed": <int|null>, "comment": "<string>" }, ... }
// A subject with chosen_seed null but a comment is a RETRY request.
//
// Served over the same `python -m http.server` as the contact sheets, so
// candidate <img>s load by relative path. Everything (data + JS + CSS) is
// inlined; the page makes no network calls of its own and needs no build step.
//
// Usage:
//   npx tsx tools/art/review-ui.ts <manifest.json> \
//     [--candidates <dir>] [--out <dir>] [--class scene|item|creature|marquee] [--title <str>]

interface Candidate {
  seed: number;
  file: string;
}

interface SubjectData {
  id: string;
  cls: ArtClass;
  prompt: string;
  chosen: number | null;
  candidates: Candidate[];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every `<id>_s<seed>.png` on disk for `id`, sorted by seed. Missing dir is not an error. */
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

function buildSubjectData(
  subjects: readonly ResolvedSubject[],
  candidatesDir: string,
  outDir: string,
): SubjectData[] {
  return subjects.map((s) => ({
    id: s.id,
    cls: s.class,
    prompt: s.prompt,
    chosen: s.chosenSeed ?? null,
    candidates: candidatesFor(s.id, candidatesDir).map(({ seed, file }) => ({
      seed,
      // path relative to the page's own directory, so <img src> resolves over http.server
      file: path.relative(outDir, path.join(candidatesDir, file)),
    })),
  }));
}

// The page template. Data is injected as a JSON <script>; the client script is
// a plain string (no bundler). Display size = generation dims / 2, matching
// contact-sheet.ts's "delivered scale" placeholder until Phase 3 locks sizes.
function renderPage(title: string, data: SubjectData[], dims: Record<string, [number, number]>): string {
  const dataJson = JSON.stringify(data).replace(/</g, '\\u003c');
  const dimsJson = JSON.stringify(dims).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; background: #14141a; color: #e8e8ec; margin: 0; }
  header { position: sticky; top: 0; z-index: 10; background: #1c1c24; border-bottom: 1px solid #333;
           padding: 12px 20px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  header h1 { font-size: 1rem; font-weight: 600; margin: 0; }
  header .count { color: #9a9aa4; font-size: 0.9rem; }
  header .spacer { flex: 1; }
  button { font: inherit; background: #2d2d3a; color: #e8e8ec; border: 1px solid #444;
           border-radius: 6px; padding: 7px 14px; cursor: pointer; }
  button:hover { background: #3a3a4a; }
  button.primary { background: #2f6f4f; border-color: #3c8a63; }
  button.primary:hover { background: #37855e; }
  main { padding: 20px; }
  .subject { border-top: 1px solid #333; padding: 16px 0; scroll-margin-top: 64px; }
  .subject.decided { background: #14201a; }
  .subject.retry { background: #241717; }
  .subject h2 { margin: 0 0 4px; font-size: 1rem; }
  .subject h2 .tag { font-size: 0.72rem; color: #9a9aa4; font-weight: 400; margin-left: 8px; }
  .subject h2 .status { font-size: 0.75rem; margin-left: 8px; }
  .status.ok { color: #6f6; } .status.retry { color: #f88; }
  .prompt { color: #9a9aa4; font-size: 0.85rem; margin: 0 0 10px; max-width: 70em; }
  .cands { display: flex; flex-wrap: wrap; gap: 12px; }
  figure { margin: 0; cursor: pointer; border: 3px solid transparent; border-radius: 6px; padding: 3px; }
  figure:hover { border-color: #555; }
  figure.sel { border-color: #6f6; }
  figure img { display: block; background: #000; border-radius: 3px; }
  figcaption { font-size: 0.78rem; color: #aaa; text-align: center; margin-top: 3px; }
  figure.sel figcaption { color: #6f6; font-weight: 600; }
  .none { color: #f77; font-style: italic; }
  .row2 { display: flex; gap: 10px; margin-top: 10px; align-items: center; flex-wrap: wrap; }
  textarea { flex: 1; min-width: 260px; min-height: 34px; background: #0f0f14; color: #e8e8ec;
             border: 1px solid #444; border-radius: 6px; padding: 6px 9px; font: inherit; resize: vertical; }
  .clearbtn { font-size: 0.8rem; padding: 4px 10px; }
  #toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #2f6f4f;
           color: #fff; padding: 10px 18px; border-radius: 8px; opacity: 0; transition: opacity .2s;
           pointer-events: none; }
  #toast.show { opacity: 1; }
</style>
</head>
<body>
<header>
  <h1>${title}</h1>
  <span class="count" id="count"></span>
  <span class="spacer"></span>
  <button class="primary" id="copyBtn">Copy verdicts JSON</button>
  <button id="downloadBtn">Download JSON</button>
</header>
<main id="main"></main>
<div id="toast"></div>
<script type="application/json" id="data">${dataJson}</script>
<script type="application/json" id="dims">${dimsJson}</script>
<script>
(function () {
  var data = JSON.parse(document.getElementById('data').textContent);
  var dims = JSON.parse(document.getElementById('dims').textContent);
  var main = document.getElementById('main');
  // state[id] = { chosen: int|null, comment: string }
  var state = {};
  data.forEach(function (s) { state[s.id] = { chosen: s.chosen, comment: '' }; });

  function dispSize(cls) {
    var d = dims[cls] || [1024, 640];
    return [Math.round(d[0] / 2), Math.round(d[1] / 2)];
  }

  data.forEach(function (s) {
    var sz = dispSize(s.cls);
    var sec = document.createElement('section');
    sec.className = 'subject';
    sec.id = 'subj-' + s.id;

    var h2 = document.createElement('h2');
    h2.innerHTML = s.id + '<span class="tag">' + s.cls + '</span><span class="status" id="st-' + s.id + '"></span>';
    sec.appendChild(h2);

    var p = document.createElement('p');
    p.className = 'prompt';
    p.textContent = s.prompt || '(no prompt)';
    sec.appendChild(p);

    var cands = document.createElement('div');
    cands.className = 'cands';
    if (s.candidates.length === 0) {
      var none = document.createElement('p');
      none.className = 'none';
      none.textContent = 'no candidates rendered yet';
      cands.appendChild(none);
    } else {
      s.candidates.forEach(function (c) {
        var fig = document.createElement('figure');
        fig.dataset.seed = c.seed;
        if (state[s.id].chosen === c.seed) fig.classList.add('sel');
        var img = document.createElement('img');
        img.src = c.file; img.width = sz[0]; img.height = sz[1]; img.loading = 'lazy';
        img.alt = s.id + ' seed ' + c.seed;
        var cap = document.createElement('figcaption');
        cap.textContent = 'seed ' + c.seed;
        fig.appendChild(img); fig.appendChild(cap);
        fig.addEventListener('click', function () {
          // toggle: clicking the selected seed deselects it
          state[s.id].chosen = (state[s.id].chosen === c.seed) ? null : c.seed;
          Array.prototype.forEach.call(cands.children, function (ch) {
            if (ch.dataset) ch.classList.toggle('sel', Number(ch.dataset.seed) === state[s.id].chosen);
          });
          refresh(s.id);
        });
        cands.appendChild(fig);
      });
    }
    sec.appendChild(cands);

    var row = document.createElement('div');
    row.className = 'row2';
    var ta = document.createElement('textarea');
    ta.placeholder = 'comment / retry reason (e.g. "too many lamps", "should show X")';
    ta.addEventListener('input', function () { state[s.id].comment = ta.value; refresh(s.id); });
    var clr = document.createElement('button');
    clr.className = 'clearbtn'; clr.textContent = 'clear pick';
    clr.addEventListener('click', function () {
      state[s.id].chosen = null;
      Array.prototype.forEach.call(cands.children, function (ch) { if (ch.classList) ch.classList.remove('sel'); });
      refresh(s.id);
    });
    row.appendChild(ta); row.appendChild(clr);
    sec.appendChild(row);

    main.appendChild(sec);
  });

  function refresh(id) {
    var st = state[id];
    var sec = document.getElementById('subj-' + id);
    var badge = document.getElementById('st-' + id);
    sec.classList.remove('decided', 'retry');
    badge.className = 'status';
    if (st.chosen !== null) {
      sec.classList.add('decided'); badge.classList.add('ok');
      badge.textContent = '✓ seed ' + st.chosen;
    } else if (st.comment.trim()) {
      sec.classList.add('retry'); badge.classList.add('retry');
      badge.textContent = 'retry';
    } else {
      badge.textContent = '';
    }
    updateCount();
  }

  function updateCount() {
    var total = data.length, decided = 0, retry = 0;
    data.forEach(function (s) {
      var st = state[s.id];
      if (st.chosen !== null) decided++;
      else if (st.comment.trim()) retry++;
    });
    document.getElementById('count').textContent =
      decided + '/' + total + ' picked' + (retry ? ', ' + retry + ' retry' : '') +
      ', ' + (total - decided - retry) + ' undecided';
  }

  function verdicts() {
    var out = {};
    data.forEach(function (s) {
      var st = state[s.id];
      if (st.chosen !== null || st.comment.trim()) {
        out[s.id] = { chosen_seed: st.chosen, comment: st.comment.trim() };
      }
    });
    return JSON.stringify(out, null, 2);
  }

  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 1800);
  }

  document.getElementById('copyBtn').addEventListener('click', function () {
    var text = verdicts();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { toast('Verdicts copied — paste into chat'); },
        function () { fallbackCopy(text); }
      );
    } else { fallbackCopy(text); }
  });
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Verdicts copied — paste into chat'); }
    catch (e) { toast('Copy failed — use Download'); }
    document.body.removeChild(ta);
  }
  document.getElementById('downloadBtn').addEventListener('click', function () {
    var blob = new Blob([verdicts()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'verdicts.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    toast('Downloaded verdicts.json');
  });

  data.forEach(function (s) { refresh(s.id); });
})();
</script>
</body>
</html>
`;
}

interface Args {
  manifestPath: string;
  candidatesDir: string;
  outDir: string;
  classFilter: ArtClass | undefined;
  title: string | undefined;
}

function usage(): never {
  console.error(
    'usage: review-ui.ts <manifest.json> [--candidates <dir>] [--out <dir>] [--class <cls>] [--title <str>]',
  );
  process.exit(1);
}

const ART_CLASS_SET = new Set(['scene', 'item', 'creature', 'marquee']);
function isArtClass(v: string): v is ArtClass {
  return ART_CLASS_SET.has(v);
}

function parseArgs(argv: string[]): Args {
  const [manifestPath, ...rest] = argv;
  if (manifestPath === undefined) usage();
  let candidatesDir = 'dev/art-candidates';
  let outDir: string | undefined;
  let classFilter: ArtClass | undefined;
  let title: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--candidates') {
      const v = rest[++i];
      if (v === undefined) usage();
      candidatesDir = v;
    } else if (a === '--out') {
      const v = rest[++i];
      if (v === undefined) usage();
      outDir = v;
    } else if (a === '--class') {
      const v = rest[++i];
      if (v === undefined || !isArtClass(v)) usage();
      classFilter = v;
    } else if (a === '--title') {
      const v = rest[++i];
      if (v === undefined) usage();
      title = v;
    } else {
      usage();
    }
  }
  return { manifestPath, candidatesDir, outDir: outDir ?? candidatesDir, classFilter, title };
}

function main(): void {
  const { manifestPath, candidatesDir, outDir, classFilter, title } = parseArgs(process.argv.slice(2));
  const manifest = loadManifest(manifestPath);
  let subjects = resolveSubjects(manifest);
  if (classFilter !== undefined) subjects = subjects.filter((s) => s.class === classFilter);
  if (subjects.length === 0) {
    console.log('no subjects to render (check --class filter)');
    return;
  }

  // dims per class, for display sizing — read from the class manifest if present, else a default
  const dims: Record<string, [number, number]> = {};
  for (const s of subjects) dims[s.class] = [s.dims[0], s.dims[1]];

  mkdirSync(outDir, { recursive: true });
  const data = buildSubjectData(subjects, candidatesDir, outDir);
  const pageTitle = title ?? `Review — ${classFilter ?? 'all'} (${subjects.length})`;
  const html = renderPage(pageTitle, data, dims);
  const outPath = path.join(outDir, `review${classFilter ? '-' + classFilter : ''}.html`);
  writeFileSync(outPath, html, 'utf8');
  const decided = data.filter((d) => d.chosen !== null).length;
  console.log(`${outPath} — ${data.length} subjects (${decided} already chosen)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
