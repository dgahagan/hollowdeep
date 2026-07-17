# Art Implementation Plan — Phase B Production

**Status:** READY (2026-07-17)

Execution plan for [`docs/art-plan.md`](art-plan.md) (the WHAT/WHY); rules
live in [`docs/orchestration-playbook.md`](orchestration-playbook.md).

This is a **production plan with human checkpoints**: unlike the content
plans, three tasks (T3–T6) cannot complete without the human judging contact
sheets — the orchestrator generates, presents, **stops and waits for
verdicts**, records them, and only then commits. Budget wall-clock for those
sessions accordingly. Everything the GPU does happens on the host via the
proven bridge (`distrobox-host-exec ~/pixelart-venv/bin/python
tools/art/host_gen.py REQUEST.json`); if the bridge has rotted since
test-cave's production run (`25249c5`), that is a stop-and-report, not a
thing to debug silently.

---

## Kickoff

A fresh Opus session should execute this with:

```
/run-plan docs/art-implementation-plan.md
```

If starting cold: read [`docs/art-plan.md`](art-plan.md) (§4 style process,
§5 manifest shape, §9 resolved decisions), `dev/art/style.md` (the prompting
lessons — every prompt written in this plan obeys them), `dev/art/
test-cave.json` (the manifest precedent and its proven suffix),
[`docs/orchestration-playbook.md`](orchestration-playbook.md), and this file.
Then execute the graph in order. The Progress Tracker at the bottom is the
source of truth for resuming.

## Scope & branch

**Branch:** `feat/art`, from `main`.

**In scope:** design plan §2–§8 — completing the toolchain (audit,
contact-sheet, optimize, `validate:art`), the Hollowdeep manifest with all
~106 subjects, style-suffix lock, full generation + curation, the atomic
WebP integration, and docs closeout.

### Deferred / out of scope

| Item | Reason |
|---|---|
| test-cave art in any form | Done and frozen (`25249c5`; design plan decision 4 as corrected) |
| Wiring marquee art into screens (title/endings/death modal) | Phase 3 UI plan; marquees land committed-but-unreferenced (design plan §7/§9.4) |
| UI accents / textures | Phase 3, CSS/procedural (design plan §3) |
| AVIF, fallbacks, `<picture>` work | WebP-only decision (design plan §9.2) |
| Driver changes (`host_gen.py`) | Production-proven; touch only if a task hits a real defect, and report it |

## Standing rules (apply to every task)

1. **The gate stays green at every commit.** Hollowdeep keeps its placeholder
   SVGs and `artFormat: "svg"` until T7's single atomic integration commit —
   the validator's `missing-art-file` check makes a partial swap
   uncommittable, by design.
2. **Raw candidates are never committed.** They render to `dev/art-candidates/`
   (gitignored, ~800 KB each). Only optimized finals under
   `adventures/hollowdeep/art/` are committed, in T7.
3. **Every prompt obeys `dev/art/style.md`:** prose sentences (Qwen3 encoder),
   the medium stated physically once, *the observation and never the
   conclusion*. Prompts derive from the module's own shipped prose — the
   narrator already did the observing.
4. **Suffixes are frozen after T3.** A post-T3 suffix edit reopens every
   finaled subject; if one becomes genuinely necessary, stop and ask.
5. **Verdicts at delivered scale only** — contact sheets render at final
   display size, never raw 1024s. Every verdict (including rejections, with
   reasons) is appended to `art-review/art-review.md`.
6. **Determinism is load-bearing** (FR-4.4): seeds recorded in the manifest,
   `chosen_seed` honoured by `build-request.ts`, `--force` only for the T7
   spot-check.

---

## Task graph

### Phase 1 — Toolchain completion

---

**T1 — Audit, contact sheets, optimizer, and the manifest skeleton** · `sonnet`

- **Files:** `tools/art/audit.ts` (new), `tools/art/contact-sheet.ts` (new),
  `tools/art/optimize.ts` (new), `tools/art/build-request.ts` (extend),
  `dev/art/hollowdeep.json` (new skeleton), `package.json` (scripts +
  `sharp` devDependency), `.gitignore` if candidate paths need widening
