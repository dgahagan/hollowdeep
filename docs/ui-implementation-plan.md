# UI Implementation Plan — Phase 3 UI/UX

**Status:** READY (2026-07-17)

Execution plan for [`docs/ui-plan.md`](ui-plan.md) (the WHAT/WHY); rules live
in [`docs/orchestration-playbook.md`](orchestration-playbook.md).

This is an **app plan**: every task writes under `src/app/**` (plus styles,
fonts, tests, and docs). `src/engine/**` is untouched by design — the design
plan's §2 audit maps every feature to engine surface that already exists. If
a task discovers that table is wrong, that is a stop-and-report, never a
license to patch the engine from this branch.

---

## Kickoff

A fresh Opus session should execute this with:

```
/run-plan docs/ui-implementation-plan.md
```

If starting cold: read [`docs/ui-plan.md`](ui-plan.md) (§2 engine audit, §4
map rule, §5 death/hardcore/undo, §8 state layering, §12 resolved decisions),
[`docs/orchestration-playbook.md`](orchestration-playbook.md), `CLAUDE.md`,
and this file, then execute the graph in order. The Progress Tracker at the
bottom is the source of truth for resuming.

## Scope & branch

**Branch:** `feat/ui`, from `main`.

**In scope:** design plan §3–§9 and §11 — the shell + both themes +
typography, transcript/input upgrades, auto-map, death/hardcore/undo,
journal, hints panel, settings, save-dialog upgrades + export/import,
adventure select, help/onboarding, post-game stats, ambient motion,
accessibility + tablet + performance passes, docs closeout.

### Deferred / out of scope

| Item | Reason |
|---|---|
| Engine changes of any kind | ui-plan §2/§10 — discovered need = stop-and-report |
| Phone layout | FR-3.8 [C]; excluded by design plan decision 2 (tablet is the floor) |
| PWA/installability | NFR-6 [C] half excluded; offline-after-first-load must still hold |
| Audio | FR-3.9 [W] |
| LLM input | FR-2.9 [W] |
| Marquee art generation | Phase B (`docs/art-plan.md`); this plan wires whatever files exist, placeholder-tolerant |
| New adventure content | Both modules are done |

## Standing rules (apply to every task)

1. **`src/engine/**` is read-only.** Enforced socially here and by review;
   the lint fence already keeps React out of the engine — this plan adds the
   reverse discipline.
2. **Logic that can be headless, is.** Map layout, the maze cloud rule,
   journal derivation, undo retention, settings/sidecar persistence — pure
   functions in plain modules with vitest coverage. React components stay
   thin; no jsdom/RTL harness unless a task can justify it (keep the gate
   fast). Browser verification happens per task (dev-server smoke) and
   comprehensively at T12.
3. **Every overlay:** focus-trapped, Esc closes, keyboard reachable,
   shortcut-listed in help, `prefers-reduced-motion` respected, AA in both
   themes. Acceptance criteria assume this list without restating it.
4. **State layering (ui-plan §8)** is law: GameState (engine, saved) / UI
   sidecar `cave.<id>.ui.*` / global `cave.settings`. Nothing UI-side writes
   into GameState; sidecar and settings carry a version field with
   tolerate-and-reset migration.
5. **Clicks echo commands** (FR-2.7) — every new button that performs a game
   action goes through the same input path as typing, including the hints
   panel's button. `undo` is intercepted **above** `step()` (ui-plan §12.3).
6. **The gate is the gate.** `npm run gate` green at every commit; both
   walkthrough suites and the engine's 796+ tests must never notice this
   branch exists.

---

## Task graph

### Phase 1 — Foundation: identity, shell, settings

---

**T1 — Design tokens, both themes, typography, and the shell** · `opus` · **human checkpoint**

