# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status: Foundation + Hollowdeep content + Phase 3 UI complete; Phase B art is the last track

This is "Hollowdeep" (working title): an original browser-based adventure game
in the spirit of *Colossal Cave Adventure*. The engine, the `test-cave`
reference adventure, and a minimal playable browser UI are Phase 0+1
(`docs/foundation-plan.md`). **Hollowdeep itself shipped with Phase 2**
(`docs/hollowdeep-plan.md`, IMPLEMENTED 2026-07-17): `adventures/hollowdeep/`
is the complete game — 58 rooms, 12 treasures, 350 points, two endings, hint
ladders, and a walkthrough that wins at every seed. `test-cave` remains the
format fixture. **The real UI shipped with Phase 3** (`docs/ui-plan.md`,
IMPLEMENTED 2026-07-17): dual AA themes + self-hosted typography, the
three-region shell, autocomplete + shortcuts, the maze-safe auto-map,
death-rescue / hardcore / undo, journal + hints panels, settings, save
metadata + export/import, adventure select, help + onboarding + stats, and
the accessibility / tablet / performance pass. **Phase B art is the one
remaining track** — the UI wires whatever art files exist and tolerates
placeholders, so it does not block on Phase B.

```bash
npm install
npm run dev      # opens on adventure-select (?adventure=hollowdeep|test-cave deep-links in)
npm run gate     # typecheck && lint && test && validate && build — must be green before any commit
```

| Command | Does |
|---|---|
| `npm run gate` | The whole verification gate. If it is red, nothing else matters. |
| `npm test` | Vitest (865 tests, 33 files) |
| `npm run validate` | Validate every adventure in `adventures/`; takes paths as argv |
| `npm run dev` / `build` / `preview` | Vite |
| `npm run typecheck` / `lint` | tsc / ESLint |

## Read These First

- `docs/PROJECT-BRIEF.md` — vision, the Hollowdeep adventure concept, goals/non-goals, and the **Resolved Decisions** table (§9). Decisions there are settled; don't re-litigate them.
- `docs/REQUIREMENTS.md` — numbered requirements with MoSCoW tags (`[M]/[S]/[C]/[W]`). The tags are the scope contract; new ideas enter as `[C]` by default.
- `docs/SCOPE.md` — phase plan (Phase 0 → 4, plus parallel Phase B for art), risks, deliverables checklist.
- `docs/PROMPT.md` — the original project prompt.

## Locked Decisions (summary)

- **Original adventure**, not a port — no text or map from the 1977 game (homages like a wry `xyzzy` response are fine).
- **Stack:** Vite + React + TypeScript SPA; static-only delivery, no backend, no runtime AI.
- **Input:** hybrid — forgiving multi-word parser AND clickable exits/context verbs/keyboard shortcuts. Clicks echo their command into the transcript.
- **Art:** painterly AI illustrations for every location/item/creature, shipped as **real image files** (WebP/AVIF) — explicitly NOT the JSON text-grid sprite encoding used in bards-tale-clone.
- **v1 ships silent** (no audio); achievements are in scope alongside classic point scoring; the maze is on the critical path; narrator voice is dry/wry like the original.

## Architecture (as built)

- **Engine ≠ UI:** the game core (world model, parser, turn loop, scoring, save/load) is headless TypeScript with no React/DOM imports, fully testable without a browser. React is presentation only.
- **Engine ≠ content:** adventures are self-contained, schema-validated data modules. Adding an adventure must require zero engine changes. A tiny `test-cave` module serves as the format reference and test fixture. The format is **eleven JSON documents plus `art/`** — manifest, locations, items, creatures, events, strings, vocabulary, scoring, achievements, walkthrough, hints. (The hints *panel* shipped with Phase 3 UI; the hints *data* and the `hint` verb shipped with the hints-timers engine work, alongside relative timers. The art manifest belongs to the Phase B art pipeline, not to a module.) `docs/module-format.md` is the contract.
- **Determinism:** the turn loop is deterministic given a seed — required for the automated full-walkthrough test.
- **Saves:** versioned JSON in `localStorage`, namespaced per adventure (`cave.<adventureId>.slot.<n>` / `.auto.<0..4>`), with a migration registry on version bumps. Loading a save that cannot be honoured raises a **typed** `SaveError` the UI presents — never silent corruption. File export/import (FR-5.4) shipped with Phase 3: named slots are wrapped in a UI-side metadata envelope (`src/app/storage.ts`) around the opaque engine payload, and imports run through the same `SaveError` path — the engine's `SAVE_VERSION` is untouched.

## Art Pipeline

Reuses the manifest-first pattern from the sibling project
`~/work/personal/fable/bards-tale-clone` (see its `docs/art-pipeline.md` for the
full writeup):

- FLUX.2-klein-4B running locally on the host's RTX 5080, invoked from the
  distrobox via `distrobox-host-exec` → Python venv → a generator script that
  reads a JSON request file (idempotent, deterministic seeds).
- A per-adventure **art manifest** (id, subject prompt, shared style suffix,
  dims, candidate seeds, `chosen_seed`) is the committed source of truth;
  contact-sheet review picks winners.
- **Caveat:** the old `host_gen.py`/`pixelcore.py` drivers are missing from
  bards-tale-clone's working tree (only a `.pyc` remains in
  `dev/pixel-art/__pycache__/`). Recover them from the host or rewrite (~100
  lines); their request-file contract is documented in that repo's art-pipeline
  doc and `dev/pixel-art/gen_request*.json` examples.
- This project skips the palette-crush/JSON-import steps entirely: generate →
  pick seed → optimize (WebP/AVIF, ≤150 KB per scene) → commit as static assets.

## Workflow Commands

`.claude/impl-plan.md` and `.claude/run-plan.md` are slash commands
(`/impl-plan`, `/run-plan`). The flow: a settled design plan at
`docs/<name>-plan.md` → `/impl-plan` writes
`docs/<name>-implementation-plan.md` (phased task graph with per-task model
assignments) → `/run-plan` executes it as an orchestrator, verifying and
committing per task. The Rules of Engagement, model policy, and the
verification-gate commands live in `docs/orchestration-playbook.md`. The first
design plan is `docs/foundation-plan.md` (Phase 0+1: scaffold, module format,
engine core, test-cave, minimal UI); its implementation plan is
`docs/foundation-implementation-plan.md`. The command files were adapted from
another project; their stale cross-project references were corrected on
2026-07-15. If any survive, this repo's playbook is authoritative.

## Next Milestone (Phase B art, then Phase 4 release)

Per `docs/SCOPE.md`: Phase 2 content and Phase 3 UI are both complete, so the
one remaining build track is **Phase B** — the FLUX art pipeline (recover or
rewrite the host generator, author the hollowdeep art manifest, generate →
curate → optimize ~100 painterly images including the marquee title, ending,
and eight per-death vignette images the UI already has slots for). The UI is
placeholder-tolerant, so art lands unreferenced-then-wired with no UI changes:
the death modal keys vignettes off `marquee-death-<messageId minus '-death'>`,
adventure select and endings use `marquee-title`/`marquee-*`, scenes use each
location's `artId`. After Phase B, **Phase 4** is play-testing, balance, and
release (SCOPE §Phase 4). Exit criteria live in SCOPE §3.