- **Does:**
  - Extend the manifest shape per design plan §5 — per-class `styles` and
    `dims` maps plus per-subject `class` — **backward-compatible** with
    `dev/art/test-cave.json`'s flat shape (`build-request.ts` must expand
    both; test-cave's file is frozen and must keep working).
  - `audit.ts`: diff a manifest against every `artId` the named module
    references (locations/items/creatures — artIds, not location count; the
    six twisty rooms share one) plus the eleven §3 marquee ids
    (`marquee-title`, `marquee-ending-a`, `marquee-ending-b`,
    `marquee-death-{roof,flood,keg,chute,river,gap,dark,stalker}`). Missing
    or orphaned entries fail with names.
  - `contact-sheet.ts`: manifest + candidates dir → static HTML sheet per
    art class, images at **delivered scale**, seed labels, keyboard-free
    reviewing (plain scrollable page is fine).
  - `optimize.ts`: for every subject with a `chosen_seed`, resize the raw to
    delivered dims and encode WebP via `sharp` (build-time devDependency;
    no system binaries) into `adventures/<id>/art/`; enforce the 150 KB
    scene budget by failing loudly with filenames (quality step-down is a
    recorded decision, not a silent one).
  - `npm run validate:art`: schema + audit for every `dev/art/*.json`, with
    two modes — default (T1–T6: prompts may be pending, seeds unchosen) and
    `--strict` (T7 onward: every subject has prompt, seeds, `chosen_seed`,
    and its final file on disk). Wire the default mode into `npm run gate`.
  - `dev/art/hollowdeep.json` skeleton: all ~95 module artIds + 11 marquees,
    each with `class` and (where non-default) dims; `prompt: ""` pending —
    T2 authors them. Class dims per design plan §5 defaults.
  - Verify (and note in the commit) that the module validator tolerates
    marquee files in `art/` that no artId references — if it refuses extras,
    stop and report before T6 lands them.
- **Acceptance:** `npm run gate` green with `validate:art` in it; audit
  catches a deliberately-removed subject in a dry test; `optimize.ts` proven
  on one test-cave raw regenerated into a temp dir (do NOT touch test-cave's
  committed finals); contact sheet renders from the same temp candidates.
- **Commit:** `feat(art): complete the pipeline — audit, contact sheets, optimizer, validate:art`
- **Deps:** none

---

**T2 — Author all ~106 subject prompts** · `opus`

- **Files:** `dev/art/hollowdeep.json` (prompts), `dev/art/style.md`
  (append Hollowdeep-specific notes only if a new lesson emerges)
- **Does:** write every subject prompt in prose, derived from the module's
  own `full`/`description` text (the shipped narrator prose is the art
  direction — quote its observations, never its adjectives). Special cases:
  - the **thief** and **stalker** indirect treatments (design plan
    decision 2) and the matching `marquee-death-stalker` (the lamp's circle
    and what enters it) and `marquee-death-dark` (the painting with almost
    nothing in it — §9.3);
  - the six-room maze's single `twisty` scene;
  - surface scenes in the same palette under overcast daylight (decision 1);
  - marquee endings A/B mirror their epilogue prose.
  Prompts do NOT include style language — that is the suffix's job, and T3
  owns it.
- **Acceptance:** `npm run validate:art` (default mode) passes with zero
  pending prompts; spot-read by the orchestrator against standing rule 3;
  gate green.
- **Commit:** `feat(art): author subject prompts for all hollowdeep art`
- **Deps:** T1

---

### Phase 2 — Style lock

---

**T3 — Style development: candidates, probes, and the human lock** · `opus` · **human checkpoint**

- **Files:** `dev/art/hollowdeep.json` (the four locked `styles` strings),
  `dev/art/style.md` (candidate rationale + what won and why),
  `art-review/art-review.md` (new — the verdict log starts here)