- **Files:** `src/app/app.css` (split into `theme.css` + layout),
  `src/app/fonts/` (new — self-hosted OFL faces + `@font-face`),
  `index.html` (font preload), `src/app/App.tsx` (three-region shell +
  overlay host), `src/app/Overlays.tsx` (new — single overlay manager:
  open/close state, focus trap, Esc, one overlay at a time),
  `dev/type-specimen.html` (new, uncommitted-or-dev-only is fine)
- **Does:** CSS custom-property tokens (surfaces, ink, accent, lamp-warm);
  dark lamplit default + light parchment theme, both designed to AA
  (contrast-check the token pairs with a small script in the task, record
  the ratios in the commit); serif narration + mono command faces
  self-hosted and subsetted (`font-display: swap`); the three-region shell
  per ui-plan §3 with the existing panels rehomed unstyled-but-placed;
  **type specimen page → stop, human picks the faces** (ui-plan §12.1),
  then pin them.
- **Acceptance:** gate green; dev-server smoke shows both themes switching
  (temporary toggle is fine until T2); specimen signed off; contrast ratios
  recorded; existing play flow (type, click, save) still works.
- **Commit:** `feat(ui): design tokens, dual themes, typography, and the app shell`
- **Deps:** none

---

**T2 — Settings panel and the persistence layers** · `sonnet`

- **Files:** `src/app/uiState.ts` (new — versioned `cave.settings` +
  `cave.<id>.ui.*` sidecar, tolerate-and-reset), `src/app/SettingsPanel.tsx`
  (new), `src/app/App.tsx` (settings context/provider wiring),
  `tests/app/uiState.test.ts` (new)
- **Does:** global settings — theme (dark/light/system), text size (3
  steps), transcript-only, motion toggle, typewriter speed (instant
  default); per-adventure sidecar scaffolding (onboarding-seen, journal
  notes, hardcore flag — consumed by later tasks); settings applied live
  via tokens; headless tests for persistence/migration-reset.
- **Acceptance:** gate green incl. new tests; settings persist across
  reload; transcript-only hides the scene region; text size and theme apply
  everywhere.
- **Commit:** `feat(ui): settings panel with global and per-adventure persistence`
- **Deps:** T1

---

### Phase 2 — Core play surfaces

---

**T3 — Transcript and input upgrades, shortcuts** · `sonnet`

- **Files:** `src/app/TranscriptPanel.tsx`, `src/app/CommandInput.tsx`,
  `src/app/useKeyboard.ts`, `src/app/App.tsx` (shortcut→overlay routing)
- **Does:** typed-event stylings (`hint`/`score`/`achievement`/`death`
  quiet-distinct; commands mono with `>`), `aria-live="polite"`,
  typewriter reveal honoring speed setting + reduced-motion; autocomplete
  dropdown from the engine's `suggestions()` (keyboard navigable; history
  already exists); FR-2.8 shortcuts (`m j i l ? Ctrl+S`) routed through the
  T1 overlay manager, suppressed while typing in the input.
- **Acceptance:** gate green; smoke: suggestions never offer `kibble`/
  `gunnis` (already engine-enforced — just observe it), shortcuts open the
  right overlays (stub panels acceptable for ones not yet built), screen
  reader announces new turns.
- **Commit:** `feat(ui): transcript event styling, autocomplete, and keyboard shortcuts`
- **Deps:** T2

---

**T4 — The auto-map** · `opus` · **parallel-safe with T5**

- **Files:** `src/app/mapLayout.ts` (new — pure), `src/app/MapOverlay.tsx`
  (new — SVG render), `tests/app/mapLayout.test.ts` (new)
- **Does:** ui-plan §4 in full: compass-honoring deterministic layout walked
  from `startLocation` with collision nudging; visited nodes, edges between
  visited pairs, unexplored-exit stubs; **the maze cloud rule** — identical
  `(full, brief, artId)` triples collapse; a member renders distinct only
  while it currently holds a portable item; twisty-5 distinct by its
  draught sentence. Current-position marker; visited count. Headless tests
  drive the rule against the real hollowdeep module: cloud forms after
  entering the maze bare, a dropped item splits its room out, retrieving it
  re-collapses, the map never renders un-visited structure.
