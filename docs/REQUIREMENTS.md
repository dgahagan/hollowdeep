# Requirements — Hollowdeep

**Status:** Draft v1 — for iteration
**Date:** 2026-07-15
**Related docs:** [PROJECT-BRIEF.md](PROJECT-BRIEF.md) · [SCOPE.md](SCOPE.md)

Priorities use MoSCoW: **[M]** Must have (v1 ships with it) · **[S]** Should
have (v1 target, cuttable under pressure) · **[C]** Could have (stretch) ·
**[W]** Won't have in v1 (explicitly deferred).

---

## 1. Game Engine (core rules)

- **FR-1.1 [M]** World model: locations with descriptions (long/short), exits
  (including conditional, hidden, and one-way exits), items, creatures, light
  state, and arbitrary flags.
- **FR-1.2 [M]** Player state: current location, inventory (with carry limits),
  score, turn counter, lamp fuel, visited-location set, event flags.
- **FR-1.3 [M]** Turn loop: parse/act → world reactions (creature movement,
  lamp burn, timed events) → narration. Deterministic given a seed, so
  bugs and tests are reproducible.
- **FR-1.4 [M]** Light/darkness: dark locations are unexplorable and dangerous
  without a lit lamp; lamp consumes fuel per turn; refuel mechanic exists;
  clear warnings at defined thresholds.
- **FR-1.5 [M]** Scoring: points for treasures found, treasures deposited,
  reaching milestones, and secrets; deductions for hints and deaths;
  final rank titles at game end (classic style).
- **FR-1.6 [M]** Death & recovery: hazards can kill; on death the player may
  resume from autosave or accept classic reincarnation (score penalty,
  possessions scattered). A **hardcore mode** toggle disables autosave-rescue.
- **FR-1.7 [M]** Creatures/NPCs: at minimum a wandering hostile (fight/flee/
  ward-off mechanics) and a thief-type entity that relocates treasure.
  Behavior driven by data where practical.
- **FR-1.8 [M]** Events & triggers: data-defined triggers (on-enter, on-take,
  on-use-X-with-Y, on-turn-N, on-flag) that can change descriptions, open
  exits, move items, award points, or run scripted sequences.
- **FR-1.9 [S]** Magic words: adventure-defined teleport/effect words that are
  never listed in UI (discoverable only), in the xyzzy tradition.
- **FR-1.10 [S]** Container/liquid basics: items can contain items (bottle of
  water/oil pattern) to support classic puzzle shapes.
- **FR-1.11 [C]** Undo last turn (single-step), disabled in hardcore mode.
- **FR-1.12 [S]** Achievements: adventure-defined achievements (first treasure,
  no-hint completion, finding each secret, ironman victory, notable deaths…)
  tracked per adventure, persisted alongside saves, viewable in-game.
  Complements — never replaces — classic point scoring.

## 2. Input: Parser + UI Actions

- **FR-2.1 [M]** Text parser accepting 1-to-N word commands: verb, verb-noun,
  verb-noun-preposition-noun (`unlock grate with key`).
- **FR-2.2 [M]** Vocabulary with synonyms (`get/take/grab`, `lamp/lantern`),
  defined per-engine (core verbs) and per-adventure (nouns, extra verbs).
- **FR-2.3 [M]** Compass shortcuts (`n/s/e/w/ne/nw/se/sw/u/d/in/out`) and
  classic conveniences (`again`/`g`, `look`/`l`, `inventory`/`i`).
- **FR-2.4 [M]** Forgiving failures: unknown input produces a helpful nudge
  ("You can see the grate — try `open grate`."), never a stack of jargon.
  Disambiguation prompts when a noun matches multiple items ("Which key?").
- **FR-2.5 [S]** Pronoun support: `it`/`them` referring to the last-mentioned object.
- **FR-2.6 [S]** Input autocomplete/suggestions drawn from currently valid
  vocabulary; command history via up/down arrows.
- **FR-2.7 [M]** Clickable equivalents: exits shown as clickable directions;
  visible items and inventory items expose context-sensitive verb buttons
  (examine, take, drop, use…). Every click is echoed into the transcript as
  the command it performed (teaches the parser by example).
- **FR-2.8 [M]** Keyboard shortcuts for common functions — at minimum:
  map (`m`), inventory (`i`), look (`l`), save (`Ctrl+S`), journal (`j`),
  help (`?`). Shortcuts listed in an in-game help panel.
- **FR-2.9 [W]** LLM natural-language input — explicitly out of v1.

## 3. Presentation & UI

- **FR-3.1 [M]** Scene view: the current location's illustration with title,
  description, visible items and creatures, and exit indicators.
- **FR-3.2 [M]** Scrollable transcript of narration and commands (the classic
  text stream remains first-class; the game is fully playable reading it alone).
- **FR-3.3 [M]** Inventory panel with item thumbnails and context actions.
- **FR-3.4 [M]** Auto-map: graph of visited locations with current position,
  drawn progressively; unexplored exits hinted. Opens as overlay (button + `m`).
  Maze rooms map only once the player has disambiguated them (e.g., by
  dropping items) — the map must not solve the maze for free.
