# Art Pipeline

How this repo's painterly art gets made, reviewed, and shipped. Written after
Phase B actually ran (art-implementation-plan T1–T7, 2026-07-17), so it
describes the pipeline as built, not as imagined. The design rationale lives
in [`art-plan.md`](art-plan.md); the verdict history in
`art-review/art-review.md`; the prompting lessons in `dev/art/style.md`.

## The one-paragraph version

A committed **art manifest** (`dev/art/<adventure>.json`) is the source of
truth: per-subject prose prompts, a locked style suffix per art class, seed
lists, and — once a human has judged contact sheets — a `chosen_seed` per
subject. Tools under `tools/art/` expand the manifest into a render request,
run it on the host GPU, build review pages, and encode the winners to WebP
under `adventures/<id>/art/`. Everything is deterministic from the manifest:
same prompt + seed + dims → the same PNG, byte for byte (verified at ship
time — three re-renders byte-identical to their months-of-curation
candidates).

## The pieces

| Tool | Does |
|---|---|
| `tools/art/build-request.ts` | Manifest → `host_gen.py` request JSON. Also the shared library (`loadManifest`/`resolveSubjects`) every other tool builds on. |
| `tools/art/host_gen.py` | The FLUX driver, run **on the host** via the distrobox bridge. Idempotent: skips any output that already exists (`--force` overrides). |
| `tools/art/audit.ts` | Diffs a manifest against every artId its adventure references, plus the 11 marquee ids. Missing or orphaned entries fail with names. |
| `tools/art/contact-sheet.ts` | Read-only HTML contact sheets at delivered scale. |
| `tools/art/review-ui.ts` | The interactive curation page: click a seed to pick it, comment per subject, export a verdicts JSON the orchestrator ingests directly. |
| `tools/art/optimize.ts` | For every subject with a `chosen_seed`: resize to delivered dims, encode WebP (sharp, quality 82 default, per-subject `quality` override), enforce the 150 KB scene budget by failing loudly. |
| `tools/art/validate-art.ts` | `npm run validate:art`. Default mode tolerates in-production manifests; `--strict` (in `npm run gate` since the T7 flip) requires every subject to have a prompt, a seed pool, a `chosen_seed`, and its final on disk. |

## The manifest, two dialects

`build-request.ts` parses both and every other tool consumes its
dialect-independent `ResolvedSubject[]`:

- **Flat** (`dev/art/test-cave.json`, frozen): one global `style` string and
  one `gen_w`/`gen_h` for the whole file. Do not extend it.
- **Class** (`dev/art/hollowdeep.json`): `styles` and `dims` are maps keyed
  by art class — `scene` (1024×640), `item` (640×640), `creature` (640×800),
  `marquee` (1344×768) — and each subject declares its `class`, with optional
  per-subject `dims`, `quality`, and `notes`. An optional top-level
  `delivered` map lets `optimize.ts` re-emit smaller finals later without
  re-curation (unset until Phase 3 locks real display sizes).

Candidate seeds are Fibonacci-ish by convention: `[1, 2, 3, 5, 8, 13]`.
`chosen_seed` flips a subject from "render all candidates" to "render exactly
one" — that property is the whole regeneration story.

## The bridge

Rendering happens on the host RTX 5080, reached from the distrobox:

```bash
npx tsx tools/art/build-request.ts dev/art/hollowdeep.json > /tmp/req.json
distrobox-host-exec ~/pixelart-venv/bin/python tools/art/host_gen.py /tmp/req.json
```

FLUX.2-klein-4B, 8 steps, ~11 s per 1344×768 render (smaller dims faster).
`host_gen.py` was rebuilt for this repo (the bards-tale-clone original had
been lost); it keeps the same request-file contract. Because it skips
existing outputs, the standard retry loop is: edit the prompt in the
manifest, `rm` the stale candidates, re-run the full request — only the
missing files render.

## The process that shipped Hollowdeep (and would ship the next one)

1. **Skeleton + audit** (T1): enumerate every artId the module references —
   `audit.ts` derives the list; hand-entry is how ids drift — plus the 11
   marquees. Empty prompts, no seeds chosen. Default-mode `validate:art`
   keeps the gate green throughout production.
2. **Prompts** (T2): one prose paragraph per subject, derived from the
   module's own shipped `full`/`brief` text. The rules are
   `dev/art/style.md` and they are load-bearing — prose sentences for the
   Qwen3 encoder, the observation never the conclusion, no style language
   (that's the suffix's job).
3. **Style lock** (T3): 3–5 suffix candidates × 6 probe subjects × 6 seeds,
   contact sheets at delivered scale, **human picks**. The winning suffix is
   recorded verbatim per class and frozen — editing it afterwards reopens
   every finaled subject.
4. **Generate + curate** (T4–T6): render all candidates, serve
   `review-ui.ts` output over `python3 -m http.server` from
   `dev/art-candidates/`, and iterate rounds with the human: click-picked
   seeds land in the manifest; comments on unpicked subjects drive prompt
   retries (delete stale PNGs, regenerate, re-review). Every round's
   verdicts — including rejections and why — append to
   `art-review/art-review.md`; retry rationale travels in manifest `notes`.
5. **The atomic flip** (T7): `optimize.ts` emits all finals, placeholder art
   is deleted, `manifest.artFormat` flips, `--strict` joins the gate — one
   commit, so a partial swap is never committable. Determinism spot-check
   and an in-browser smoke (art renders; dark rooms still show no picture)
   close it out.

Raw candidates never commit (`dev/art-candidates/` is gitignored, ~800 KB
each, reproducible). Only the manifest, the review log, and the optimized
finals do.

## Regenerating

- **One subject, same art:** its `chosen_seed` makes the request a single
  render; `host_gen.py --force` if the candidate still exists.
- **One subject, different art:** edit the prompt, delete its candidates,
  re-render, re-review — a `chosen_seed` is a human decision, so a changed
  prompt sends the subject back through review.
- **Smaller finals later:** set `delivered` dims in the manifest and re-run
  `optimize.ts` — re-encoding is cheap and needs no re-curation.
- **Budget failures:** `optimize.ts` refuses loudly. The recorded fix is a
  per-subject `quality` step-down in the manifest with a note (precedent:
  `adit-mouth`, 152.8 KB at q82 → 138.0 KB at q80).

## What curation taught us

The condensed lessons live in `dev/art/style.md` §1–§6; the two that repaid
their cost most:

- **Light the scene from the viewpoint, not in it.** Dark scenes name the
  lamp only as an off-frame source ("lit from just outside the frame, as if
  from a lamp held at the viewpoint... no lamp, hand, or figure appears").
- **Trigger nouns beat instructions.** When an object keeps rendering wrong,
  stop naming it and describe only what the viewer sees ("a small warm glow
  sinking away", eyeshine instead of any animal noun). Negations barely
  register; a noun's training prior outvotes the sentence around it.
