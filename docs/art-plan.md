# Phase B — Art Production Design Plan

**Status:** IMPLEMENTED — 2026-07-17, via
[`art-implementation-plan.md`](art-implementation-plan.md) T1–T8 on
`feat/art`. All 108 subjects (53 scenes, 38 items, 6 creatures, 11 marquees)
curated with human verdicts and shipped as WebP finals; `artFormat: "webp"`;
`validate:art --strict` in the gate. The as-built guide is
[`art-pipeline.md`](art-pipeline.md); verdicts in `art-review/art-review.md`.
(Original status: READY — signed off 2026-07-17; style direction,
unseen-creature treatment, format, tooling ownership, and all §9 review items
settled; §9 logs the answers.)
**Phase:** B (parallel track; SCOPE §3). Blocks: v1. Does not block Phase 3 —
the UI consumes whatever `manifest.artFormat` names, so the two tracks merge
cleanly in either order (one coordination point, §7).
**Settled by:** [PROJECT-BRIEF.md](PROJECT-BRIEF.md) §9 (real image files, no
JSON pixel grids), [REQUIREMENTS.md](REQUIREMENTS.md) FR-4.1–FR-4.6,
[SCOPE.md](SCOPE.md) Phase B.
**Branch:** `feat/art` once READY; `/impl-plan` turns this into the task graph.

This is the WHAT/WHY. The bards-tale-clone pipeline
(`~/work/personal/fable/bards-tale-clone/docs/art-pipeline.md`) is the working
precedent; this plan keeps its manifest-first discipline and drops everything
palette/pixel-related, which this project explicitly does not do.

---

## 1. What is already decided

| | |
|---|---|
| **Model** | FLUX.2-klein-4B, locally, on the host RTX 5080. No cloud, no APIs (FR-4.2) |
| **Assets** | Real image files, lazy-loaded; never JSON text grids (brief §9) |
| **Source of truth** | A committed per-adventure art manifest; regeneration is idempotent and seed-deterministic (FR-4.2, FR-4.4) |
| **Budget** | ≤ 150 KB per location image at delivered resolution (FR-4.3) |
| **Coherence** | One verbatim style suffix per art class; subject prompts vary, style strings never do (FR-4.1) |
| **Review** | Contact sheets, ~6–10 seeds per subject, `chosen_seed` recorded (FR-4.5) |
| **Alt text** | Already handled — the engine feeds each scene's `brief` as the image's accessible name; art adds nothing here |

**Settled 2026-07-17 (this plan's Q&A):**

1. **The look is lamplit oil, dark.** Moody oil-painting chiaroscuro: most of
   every frame in darkness, the subject picked out in warm lantern light.
   It matches the narrator's register (the horror is tidiness, seen by one
   lamp), it makes the lamp — the game's central object — the literal light
   source of the art, and it hides diffusion artifacts where the game already
   says nothing can be seen. Surface scenes (region A, the gunnis) get the
   same palette under overcast daylight, so the two lit worlds read as one
   painting.
2. **The thief and the stalker get indirect art.** The content says the thief
   is "never a portrait" and the stalker is never fully seen; the art obeys.
   Thief: its work — drag-marks into the dark, the midden's sorted shine.
   Stalker: a wrongness at the edge of the lamp's circle, mostly negative
   space. These two prompts are the style's hardest test and belong in the
   style-development batch (§4).
3. **WebP, and only WebP.** `manifest.artFormat` is a single value per module
   and every target browser (NFR-2, last two versions) decodes WebP. AVIF
   buys ~20% at these sizes and a second encode path; not worth it. The
   schema already accepts `webp` — no engine change.
4. **test-cave is already done and stays as-is.** *(Corrected 2026-07-17:
   the draft said "keeps its placeholder SVGs", but `25249c5` had already
   shipped test-cave 24 real WebP finals at 79 KB average.)* The intent of
   the decision — spend nothing further on the fixture — stands: test-cave's
   art, manifest (`dev/art/test-cave.json`), and suffix are frozen; this plan
   touches Hollowdeep only.

## 2. Constraints and givens

