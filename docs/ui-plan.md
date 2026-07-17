# Phase 3 — UI/UX Design Plan

**Status:** DRAFT — for review (2026-07-17). Visual identity, the [C]
inclusions, and every mechanic sketched below are settled (decisions logged in
§1); nothing here is blocked on Phase B — the two tracks merge in either order
(`docs/art-plan.md` §7 is the one coordination point).
**Phase:** 3 (SCOPE §3). Blocks: v1.
**Settled by:** [PROJECT-BRIEF.md](PROJECT-BRIEF.md) §9 (hybrid input, clicks
echo commands, v1 silent), [REQUIREMENTS.md](REQUIREMENTS.md) — the MoSCoW
tags are the scope contract.
**Branch:** `feat/ui` once READY; `/impl-plan` turns this into the task graph.

This is the WHAT/WHY for replacing the Phase 1 "minimal wiring UI" (14 files,
~1,200 lines, plain on purpose) with the real thing. The engine is done and
**stays untouched** — §2 verifies every feature below against what the engine
already exposes, and none needs an engine change. React remains presentation
only.

---

## 1. What is already decided

| | |
|---|---|
| **Hybrid input** | Parser AND clickable exits/context verbs; every click echoes its command into the transcript (FR-2.7, built) |
| **v1 ships silent** | FR-3.9 [W] — no audio work anywhere in this plan |
| **No LLM input** | FR-2.9 [W] |
| **Static-only** | No backend, no analytics, no third-party runtime (NFR-1) — fonts are self-hosted |
| **Transcript is first-class** | The game stays fully playable reading text alone (FR-3.2); everything below is addition, not replacement |

