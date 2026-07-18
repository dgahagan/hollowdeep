# Scope & Phasing — Hollowdeep

**Status:** Draft v1 — for iteration
**Date:** 2026-07-15
**Related docs:** [PROJECT-BRIEF.md](PROJECT-BRIEF.md) · [REQUIREMENTS.md](REQUIREMENTS.md)

---

## 1. In Scope (v1 release)

- Browser SPA (Vite + React + TypeScript), static build, no backend.
- Headless TypeScript game engine: world model, turn loop, parser, light/fuel,
  scoring, death/recovery, creatures, data-driven events.
- Hybrid input: forgiving multi-word parser + clickable exits/context verbs +
  keyboard shortcuts.
- UI: scene illustration, transcript, inventory, auto-map overlay, status bar,
  settings, help/onboarding, hint system.
- Save/load: named slots + autosave in `localStorage`, versioned; file
  export/import.
- **One complete original adventure** ("Hollowdeep", ~55–65 locations,
  ~12 treasures, ~350 points, maze on the critical path) fully play-tested.
- Lightweight achievements alongside classic scoring (FR-1.12).
- Adventure module format (schema-validated) + a tiny "test-cave" reference
  module + authoring documentation.
- Offline art pipeline: manifest-driven FLUX generation on the RTX 5080,
  seed review flow, optimized image assets (~100 finals) in one consistent
  painterly style.
- Automated tests: engine unit tests + scripted full-game walkthrough.

## 2. Out of Scope (v1)

| Item | Disposition |
|---|---|
| Any server/backend, accounts, cloud saves, telemetry | Won't do (project principle) |
| Runtime AI (LLM parser, in-browser image gen) | Won't do in v1 |
| Port/copy of the 1977 map or text | Won't do (original content only) |
| Native mobile apps | Won't do; phone-web layout is stretch |
| Visual adventure editor | Future project; module format is the enabler |
| Multiplayer / shared worlds | Won't do |
| Localization | Deferred; keep strings centralized to enable later |
| Audio (ambient loops, SFX) | Won't do in v1 — ships silent (decided 2026-07-15); revisit post-v1 |

## 3. Phases & Milestones

Phases end with something runnable. Art generation (Phase B) runs in parallel
with engine work after the world data stabilizes.

### Phase 0 — Foundations (docs → skeleton)
- Design doc for the Hollowdeep adventure (map graph, treasures, puzzles,
  creatures, magic words, scoring table) — **the big creative deliverable**.
- Repo scaffold: Vite/React/TS, strict lint/test setup, CI scripts.
- Module schema v1 defined + validator + "test-cave" fixture module.
- **Exit criteria:** test-cave loads in a bare-bones page; you can walk between
  rooms by typing and clicking.

### Phase 1 — Engine core
- Full world model, turn loop, parser (synonyms, disambiguation, pronouns),
  light/fuel, containers, events/triggers, scoring, death/recovery, creatures.
- Save/load with versioning + autosave. Deterministic seeded RNG.
- Engine unit-test suite; walkthrough-test harness.
- **Exit criteria:** test-cave is fully playable headless (tests) and in
  browser with placeholder art; save/load round-trips.

### Phase 2 — Hollowdeep content, first pass — **complete 2026-07-17**
- [x] Author the full adventure as module data: all locations, items, creatures,
  events, vocabulary, hints, scoring — `adventures/hollowdeep/`, 58 rooms,
  12 treasures, 350 points, two endings, 16 hint ladders.
- [x] Placeholder art everywhere (generated quickly, no curation) — 97 SVGs.
- **Exit criteria met:** Hollowdeep is completable start-to-finish (350/350,
  top rank, canon achievements, 0 deaths, 0 hints) via the automated
  walkthrough at five pinned seeds; every chain, death, and both endings were
  additionally driven by hand headlessly, and the app plays it in-browser
  (`npm run dev`, default adventure). A full human playthrough is invited —
  Phase 4's play-testing owns the formal pass.

### Phase B — Art production (parallel with Phases 1–2) — **complete 2026-07-17**
- [x] Recover or rewrite the FLUX host generator — rewritten
  (`tools/art/host_gen.py`, same request contract; the bards-tale-clone
  original stayed lost).
- [x] Style development: suffix locked from probe contact sheets with human
  sign-off (chiaroscuro; `art-review/art-review.md`).
- [x] Art manifest for all 108 subjects; interactive review UI, human seed
  selection over four+ rounds, optimization (WebP-only per art-plan §9.2),
  atomic integration (`artFormat: "webp"`, placeholder SVGs deleted).
- **Exit criteria met:** every subject has a chosen, optimized,
  style-consistent final wired into the game — 108 finals, every scene
  ≤ 150 KB, seed-determinism spot-checked byte-identical, gate strict.
  As-built guide: [`art-pipeline.md`](art-pipeline.md).

### Phase 3 — UI/UX complete — **complete 2026-07-17**
- Auto-map, journal, hints UI, settings, onboarding, shortcuts, adventure
  select screen, responsive polish, accessibility pass, image
  preloading/perf pass.