- **FR-3.5 [M]** Status bar: location name, score, turn count, lamp gauge.
- **FR-3.6 [S]** Journal: auto-log of key events, treasures found, hints
  unlocked, plus free-text player notes.
- **FR-3.7 [S]** Settings panel: text size, transcript-only mode (hide art),
  animation/motion toggle, hardcore mode, narration speed.
- **FR-3.8 [S]** Responsive layout: desktop-first; usable on a tablet.
  Phone layout **[C]**.
- **FR-3.9 [W]** Audio — decided 2026-07-15: v1 ships silent. (When revisited:
  ambient loops per region + minimal SFX, volume controls, autoplay compliance.)

## 4. Graphics & Art Pipeline

- **FR-4.1 [M]** One painterly illustration per location (~60), per item
  (~30), per creature/character (~8), plus title screen, death/ending art,
  and UI accents. Single consistent style enforced by a shared style suffix.
- **FR-4.2 [M]** Art is generated **offline** on the local RTX 5080 with the
  FLUX.2-klein-4B pipeline, driven by a per-adventure **art manifest**
  (id, subject prompt, style key, dimensions, candidate seeds, chosen seed) —
  the manifest is the source of truth and is committed to the repo.
- **FR-4.3 [M]** Images ship as real image files (WebP/AVIF + fallback),
  lazy-loaded; **no** JSON-text encoding of pixels. Target budget: ≤150 KB per
  location image at delivered resolution.
- **FR-4.4 [M]** Regeneration is idempotent and deterministic: re-running the
  generator with the manifest skips existing images and reproduces chosen ones.
- **FR-4.5 [S]** A contact-sheet review flow (generate N seeds per subject,
  review, record `chosen_seed` in the manifest).
- **FR-4.6 [C]** Simple ambient motion (CSS parallax/flicker on scene art,
  e.g. lamplight), honoring the reduced-motion setting.

## 5. Save / Load

- **FR-5.1 [M]** Manual save to named slots (≥5) with timestamp, location name,
  score, and a thumbnail; load from any slot; delete slots.
- **FR-5.2 [M]** Autosave every turn (ring of recent turns) enabling
  resume-after-death and resume-after-tab-close.
- **FR-5.3 [M]** Saves are versioned JSON in `localStorage`, namespaced per
  adventure; loading an old-version save migrates or fails with a clear message
  (never silent corruption).
- **FR-5.4 [S]** Export save to file / import from file (shareable, backup).
- **FR-5.5 [W]** Cloud sync — out of scope (no backend).

## 6. Adventure Module System (expansion)

- **FR-6.1 [M]** An adventure is a self-contained content package: manifest
  (id, title, version, engine-version requirement), locations, items,
  creatures, vocabulary, events, scoring table, hints, art manifest, and
  art assets. **No engine code changes** to add one.
- **FR-6.2 [M]** All module data is schema-validated (build-time and load-time)
  with actionable errors (bad exit target, missing art id, orphan location…).
- **FR-6.3 [M]** Engine/content contract is documented well enough that a
  second adventure can be authored from the docs alone.
- **FR-6.4 [S]** Adventure select screen (even with one adventure) so the
  expansion path is visible in the UI from day one.
- **FR-6.5 [S]** A tiny "test-cave" module (5–10 rooms) maintained in-repo as
  the module-format reference and engine test fixture.
- **FR-6.6 [C]** Consistency linter: every location reachable, every treasure
  obtainable, every puzzle's prerequisites satisfiable (static analysis of
  module data).

## 7. Hints, Help & Onboarding

- **FR-7.1 [M]** In-game help: how to play, verb list, shortcuts. First-run
  gentle onboarding (a few contextual tips, dismissible, never a forced tutorial).
- **FR-7.2 [S]** Gradual hint system per puzzle: nudge → hint → solution, each
  step costing points (classic-compatible).
- **FR-7.3 [C]** Post-game stats screen: turns, deaths, hints, map coverage,
  secrets found, achievements earned.

## 8. Non-Functional Requirements

- **NFR-1 [M]** Static-only delivery: `vite build` output runs from any static
  file server; no backend, no third-party runtime services, no analytics.
- **NFR-2 [M]** Browser support: current Chrome, Firefox, Safari, Edge
  (last ~2 versions). No IE/legacy.
- **NFR-3 [M]** Performance: first playable interaction < 3 s on a typical
  broadband connection; scene image swap < 200 ms perceived (preload adjacent
  locations' art).
- **NFR-4 [M]** Engine core is headless TypeScript with **no React/DOM
  imports**, unit-tested (parser, world rules, scoring, save round-trip);
  full-adventure walkthrough runs as an automated test.
- **NFR-5 [M]** Accessibility: fully keyboard-playable; transcript is
  screen-reader-friendly (art carries alt text = location short description);
  respects `prefers-reduced-motion`; WCAG AA contrast in both themes.
- **NFR-6 [S]** Works offline after first load (installable PWA is **[C]**;
  at minimum, no hard runtime network dependency).
- **NFR-7 [M]** All content (text + data + art manifest) is original work —
  inspired by, not copied from, the 1977 game's text or map.
- **NFR-8 [S]** Repo conventions: TypeScript strict mode, ESLint/Prettier,
  CI-runnable test + lint + schema-validation scripts.