- **Does:** per design plan §4 —
  1. Draft 3–5 suffix candidates: start from test-cave's proven
     oil-on-canvas suffix, push toward lamplit-oil chiaroscuro (vary canvas
     vs board, edge darkness, brush visibility, lamp color temperature).
  2. Probe subjects: `main-street`, `long-drift`, `cathedral`, `toolroom`,
     `brass-lantern`, `stalker` (the hard case).
  3. Generate candidates × probes × 6 seeds on the host (~1.5 s each);
     contact-sheet at delivered scale, one sheet per candidate suffix.
  4. **Stop. Present sheets to the human.** Record the picked suffix per
     class (scene/item/creature/marquee — same family, different framing
     language), verbatim, in the manifest. Log the verdict and the losers'
     reasons.
- **Acceptance:** four locked suffix strings in the manifest; the winning
  probe sheet referenced from `art-review.md`; gate green. The suffixes are
  frozen from this commit (standing rule 4).
- **Commit:** `feat(art): lock the hollowdeep style suffixes from probe contact sheets`
- **Deps:** T2 (probes need real prompts)

---

### Phase 3 — Production and curation

The three curation tasks are serial (all write the manifest and the review
log) and each is a **human checkpoint**: generate → sheets → stop for
verdicts → record → commit. Retries (a subject where no seed works: adjust
the prompt once, regenerate, re-judge) happen inside the task, logged; a
subject still failing after retry goes to a NEEDS-HUMAN list rather than
blocking the batch.

---

**T4 — Scenes: generate, curate, choose** · `opus` · **human checkpoint**

- **Files:** `dev/art/hollowdeep.json` (scene `chosen_seed`s, any prompt
  retries), `art-review/art-review.md`
- **Does:** all ~53 scene subjects × 6 seeds (~320 renders, minutes of GPU);
  sheets grouped by region (A, B, C+maze, D+E) so review sessions stay
  humane; human verdicts; seeds recorded.
- **Acceptance:** every scene subject has `chosen_seed`; verdicts logged;
  gate green (finals are NOT emitted yet — standing rule 1).
- **Commit:** `feat(art): curate scene art — chosen seeds for all 53 scenes`
- **Deps:** T3

---

**T5 — Items and creatures: generate, curate, choose** · `opus` · **human checkpoint**

- **Files:** same as T4
- **Does:** ~36 items + 6 creatures × 6 seeds; one sheet per class; special
  scrutiny on the two indirect creatures (the style's hardest prompts —
  budget a retry); human verdicts; seeds recorded.
- **Acceptance:** every item/creature subject has `chosen_seed`; verdicts
  logged; gate green.
- **Commit:** `feat(art): curate item and creature art — chosen seeds recorded`
- **Deps:** T4

---

**T6 — Marquees: generate, curate, choose** · `opus` · **human checkpoint**

- **Files:** same as T4
- **Does:** the 11 marquee subjects × 6 seeds (title, two endings, eight
  death vignettes — §9.3's constraints on the stalker and darkness
  vignettes apply); human verdicts; seeds recorded.
- **Acceptance:** every marquee subject has `chosen_seed`; verdicts logged;
  gate green.
- **Commit:** `feat(art): curate marquee art — title, endings, the eight deaths`
- **Deps:** T5

---

### Phase 4 — Integration and closeout

---

**T7 — The atomic flip: finals, budget, determinism, gate** · `opus`

- **Files:** `adventures/hollowdeep/art/*.webp` (~106 new),
  `adventures/hollowdeep/art/*.svg` (~97 deleted),
  `adventures/hollowdeep/manifest.json` (`artFormat: "webp"`),
  `tools/art/` only if a real defect surfaced
- **Does:** in ONE commit —
  - run `optimize.ts` over the full manifest → all finals at delivered dims,
    every scene ≤ 150 KB (report the size table in the commit body);
  - delete the placeholder SVGs; flip `artFormat`;
  - **determinism spot-check** (FR-4.4): re-render 3 sampled subjects with
    `--force` into a temp dir and byte-compare against the candidates the
    chosen seeds came from — a mismatch is a stop-and-report;
  - `validate:art --strict` joins the gate script (replacing default mode);
  - full gate; then an in-browser smoke (`npm run dev`, walk three rooms,
    confirm painterly art renders and the dark-room no-picture behavior
    still holds).