**Settled 2026-07-17 (this plan's Q&A):**

1. **Visual identity: dark default, book serif.** The default theme reads
   like a page by lantern light — deep warm dark surfaces, narration set in a
   readable book serif, player commands echoed in mono (the two voices of the
   transcript typographically distinct). A light "parchment" theme ships too;
   NFR-5 requires WCAG AA in both, so both are designed, not one derived.
   Fonts self-hosted (NFR-1); pick workhorses with strong italics (narration
   leans on tone) — candidates: Literata / Source Serif 4 + a matching mono.
2. **[C] inclusions:** ambient art motion (FR-4.6), post-game stats (FR-7.3),
   and single-step undo (FR-1.11) are **in**. Phone layout stays out
   (tablet [S] is the floor, per FR-3.8); PWA install stays out (NFR-6's [C]
   half); offline-after-first-load must still hold (its [S] half — static
   assets, no hard runtime network dependency).
3. **Adventure select replaces the query param as the front door** (FR-6.4) —
   the `?adventure=` param survives as a deep link that skips the screen.

## 2. Engine surface audit — why this plan needs zero engine changes

Checked against the shipped engine, not assumed:

| Feature | Engine surface it consumes |
|---|---|
| Hints panel | `GameState.hintsRevealed: Record<hintId, rungsRevealed>` — added at SAVE_VERSION 2 *explicitly for this panel* (types.ts §note); rung text re-read from `hints.json`; the `hint` OutputEvent carries `hintId` + `rung` |
| Auto-map | `GameState.visited` + module exits; maze collapse rule is derivable (§4) |
| Death-rescue flow | The autosave ring (5 entries, every turn) already exists; "resume from before the fall" is a load, not a mechanic |
| Undo | `step()` is pure — the previous `GameState` is undo; retain one |
| Stats screen | `turn`, `deaths`, `hintsUsed`, `visited`, `achievements`, `scoredCarry/Deposit`, `ended.rank` — all in `GameState` |
| Journal auto-entries | Derivable from `GameState` (milestones, achievements, deposits) — no new event log needed; free-text notes are UI-side |
| Suggestions | `suggestions()` exists and already refuses magic words (FR-1.9, test-covered) |
| Save thumbnails | The scene `artId` at save time — store the string, render the image |
| Art format | `manifest.artFormat` — already consumed by ScenePanel |

If implementation discovers this table is wrong somewhere, that is a
stop-and-report, not a license to patch the engine from a UI branch.

## 3. Layout — the three-region shell

Desktop-first (NFR: tablet usable, FR-3.8):

- **Scene region** (top or left): the illustration (FR-3.1) with location
  name, lamp-state tint, and exit indicators. Ambient motion (decision 2): a
  slow lamplight flicker as a CSS filter/opacity animation on a gradient
  overlay — *never* transforms on the image itself — honoring
  `prefers-reduced-motion` and the settings toggle (FR-4.6).
- **Transcript region** (center): the scrollable stream; narration serif,
  commands mono-prefixed with `>`; `hint`/`score`/`achievement`/`death`
  OutputEvent kinds get distinct quiet stylings (they are already typed —
  presentation only). `aria-live="polite"` for screen readers (NFR-5).
- **Action region** (bottom/right): command input with autocomplete +
  history (FR-2.6: dropdown from `suggestions()`, ↑/↓ history), exit
  compass, context-verb buttons, inventory with thumbnails (FR-3.3).
- **Status bar** (FR-3.5): location, score/max, turn, lamp gauge (fraction of
  `startFuel`, warning states at the manifest's `warnAt` thresholds).
- **Overlays** (all focus-trapped, Esc-dismissable, keyboard-reachable):
  map, journal, hints, settings, save/load, help. Shortcuts per FR-2.8:
  `m` map, `j` journal, `i` inventory focus, `l` look, `?` help,
  `Ctrl+S` save — listed in the help panel.

Transcript-only mode (FR-3.7) collapses the scene region entirely — the
classic experience as a first-class setting, and the cheap proof the game
never depends on the picture.

## 4. The auto-map (FR-3.4) — the one real design problem

**Data:** nodes are `GameState.visited` locations; edges are the module's
exits where both ends are visited; unexplored exits from visited rooms render
as stubs ("hinted"). Layout is compass-honoring (n is up; ne is up-right),
computed by walking the exit graph from the start location with collision
nudging — deterministic, no physics simulation, so the map never wiggles.

**The maze rule.** FR-3.4: the map must not solve the maze for free. The
mechanic, derived from module data with no schema addition:

> Visited locations whose `(full, brief, artId)` triple is identical to
> another visited location's collapse into a single **cloud node** ("twisting
> passages, all confused") with an edge-count badge. A member of the cloud
> renders as its own distinct node **only while it currently contains a
> portable item** — i.e., while the player has marked it, the classic way.

This is live-derived and stateless: drop-marking literally draws the map,
picking your markers back up dissolves it again, and the intended
solution (the draught room) never needed the map at all. twisty-5's appended
draught sentence makes its triple distinct, so the draught room maps once
visited — deliberate: the map remembers what the *prose* already
distinguished, and nothing more.

Current position marker, visited-count in the corner (feeds the stats
screen's "map coverage"). The map opens as an overlay (`m`), renders SVG
(crisp at any zoom, trivially styleable per theme).

## 5. Death, hardcore, and undo (FR-1.6, FR-1.11)

- **Death modal.** On the `death` OutputEvent (non-hardcore): "The cave has
  seen this before." → **Accept reincarnation** (the engine already did it —
  dismiss and read on) or **Resume from before the fall** (load the newest
  autosave preceding the death). The engine's classic-reincarnation behavior
  is untouched; the modal is a choice between two states that both already
  exist.
- **Hardcore mode** (settings toggle, per adventure, set at game start and
  locked thereafter): no death modal (reincarnation is what you get), undo
  disabled, autosaves still written (resume-after-tab-close is not a rescue)
  but the load UI hides them mid-game. Matches FR-1.6's "disables
  autosave-rescue" reading exactly.
- **Undo** (non-hardcore): retain the single previous `GameState`; `undo`
  as a UI affordance and input keyword handled *above* the engine (it is not
  a parser verb and never reaches `step()`), one step only, disabled at
  turn 0 and after game over.

## 6. The panels

- **Journal (FR-3.6):** two tabs. *Log* — auto-entries derived from
  GameState deltas the UI observes per turn (milestones awarded, treasures
  carried/banked, achievements, deaths, hint rungs), rendered as a dated-by-
  turn list; derivation is pure, so loading any save rebuilds the log to
  that state honestly. *Notes* — free text, UI sidecar (§8).
- **Hints (FR-7.2 UI):** shows revealed rungs grouped by ladder (titles
  derived from hint ids — `office-lock` → "Office Lock"; ids were named for
  this), and one button: "Take the next hint (−5 points)" which submits the
  `hint` command through the normal input path — the panel is a *view* of the
  verb, never a second hint mechanic. Nothing unrevealed is ever listed —
  availability lives engine-side, and an empty panel shows the adventure's
  `noHintMessageId` line.
- **Settings (FR-3.7):** text size (3 steps), theme (dark/light/system),
  transcript-only, motion toggle, typewriter speed (instant default — the
  narration-speed ask, implemented as reveal speed), hardcore (new games
  only). Persisted globally, not per adventure (§8).
- **Save/Load (FR-5.1, FR-5.4):** the existing 5+5 slot model gains
  timestamp, location name, score, and a thumbnail (the scene `artId` stored
  in the slot metadata at save time); slot delete; **export to file /
  import from file** — the versioned save JSON as a download/upload, run
  through the same `SaveError` migration path as localStorage loads (typed
  errors surface in the dialog, never silent corruption).
- **Help & onboarding (FR-7.1):** help panel (how to play, core verbs,
  shortcuts — content largely lifted from `docs/PLAYING.md`); first-run
  onboarding as 3–4 dismissible contextual tips (anchored to input, exits,
  and the map button), shown once per browser, never a forced tutorial.
- **Post-game stats (FR-7.3):** on `game-over`, after the epilogue clears:
  turns, score/rank, deaths, hints used, treasures banked, map coverage
  (visited/58), achievements earned vs total, and the two-endings tease
  ("There is another way out." — shown only on ending A, and only as a
  hidden-achievement-shaped nudge). Replay / adventure-select buttons.

## 7. Adventure select & marquee art (FR-6.4)

A landing screen listing the known adventures (the T11 registry, now with
title, blurb, and cover art — Hollowdeep's `marquee-title` from Phase B, or
its placeholder until then), continue-from-autosave if one exists, and per-
adventure achievement progress. `?adventure=` deep-links past it. Ending
screens use the marquee epilogue art when present (art-plan §7: files may
land before their screens or after — both orders work, placeholders cover
the gap).

## 8. State layering & persistence

Three layers, strictly separated:

1. **GameState** — the engine's; saved via the existing versioned system.
   Nothing UI-side ever writes into it.
2. **UI sidecar, per adventure** — journal notes, onboarding-seen,
   per-adventure hardcore default: `cave.<id>.ui.*` keys beside the saves.
3. **Global settings** — theme, text size, motion, typewriter:
   `cave.settings`.

Sidecar and settings are plain JSON with a version field and a
tolerate-and-reset migration posture (losing a note on a bad migration is
acceptable; losing a *save* never is — which is why saves keep their real
migration registry and the sidecar does not share it).

## 9. Accessibility & performance (NFR-3, NFR-5)

- Fully keyboard playable stays true through every new overlay: focus traps,
  Esc closes, shortcuts never fire while the input has focus and a
  non-shortcut context.
- Transcript `aria-live`; art alt text remains the scene `brief` (already
  wired); WCAG AA verified in **both** themes as a checked deliverable, not
  an intention.
- `prefers-reduced-motion` kills the flicker, typewriter, and any overlay
  transitions.
- Scene swap < 200 ms: preload the art of every exit-adjacent location on
  arrival (NFR-3); lazy-load everything else. First playable < 3 s: fonts
  subsetted + `font-display: swap`, art lazy, no new dependencies of
  consequence.

## 10. Explicitly out of scope

| Item | Why |
|---|---|
| Phone layout | FR-3.8 keeps it [C]; decision 2 leaves it out — tablet is the floor |
| PWA/installability | NFR-6 [C] half; offline-after-load must still hold |
| Audio | FR-3.9 [W] |
| LLM input | FR-2.9 [W] |
| Engine changes of any kind | §2 — a discovered need is a stop-and-report |
| New adventure content | The fixture and Hollowdeep are done; UI only |

## 11. Deliverables & exit criteria

1. The shell (§3), both themes, both input paths, transcript-only mode.
2. Auto-map with the maze rule (§4), demonstrably not solving the maze.
3. Death modal + hardcore + undo (§5) with tests for the hardcore matrix.
4. All six panels (§6) and the adventure select (§7).
5. Preloading + reduced-motion + AA contrast verified (§9).
6. Docs: `PLAYING.md` updated (shortcuts, map, hints panel, hardcore);
   `README.md` feature table; SCOPE Phase 3 ticked.

**Exit (SCOPE):** all [M] and surviving [S] requirements demonstrably met —
demonstrated per-requirement in the closeout report, with the walkthrough
suite and the full gate green throughout. Component/interaction tests run
headless (the engine suite stays untouched); a rendered-browser smoke pass
covers the overlays and both themes.

## 12. Assumptions for the human to confirm

1. **Self-hosted Literata (or Source Serif 4) + matching mono** is an
   acceptable typographic direction — pinned during the first styling task
   with a one-page type specimen, same sign-off pattern as the art suffix.
2. **Hardcore is set at new-game and locked** (§5) — not toggleable
   mid-run. FR-1.6 doesn't say; locking is what makes the no-rescue promise
   mean something.
3. **The undo keyword is UI-level** (§5), so `undo` never enters transcripts
   or walkthroughs and the engine's determinism story is untouched.
4. **Stats screen's ending tease** (§6) — one line, ending-A only. Say so if
   even that much signposting of ending B is unwelcome.
