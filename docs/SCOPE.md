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

### Phase 2 — Hollowdeep content, first pass
- Author the full adventure as module data: all locations, items, creatures,
  events, vocabulary, hints, scoring.
- Placeholder art everywhere (generated quickly, no curation).
- **Exit criteria:** Hollowdeep completable start-to-finish (350/350) via the
  automated walkthrough and by a human.

### Phase B — Art production (parallel with Phases 1–2)
- Recover or rewrite the FLUX host generator (`host_gen.py` contract is
  documented in bards-tale-clone `docs/art-pipeline.md`).
- Style development: lock the painterly style suffix via test batches.
- Art manifest for all ~100 subjects; contact-sheet generation, seed
  selection, optimization (WebP/AVIF), integration.
- **Exit criteria:** every subject has a chosen, optimized, style-consistent
  final image wired into the game.

### Phase 3 — UI/UX complete
- Auto-map, journal, hints UI, settings, onboarding, shortcuts, adventure
  select screen, responsive polish, accessibility pass, image
  preloading/perf pass.
- **Exit criteria:** all [M] and surviving [S] requirements demonstrably met.

### Phase 4 — Polish & release
- Full play-testing (including hardcore mode), balance (lamp fuel, creature
  aggression, hint costs), narrator voice editing pass, bug triage, save
  migration check against Phase 2 saves, final performance audit.
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

- [ ] `docs/` — brief, requirements, scope (these), Hollowdeep design doc,
      module-format authoring guide, art-pipeline guide
- [ ] Engine package (headless TS) with test suite
- [ ] Web app (React) — all [M] UI features
- [ ] `adventures/test-cave/` — reference module
- [ ] `adventures/hollowdeep/` — full adventure data + art manifest + finals
- [ ] Art pipeline tooling (generator driver, request builder, contact sheets,
      optimizer)
- [ ] Tagged v1.0 static build, playable end-to-end

## 7. Document History

| Version | Date | Notes |
|---|---|---|
| Draft v1 | 2026-07-15 | Initial draft from PROMPT.md + Q&A (original adventure, hybrid input, painterly art, Vite/React/TS) |
| Draft v2 | 2026-07-15 | Decisions locked: Hollowdeep concept confirmed; no audio in v1; achievements in scope [S]; maze on critical path; narrator voice like the original |