- **Exit criteria met:** the Phase 3 UI ships every [M] and surviving [S]
  UI-facing requirement — dual AA themes + self-hosted typography, the
  three-region shell, autocomplete + FR-2.8 shortcuts, the maze-safe
  auto-map, death-rescue / hardcore / single-step undo, journal + hints
  panels, settings, save metadata + thumbnails + file export/import,
  adventure select, help + onboarding + post-game stats, keyboard-only
  operation, tablet layout, and the reduced-motion + preload perf passes.
  The closeout report (`docs/ui-implementation-plan.md` §Closeout) maps each
  requirement to its verification; `docs/ui-plan.md` is marked IMPLEMENTED.
  (Phase B art, then still in flight, landed the same day — the UI's
  placeholder-tolerant wiring picked up the finals with no code changes.)

### Phase 4 — Polish & release
- Full play-testing (including hardcore mode), balance (lamp fuel, creature
  aggression, hint costs), narrator voice editing pass, bug triage, save
  migration check against Phase 2 saves, final performance audit.
- Hardcore fuel pressure (decided 2026-07-18): halve `startFuel` in hardcore
  mode so extinguish-discipline and the one refuel become binding; default
  mode stays generous. Needs a small engine seam (hardcore is a UI-side
  flag; likely a fuel multiplier passed into `createGame`) — design it
  deliberately here rather than bolting on.
- **Exit criteria:** success criteria in PROJECT-BRIEF §8 all pass; tagged
  v1.0 static build.

## 4. Assumptions

- The RTX 5080 host and a working FLUX.2-klein-4B environment remain
  available; generation happens via `distrobox-host-exec` as in the previous
  project. The old `host_gen.py` is missing from the bards-tale-clone working
  tree and will be recovered from the host or rewritten early in Phase B.
- Single developer + AI pair; no external deadlines.
- Original-content-only removes any licensing concerns; we may still include
  small *homages* (e.g., responding to `xyzzy` with a wink) which are fine.
- `localStorage` (~5 MB) is ample for saves; art ships with the app, not in saves.

## 5. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **Content authoring is the long pole** — an original 60-room adventure with fair puzzles is real design work | Schedule | Phase 0 design doc first; walkthrough test keeps it always-completable; scope dial: room count can shrink without engine impact |
| Art style drifts across ~100 images | Quality | Locked style suffix + fixed model version + contact-sheet review before any image is final; regenerate outliers late in one batch |
| `host_gen.py` unrecoverable | Schedule (small) | Contract fully documented; rewrite is bounded (~100 lines); do it first in Phase B |
| Parser frustration (the classic genre-killer) | Player experience | Every parser failure suggests a valid action; clickable UI is always available; play-test with a parser-naive player |
| Maze/darkness/lamp mechanics feel like tedium, not tension in 2026 | Player experience | Fair-maze design (markable rooms + map integration), generous default fuel with hardcore mode for purists |
| Scope creep via "refinements" | Schedule | MoSCoW tags in REQUIREMENTS.md are the contract; new ideas enter as [C] by default |
| `localStorage` cleared by browser | Data loss | Autosave redundancy + save export to file; warn in UI |

## 6. Deliverables Checklist (v1)

These are **v1** deliverables. Phase 0+1 (`docs/foundation-plan.md`) is complete
as of 2026-07-16; the boxes below tick only where the v1 bar is actually met.

- [x] `docs/` — brief, requirements, scope (these), Hollowdeep design doc,
      module-format authoring guide, art-pipeline guide
      — *brief/requirements/scope done; `module-format.md` + `PLAYING.md` +
      `README.md` landed with Phase 0+1; **Hollowdeep design doc** IMPLEMENTED
      (`hollowdeep-plan.md`, 2026-07-17); **art-pipeline guide** landed with
      Phase B (`art-pipeline.md`, 2026-07-17).*
- [x] Engine package (headless TS) with test suite — Phase 0+1: parser, turn
      loop, actions, systems, scoring, save/load with migrations, scene view;
      679 tests incl. a scripted walkthrough that wins at every seed
- [x] Web app (React) — all [M] UI features — Phase 3 complete (2026-07-17):
      dual AA themes + typography, the three-region shell, transcript +
      autocomplete + FR-2.8 shortcuts, the maze-safe auto-map, death-rescue /
      hardcore / undo, journal + hints panels, settings, save metadata +
      export/import, adventure select, help + onboarding + stats, and the
      accessibility / tablet / performance pass. Per-requirement verification
      in `docs/ui-implementation-plan.md` §Closeout.
- [x] `adventures/test-cave/` — reference module — 11 locations, 11 items,
      3 creatures; exercises every engine feature; format reference (FR-6.5)
- [x] `adventures/hollowdeep/` — full adventure data + art manifest + finals
      — *module data complete (Phase 2, 2026-07-17); manifest + 108 curated
      WebP finals shipped with Phase B (2026-07-17), `artFormat: "webp"`.*
- [x] Art pipeline tooling (generator driver, request builder, contact sheets,
      review UI, optimizer, `validate:art`) — Phase B, `tools/art/`
- [ ] Tagged v1.0 static build, playable end-to-end

## 7. Document History

| Version | Date | Notes |
|---|---|---|
| Draft v1 | 2026-07-15 | Initial draft from PROMPT.md + Q&A (original adventure, hybrid input, painterly art, Vite/React/TS) |
| Draft v2 | 2026-07-15 | Decisions locked: Hollowdeep concept confirmed; no audio in v1; achievements in scope [S]; maze on critical path; narrator voice like the original |