- **The generator is already rebuilt and proven.** *(Corrected 2026-07-17
  — this plan's draft predated a repo check.)* `tools/art/host_gen.py` was
  rewritten in-repo (`f4673b8`) against the documented bards-tale-clone
  contract, and `25249c5` used it to produce test-cave's 24 shipping WebP
  finals — so the whole bridge (distrobox → `distrobox-host-exec` →
  `~/pixelart-venv/bin/python` → host GPU) is production-proven, not
  theoretical. `tools/art/build-request.ts` (manifest → request expansion,
  `chosen_seed`-aware) exists too. What remains to build: audit,
  contact-sheet, and optimize tools, plus a `validate:art` gate step.
  Distilled-model settings (8 steps, guidance 2.5) are pinned in the driver.
- **The prompting lessons are banked.** `dev/art/style.md` records the three
  traps the first pass hit (tag soup vs prose for a Qwen3 encoder; "digital
  illustration" buying glossy render; adjectives summoning fantasy art —
  *prompt the observation, never the conclusion*). Hollowdeep's prompts and
  suffix candidates start from these, not from zero.
- **No crush, no palettes, no tiling.** This pipeline ends at "optimize and
  commit the raster." The palette-quantization, sub-palette, and text-grid
  import machinery of the precedent is explicitly out (brief §9). FLUX's
  inability to tile is irrelevant — nothing here tiles.
- **~1.5 s per image** on the 5080 changes curation economics: generate wide
  (6–10 seeds), judge contact sheets, never nurse a single image.
- **The validate glob is merciless, atomically.** `missing-art-file` checks
  `art/<artId>.<artFormat>` for every artId. Flipping `artFormat` to `webp`
  therefore requires every artId's final image in the same commit — the swap
  is one atomic integration commit at the end, not a drip (§7).

## 3. The subjects — what actually gets painted

The module today ships **97 artIds** (58 locations sharing one maze artId ⇒ 53
scene ids, plus items and creatures). Phase B adds eleven marquee subjects.
Roughly:

| Class | Count | Examples |
|---|---|---|
| `scene` | ~53 | every location; the six twisty rooms share `twisty` (§9's fairness — identical rooms look identical) |
| `item` | ~36 | treasures, tools, keys, scenery items events hang on |
| `creature` | 6 | storekeeper, bats, blind fish, newt as portraits; **thief and stalker indirect** (decision 2) |
| `marquee` | 11 | title screen; ending-A epilogue; ending-B epilogue; eight per-death vignettes (§9.3 — one per §12.5 death) |
| **Total** | **~106** | |

UI accents (FR-4.1's tail) stay CSS/procedural and belong to Phase 3 — a
generated texture is the wrong tool for a border.

The definitive subject list is derived from the module by a tool, not by hand:
`tools/art/audit.ts` diffs `dev/art/hollowdeep.json` against every `artId` the
module references, so a content change that adds an artId fails loudly in the
art pipeline too.

## 4. The style suffix — locked by contact sheet, not by prose

The single highest-leverage decision is the verbatim suffix string, and it
cannot be settled in a document — it has to be settled by looking. The
style-development task:

1. Draft 3–5 candidate suffixes in the lamplit-oil direction (varying on:
   oil-on-canvas vs oil-on-board texture, edge darkness, brush visibility,
   color temperature of the lamp light).
2. Pick **six probe subjects** that span the space: one town exterior
   (main-street), one timbered interior (long-drift), one karst cavern
   (cathedral), one past-the-breach interior (toolroom), one item
   (brass-lantern), one hard case (the stalker's indirect portrait).
3. Generate every candidate suffix × probe × 6 seeds; contact-sheet the lot
   **at delivered scale** (the precedent's standing rule — verdicts come from
   what ships, never from raw renders).
4. Human picks. The winning suffix strings (one per art class — scene, item,
   creature, marquee share a family but differ in framing language) are
   recorded in the manifest **verbatim and frozen**. Changing a suffix after
   subjects are finaled reopens every finaled subject; that is the point of
   freezing it.

## 5. The art manifest

`dev/art/hollowdeep.json` — committed, and the source of truth (FR-4.2),
following the `dev/art/test-cave.json` precedent already on main. It is
**not** one of the module's eleven documents: the module loader never reads
it, the art tooling owns it (`module-format.md` stays true — adding an
adventure still means eleven documents; art production is a separate concern
with its own contract). The existing manifest shape (global `style`,
`gen_w`/`gen_h`, default `seeds`, per-subject `prompt`/`seeds`/`chosen_seed`)
is **extended** for what Hollowdeep needs — per-class style suffixes and
per-subject dims — and `build-request.ts` grows to match, staying backward-
compatible with test-cave's file. A schema + validator lives in `tools/art/`
and runs in the gate via a new `npm run validate:art`.

```json
{
  "styles": { "scene": "<locked verbatim by §4>", "item": "…", "creature": "…", "marquee": "…" },
  "dims":   { "scene": [1024, 640], "item": [640, 640], "creature": [640, 800], "marquee": [1344, 768] },
  "seeds":  [1, 2, 3, 5, 8, 13],
  "subjects": {
    "cathedral": {
      "class": "scene",
      "prompt": "A cavern vault a single lantern cannot find the top of …",
      "chosen_seed": 5,
      "notes": "echo foreshadow — keep the ceiling lost in dark"
    }
  }
}
```

(Prose prompts, per style.md lesson 1 — sentences, not tag soup.)

Rules carried over from the precedent: subject prompts carry the art
direction (never anyone's memory); every seed ever generated is recorded; a
`chosenSeed` plus the manifest reproduces any shipped image bit-for-bit
(FR-4.4).

**Dims by class** (generation size; multiples FLUX likes):
`scene` 1024×640 (8:5), `item` 640×640, `creature` 640×800 (4:5), `marquee`
1344×768. Delivered files are downscaled to ≤ 2× their largest on-screen
display size — the exact numbers are the one Phase 3 coordination point (§7)
and live in the manifest, not in tool code.

## 6. The workflow, end to end

```
audit (artIds ⇄ manifest)                        tools/art/audit.ts
  → request builder (pending subjects → JSON)    tools/art/build-request.ts
  → generate on host (idempotent, seeded)        distrobox-host-exec → tools/art/host_gen.py
  → contact sheets (HTML, delivered scale)       tools/art/contact-sheet.ts
  → human verdicts                               art-review/art-review.md (append-only log)
  → record chosenSeed in manifest
  → optimize (resize + cwebp, budget-checked)    tools/art/optimize.ts
  → commit finals to adventures/hollowdeep/art/*.webp
  → flip manifest.artFormat "svg" → "webp" (one atomic commit, §2)
```

- Raw candidates live under `dev/art-candidates/` — **gitignored**; only
  chosen, optimized finals are committed.
- `optimize.ts` enforces the budget: a scene over 150 KB fails the run and
  names the file (quality step-down is a recorded decision, not a silent one).
- The review log records every verdict *including rejections with reasons* —
  the precedent's "too cute" purge is the cautionary tale worth the paper
  trail. Ties go to a NEEDS-HUMAN list.

## 7. Integration and coordination with Phase 3

- The engine and UI already consume `art/<artId>.<artFormat>` — the flip is
  data-only. **One atomic commit** swaps `artFormat` and lands all ~99 finals
  (plus deleting the placeholder SVGs); the gate's `missing-art-file` check
  makes a partial swap impossible to commit, which is a feature.
- **Coordination point (the only one):** delivered pixel sizes should be
  ≥ 2× the scene panel's largest rendered size. If Phase 3 lands first, read
  the real numbers from its layout; if Phase B lands first, deliver at the
  §5 defaults (generous) and let `optimize.ts` re-emit smaller later — the
  manifest and raws make that a re-run, not a re-decision.
- The four marquee images have no `artId` consumer yet (title/endings/death
  are Phase 3 screens). They are generated, curated, and committed under
  `adventures/hollowdeep/art/marquee-*.webp` on this track; Phase 3 wires
  them. Shipping unreferenced files is deliberate — curation is the long
  pole, wiring is trivial.

## 8. Deliverables & exit criteria (SCOPE Phase B, restated)

1. `tools/art/` — generator (host), request builder, audit, contact-sheet,
   optimizer; `npm run validate:art` in the gate.
2. Locked style suffixes, chosen from test batches by the human (§4).
3. `adventures/hollowdeep/art-manifest.json` — complete over every artId +
   marquees, every subject with recorded seeds and a `chosenSeed`.
4. `art-review/art-review.md` — the verdict log.
5. ~106 optimized WebP finals committed; `artFormat: "webp"`; every scene
   ≤ 150 KB; gate green.
6. `docs/art-pipeline.md` — the how-it-works guide (SCOPE §6's outstanding
   docs deliverable), written at closeout from what actually happened.

**Exit:** every subject has a chosen, optimized, style-consistent final wired
into the game (SCOPE), `npm run dev` shows painterly Hollowdeep end to end,
and a fresh clone can regenerate any image from the manifest alone.

## 9. Review items — resolved 2026-07-17

1. **test-cave stays on placeholder SVGs** — confirmed. The fixture is not
   painted.
2. **WebP-only** — confirmed. AVIF and fallbacks stay out.
3. **Eight per-death vignettes** — the human chose the full gallery over a
   shared image: one painting per §12.5 death (roof, flood, keg, chute,
   river, gap, dark, stalker). Two constraints carry over from decision 2:
   the **stalker** death vignette stays indirect (the lamp's circle and what
   enters it — never the creature plain), and the **darkness** death is the
   painting with almost nothing in it, which is the assignment. Phase 3 wires
   them into the death modal per death cause; until then they land
   unreferenced like the other marquees (§7).
4. **Marquee art lands unreferenced** until Phase 3 wires the screens —
   confirmed.