- **Acceptance:** gate green incl. map tests against BOTH modules (test-cave
  has its own two twisties); smoke: map overlay on `m`, walk the hollowdeep
  spine's first legs and watch it grow.
- **Commit:** `feat(ui): auto-map with the maze-safe cloud rule`
- **Deps:** T3. Files disjoint from T5.

---

**T5 — Scene panel: preloading, flicker, dark states** · `sonnet` · **parallel-safe with T4**

- **Files:** `src/app/ScenePanel.tsx`, `src/app/preload.ts` (new),
  theme/layout css touched only in scene-panel scopes
- **Does:** preload exit-adjacent locations' art on arrival (NFR-3's
  <200 ms swap); lamplight flicker as a gradient-overlay CSS animation
  (never transforms on the image), gated by motion setting +
  reduced-motion; lamp-state tint; graceful no-image dark state (already
  exists — keep it); transcript-only collapse (T2's setting) verified here.
- **Acceptance:** gate green; smoke: walking any exit swaps art without
  visible load at dev-server speeds (network tab shows preloads), flicker
  off under reduced-motion.
- **Commit:** `feat(ui): scene art preloading and ambient lamplight`
- **Deps:** T3. Files disjoint from T4.

---

### Phase 3 — Flows

---

**T6 — Death modal, hardcore, undo** · `opus`

- **Files:** `src/app/DeathModal.tsx` (new), `src/app/useGame.ts` (undo
  retention + death interception + hardcore gating), `src/app/SaveDialog.tsx`
  (hide autosaves mid-run in hardcore), `src/app/uiState.ts` (hardcore flag
  read), `tests/app/undo.test.ts` (new, headless)
- **Does:** ui-plan §5: on the `death` OutputEvent (non-hardcore) offer
  *accept reincarnation* vs *resume from before the fall* (newest autosave
  preceding the death — the ring is written every turn, so this is a load);
  per-death **vignette slot** keyed off the death messageId →
  `marquee-death-*` file, placeholder-tolerant until Phase B lands;
  hardcore: no modal, no undo, autosaves written but hidden mid-run;
  `undo` intercepted above `step()` (one prior GameState retained,
  disabled at turn 0, after game over, and in hardcore). Headless tests for
  retention/gating matrix.
- **Acceptance:** gate green incl. tests; smoke: die in the chute → modal
  with both paths working; hardcore run shows no modal and refuses `undo`
  with a wry UI-side line.
- **Commit:** `feat(ui): death rescue flow, hardcore mode, single-step undo`
- **Deps:** T4, T5 (App overlay + scene stable)

---

**T7 — Journal and hints panels** · `sonnet` · **parallel-safe with T8**

- **Files:** `src/app/JournalPanel.tsx` (new), `src/app/HintsPanel.tsx`
  (new), `src/app/journal.ts` (new — pure derivation),
  `tests/app/journal.test.ts` (new)
- **Does:** journal *Log* tab derived purely from GameState (milestones,
  treasures carried/banked, achievements, deaths, hint rungs — rebuildable
  from any loaded save); *Notes* tab in the sidecar; hints panel per
  ui-plan §6 — revealed rungs grouped by ladder (titles prettified from
  hint ids), one "Take the next hint (−5 points)" button submitting `hint`
  through the input path, `noHintMessageId` line when nothing is available.
- **Acceptance:** gate green incl. journal tests (derivation against a
  mid-walkthrough hollowdeep state); smoke: rungs appear in the panel after
  `hint`, notes persist across reload, log rebuilds after loading a save.
- **Commit:** `feat(ui): journal and hints panels`
- **Deps:** T6. Files disjoint from T8.

---

**T8 — Save dialog: metadata, thumbnails, export/import** · `sonnet` · **parallel-safe with T7**

- **Files:** `src/app/SaveDialog.tsx`, `src/app/storage.ts` (slot metadata
  envelope — UI-side wrapper around the engine save payload, versioned),
  `tests/app/storage.test.ts` (extend/new)
- **Does:** slot cards gain timestamp, location name, score, scene-art
  thumbnail (the artId string captured at save time); slot delete
  confirm; **export to file / import from file** — the full slot payload
  as a download/upload, imports routed through the engine's load path so a
  version mismatch surfaces the typed `SaveError` in the dialog (FR-5.3/5.4:
  clear message, never silent corruption). The envelope wraps the engine
  save without touching its format — engine `SAVE_VERSION` untouched.
- **Acceptance:** gate green incl. storage tests (envelope round-trip, a
  corrupted import surfaces the error string); smoke: save/export/import
  across the two adventures never crosses namespaces.
- **Commit:** `feat(ui): save metadata, thumbnails, and file export/import`
- **Deps:** T6. Files disjoint from T7.

---

### Phase 4 — Framing and closeout

---

**T9 — Adventure select and the new-game flow** · `opus`

- **Files:** `src/app/AdventureSelect.tsx` (new), `src/app/App.tsx`
  (front-door routing; `?adventure=` becomes the deep link),
  `src/app/uiState.ts` (hardcore set-at-new-game, locked)
- **Does:** ui-plan §7: landing screen listing the registry with title,
  blurb, cover art (marquee-title file, placeholder-tolerant),
  continue-from-autosave, per-adventure achievements progress; new-game
  flow owns the hardcore choice (locked thereafter — ui-plan §12.2); deep
  link skips the screen (T11's behavior preserved for dev).
- **Acceptance:** gate green; smoke: fresh browser lands on select, both
  adventures playable, continue resumes, hardcore chosen at start is locked
  (no settings path flips it mid-run).
- **Commit:** `feat(ui): adventure select and the new-game flow`
- **Deps:** T7, T8

---

**T10 — Help, onboarding, and the stats screen** · `sonnet`

- **Files:** `src/app/HelpPanel.tsx` (new), `src/app/Onboarding.tsx` (new),
  `src/app/StatsScreen.tsx` (new), `src/app/uiState.ts` (onboarding-seen)
- **Does:** help overlay (how to play, core verbs, shortcut table — content
  aligned with `docs/PLAYING.md`); first-run onboarding: 3–4 dismissible
  contextual tips (input, exits, map), once per browser, never forced;
  post-game stats on `game-over` after the epilogue: turns, score/rank,
  deaths, hints, treasures, map coverage (visited/58), achievements x/8,
  **the ending-A-only tease line** ("There is another way out." —
  ui-plan §12.4), replay/select buttons.
- **Acceptance:** gate green; smoke: `?` opens help; fresh profile sees
  tips once; finishing via the walkthrough script shows the stats screen
  with the tease (and an ending-B finish shows none).
- **Commit:** `feat(ui): help, onboarding, and the post-game stats screen`
- **Deps:** T9

---

**T11 — Accessibility, tablet, and performance pass** · `sonnet`

- **Files:** css/layout files, focused component touch-ups, `index.html`
- **Does:** keyboard-only full-flow audit (every overlay, every action);
  AA contrast verification in BOTH themes against the shipped tokens
  (script or axe pass — record results); tablet breakpoints (FR-3.8 [S]);
  reduced-motion audit across typewriter/flicker/overlay transitions;
  NFR-3: font subsetting verified, art lazy/preload behavior confirmed,
  first-interaction budget sanity-checked on a throttled profile.
- **Acceptance:** gate green; the audit's findings either fixed in-task or
  listed with reasons in the commit body; a keyboard-only hollowdeep town
  loop completes with no pointer.
- **Commit:** `fix(ui): accessibility, tablet, and performance pass`
- **Deps:** T10

---

**T12 — Integration smoke, docs, closeout** · `opus`

- **Files:** `docs/PLAYING.md` (shortcuts, map, hints panel, hardcore,
  undo, export), `README.md` (feature table, status), `docs/SCOPE.md`
  (Phase 3 exit criteria), `CLAUDE.md` (status header), `docs/ui-plan.md`
  (status → IMPLEMENTED)
- **Does:** full rendered-browser smoke: every overlay, both themes, both
  adventures, a death-and-rescue, an undo, an export/import round-trip, a
  hardcore refusal; then the closeout report — a per-requirement table
  demonstrating every [M] and surviving [S] (SCOPE Phase 3's exit
  criterion) with how each was verified; docs brought level.
- **Acceptance:** gate green; zero regressions in both walkthrough suites;
  docs consistent with shipped reality.
- **Commit:** `docs: Phase 3 closeout — the UI is the product now`
- **Deps:** T11

---

## Cross-task notes for the orchestrator

1. **T1 blocks on the type specimen** — a human checkpoint on day one; have
   the specimen ready in the first working session.
2. **Two parallel pairs only:** T4∥T5 and T7∥T8, both with disjoint files;
   everything else is serial through `App.tsx`/`uiState.ts` contention.
3. **Undo vs autosave interaction** (T6): the autosave ring writes every
   turn; undo restores the prior state but must NOT rewrite history —
   define: undo does not touch storage; the next real turn autosaves as
   normal. State it in the code comment; test it.
4. **The death→vignette map** (T6) keys off death messageIds — hollowdeep
   has eight, test-cave has its own; missing vignette files fall back to no
   image, silently. Phase B may land before, during, or after this plan.
5. **Save-envelope discipline** (T8): the engine save payload is opaque to
   the UI — wrap, never reach inside; migrations remain the engine's.
6. **The walkthrough suites are the canary**: any UI change that breaks
   them has touched something it must not have.

## Progress Tracker

- [x] T1 — Tokens, themes, typography, shell (`opus`, human) — `8ad9187` (faces pinned: Literata + JetBrains Mono; fonts in `public/fonts/` for preload, see commit body)
- [x] T2 — Settings + persistence layers (`sonnet`) — `35fee75`
- [x] T3 — Transcript/input upgrades, shortcuts (`sonnet`) — `314eecb`
- [x] T4 — Auto-map (`opus`) — `3cf6d96` (also adds `.claude/**` ignores to eslint/vitest for orchestration worktrees)
- [x] T5 — Scene panel: preload, flicker (`sonnet`) — `81180dc` (+ `91770fe` wiring the lampWarn prop through App.tsx)
- [x] T6 — Death modal, hardcore, undo (`opus`) — `ba34fea` (vignette contract: `marquee-death-<messageId minus '-death'>.webp` — Phase B names files to match)
- [x] T7 — Journal + hints panels (`sonnet`) — `a869969` (hints opens from a header button — FR-2.8 has no free key for it)
- [x] T8 — Save metadata + export/import (`sonnet`) — `8dab033` (named slots enveloped; the autosave ring stays raw engine saves forever)
- [x] T9 — Adventure select + new-game flow (`opus`) — `9c684ed` (blurbs are UI copy in the registry; hardcore locked via `setAdventureHardcore` written pre-mount)
- [x] T10 — Help, onboarding, stats (`sonnet`) — `77640ff` (onboarding is per-adventure; ending-A tease gated on the `the-full-ledger` achievement)
- [x] T11 — Accessibility/tablet/perf pass (`sonnet`) — `5c57135` (added `data-reduce-motion` app-wide signal; 860px tablet stack breakpoint)
- [ ] T12 — Integration smoke + docs closeout (`opus`)

**Done when:** every box is ticked with its commit SHA, `npm run gate` is
green on `feat/ui` with both walkthrough suites untouched, the closeout
report demonstrates every [M] and surviving [S] requirement, and
`docs/ui-plan.md` is marked IMPLEMENTED. Merging is the human's call.