- **Acceptance:** gate green with `--strict`; both walkthrough suites
  untouched and passing; browser smoke confirms art on screen; no SVG left
  under `adventures/hollowdeep/art/`.
- **Commit:** `feat(art): ship hollowdeep's painterly art — 106 finals, artFormat webp`
- **Deps:** T6

---

**T8 — Docs closeout** · `opus`

- **Files:** `docs/art-pipeline.md` (new — this repo's own guide, written
  from what actually happened), `docs/art-plan.md` (status → IMPLEMENTED),
  `docs/SCOPE.md` (Phase B exit criteria + deliverables checklist),
  `CLAUDE.md` (Art Pipeline section now points in-repo, status header),
  `README.md` (feature table, art row)
- **Does:** the guide covers: manifest shape (both dialects), the bridge,
  the suffix-lock process, curation flow, optimize/budget, regeneration; the
  SCOPE §6 "art-pipeline guide" deliverable ticks; closeout report states
  Phase B's exit criteria demonstrated.
- **Acceptance:** gate green; docs consistent with shipped reality.
- **Commit:** `docs: art pipeline guide and Phase B closeout`
- **Deps:** T7

---

## Cross-task notes for the orchestrator

1. **Human availability is the schedule.** T3–T6 each block on verdicts.
   Present sheets as files (or a private Artifact contact sheet if that's
   easier to browse) and wait; do not self-judge a verdict the plan assigns
   to the human. Ties and still-failing subjects go to NEEDS-HUMAN, per the
   precedent.
2. **The bridge check is implicit in T3's first render.** If
   `~/pixelart-venv` or the model cache has rotted since `25249c5`, stop and
   report with the exact failure — environment repair is a human-visible
   step, not a silent detour.
3. **GPU thermals/VRAM:** the driver already offloads to CPU; batches of a
   few hundred renders are fine but run them as a background task and don't
   block the session on them.
4. **`sharp` is the one new dependency** (T1, devDependency, build-time
   only). If it fights the environment, `cwebp` via system package is the
   fallback — record whichever shipped.
5. **artId drift:** if any content change lands on `main` mid-plan and adds
   an artId, `validate:art`'s audit fails loudly — reconcile by adding the
   subject and routing it through the earliest un-passed curation task.
6. **Dims are delivered generously** (design plan §7): Phase 3 has not
   locked the scene panel's rendered size; deliver at §5 defaults and note
   that `optimize.ts` can re-emit smaller from the manifest + raws without
   re-curation.

## Progress Tracker

- [x] T1 — Audit, contact sheets, optimizer, manifest skeleton (`sonnet`) — `f76ddb6`
- [x] T2 — Author all ~106 subject prompts (`opus`) — `249be58` (108 subjects)
- [x] T3 — Style lock: candidates, probes, human sign-off (`opus`, human) — `f08688c` (candidate C, chiaroscuro)
- [ ] T4 — Scenes: generate, curate, choose (`opus`, human)
- [ ] T5 — Items + creatures: generate, curate, choose (`opus`, human)
- [ ] T6 — Marquees: generate, curate, choose (`opus`, human)
- [ ] T7 — Atomic flip: finals, budget, determinism, gate (`opus`)
- [ ] T8 — Docs closeout (`opus`)

**Done when:** every box is ticked with its commit SHA, `npm run gate`
(including `validate:art --strict`) is green on `feat/art`, all ~106 finals
ship with every scene ≤ 150 KB, `manifest.artFormat` is `webp` with zero
placeholder SVGs remaining, the determinism spot-check passed, both
walkthrough suites still pass, `npm run dev` shows painterly Hollowdeep, and
`docs/art-pipeline.md` exists with `docs/art-plan.md` marked IMPLEMENTED.
Merging is the human's call.
