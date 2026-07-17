# Hollowdeep Implementation Plan — Authoring the Adventure

**Status:** READY (2026-07-17) — **blocked on the hints + timers engine work**
(see Preconditions). Do not `/run-plan` until that lands.

Execution plan for [`docs/hollowdeep-plan.md`](hollowdeep-plan.md) (the
WHAT/WHY); rules live in
[`docs/orchestration-playbook.md`](orchestration-playbook.md).

This is a **content plan**: every task except T11 and T12 writes JSON under
`adventures/hollowdeep/` and tests. If a task finds itself wanting to edit
`src/engine/**`, that is a format gap — stop and raise it (module-format.md's
own rule), don't patch around it.

---

## Kickoff

A fresh Opus session should execute this with:

```
/run-plan docs/hollowdeep-implementation-plan.md
```

If starting cold without the slash command: read
[`docs/hollowdeep-plan.md`](hollowdeep-plan.md) (the design — §11 and §12 are
the build spec), [`docs/module-format.md`](module-format.md) (the format
contract), [`docs/orchestration-playbook.md`](orchestration-playbook.md)
(Rules of Engagement, model policy, gate) and this file, then execute the task
graph in order — one subagent per task at the task's model, review the diff,
run the gate yourself, commit, tick the tracker, repeat. Never commit red. The
Progress Tracker at the bottom is the source of truth for resuming.

### Preconditions — verify before T1, stop if any fails

The design plan (status block, §10.2, §10.3) makes the hints + timed-events
engine work a **prerequisite with its own design plan and `/run-plan`**. As of
2026-07-17 none of it exists. Before touching T1, verify all of:

1. `src/engine/schema/effects.ts` has a `startTimer` variant (13th effect) and
   `src/engine/schema/event.ts` a `timerExpired` trigger;
2. `src/engine/schema/conditions.ts` has `hintsAtMost`;
3. the loader accepts a hints document (11th module document) and
   `scoring.json` accepts `hintPenalty`;
4. `src/engine/save.ts` exports `SAVE_VERSION = 2` (or later) with a real
   1 → 2 migration covering `GameState.timers` and `hintsUsed`;
5. the `hint` core verb ships in `src/engine/parser/vocab.ts`;
6. `npm run gate` is green on `main` and test-cave still validates.

If any check fails, report "blocked on the hints/timers engine plan" and stop.
Where this plan references the hints document's exact field names, **the hints
engine plan's schema is authoritative** — read it before T1 and T8.

## Scope & branch

**Branch:** `feat/hollowdeep`, from `main` (after the prerequisite work has
merged).

**In scope:** design plan §3–§9, §11, §12 in full — the complete
`adventures/hollowdeep/` module (11 documents + placeholder art), its hint
ladders, its walkthrough + multi-seed test, content integration tests
(ending B, the eight deaths, the thief detour), minimal app wiring so
`npm run dev` plays it, and docs closeout.

### Deferred / out of scope

| Item | Reason |
|---|---|
| Hints + timers **engine** work (§10.2/§10.3: `startTimer`, `timerExpired`, `hintsAtMost`, `hints` document, `hint` verb, `SAVE_VERSION 2`) | Prerequisite with its own design plan and `/run-plan`; this plan is blocked on it, not tasked with it |
| Real painterly art (WebP/AVIF, FLUX pipeline) | Phase B art plan; this plan ships placeholder SVGs (`manifest.artFormat: "svg"`) exactly as test-cave did pre-Phase-B |
| Hints **UI** panel, auto-map, journal, adventure-select screen, settings | Phase 3 UI plan (T11's `?adventure=` query param is a dev convenience, not the select screen) |
| Save export/import to file (FR-5.4) | Phase 3 |
| Cutting flabby rooms (§11.6 names `low-crawl`, `deep-cut`, `worked-face` as cuttable) | Only if authoring proves a region flabby — a task may propose it, the orchestrator decides; not pre-tasked |

## Standing rules (apply to every task)

1. **The validate glob is merciless.** `npm run gate` validates `adventures/*`,
   so `adventures/hollowdeep/` must be a *complete, schema-valid,
   consistency-clean* module from its very first commit. That is why T1 is a
   full skeleton rather than one document. No task may leave the module
   half-wired at its commit boundary.
2. **Every new `artId` ships its placeholder in the same commit** — the
   validator's `missing-art-file` check runs per commit. Regenerate with
   `npx tsx tools/gen-placeholder-art.ts adventures/hollowdeep` (idempotent;
   already parameterized).
3. **All prose is original.** The `borrowed-source-text` check is a backstop,
   not a license: if it fires, rewrite the line — never edit the phrase list.
   Voice per design plan §3: dry, wry, aimed at the player's *choices*; the
   horror is tidiness, not portent.
4. **No `chance` anywhere in Hollowdeep content** (design plan §12.9.1). The
   only RNG in the game is the stalker's roll (warded on the winning path) and
   the engine's darkness roll (lit on the winning path). This is what makes
   T9's every-seed assertion satisfiable — treat a `chance` field in any
   authored document as a review-rejection.
5. **The 350 is frozen arithmetic** (design plan §7): 12 treasures at
   15/25/40 by tier (= 320) + milestones 5 + 9 + 15 + 1 (= 30). T1 lands the
   whole table; later tasks must not touch point values without stopping —
   `max-score-mismatch` will refuse the module, and the fix is never "adjust
   maxScore to whatever sums".
6. **Model note:** prose-bearing content tasks run on `opus`, deliberately —
   in a text adventure the narrator's voice *is* design-sensitive surface, the
   thing the brief calls out, and the playbook's "bulk implementation" clause
   does not cover it. Mechanical transcription and tests run on `sonnet`.

---

## Task graph

### Phase 1 — Skeleton

---

**T1 — Module skeleton: the whole structure, none of the voice** · `sonnet`

- **Files:** `adventures/hollowdeep/manifest.json`, `locations.json`,
  `items.json`, `creatures.json`, `events.json`, `strings.json`,
  `vocabulary.json`, `scoring.json`, `achievements.json`, `walkthrough.json`,
  the hints document (name/shape per the hints engine plan), `art/*.svg`
- **Does:** transcribe the design plan's tables into a complete, valid module
  with **placeholder prose** (one flat sentence per `brief`/`full`/
  `description` — clearly marked draft, e.g. prefixed `[draft]`, so no
  placeholder survives to T12 unnoticed):
  - `manifest.json`: id `hollowdeep`, title `Hollowdeep`, `startLocation:
    coach-road`, `repositoryLocation: assay-office`, `carryLimit: 5` (§12.9.3),
    `maxScore: 350`, `artFormat: "svg"`, `lamp` = `brass-lantern`, generous
    `startFuel` (placeholder; T9 tunes it to ≥ 2× the walkthrough spine),
    refuel = `oil-flask` consumed, warn/exhaust/darkness message ids.
  - `locations.json`: **all 58 rooms of §11** — ids, exits, exit guards
    (`pump-drained`, `breach-blasted`, `mechanism-turned`, `gunnis-known`),
    `hidden` exits (tailings-path nw, breach-wall e), `oneWay` where §11
    implies none (don't invent), `light: "dark"` everywhere below the adit
    mouth **except** `behind-the-seal` and `the-gunnis`, maze wiring exactly
    per the §11.3 table including the bold self-loops.
  - `items.json`: all 12 treasures with the §7 tier points; all §12.8 support
    items and scenery (stull, rubble, foreman, chute, pump, breach wall,
    mechanism door, vault, memorial board…); `initialLocation: "nowhere"` for
    every hidden-until-searched item (button, watch, tally book, magazine key,
    tally plate, garnets-in-rubble path).
  - `creatures.json`: stalker, thief, and the four statics, parameterized
    exactly per §12.3 (thief: no `aggression` — the schema refuses it;
    `stashLocation: midden`).
  - `events.json`: only the **wiring events** validation needs — the four gate
    chains (§12.1) and the GUNNIS reveal — with draft `print` text; enough
    that `unwritten-flag-read` and the dangling-reference checks all pass.
    Region tasks replace/extend these.
  - `vocabulary.json`: `pull`, `pry`, `oil`, `fit`, `light`, `seal` as `use`
    synonyms (the §12 idiom); noise words; magic words `kibble` and `gunnis`
    wired to their (draft) events.
  - `scoring.json`: the full §7 milestone table (`enter-the-cave` 5,
    `reach-the-breach` 9, `past-the-seal` 15, `last-lousy-point` 1),
    `deathPenalty`, `hintPenalty` (per the hints plan), and a draft rank
    ladder (§12.6 rungs; the two top titles are T7's).
  - `achievements.json`: the eight §12.7 ids with draft descriptions.
  - `walkthrough.json`: a **stub** — a handful of parseable commands and
    `expectedScore: 350` (validate only parses commands; the score is asserted
    by T9's test, which does not exist yet).
  - hints document: minimal valid per its schema (T8 authors the real ladders).
  - Placeholder art for every artId (standing rule 2); the six maze rooms
    share one `artId` (§9).
- **Ambiguity rule:** where §11/§12 underspecifies a mechanical detail, pick
  the test-cave precedent and note it in the commit; where the *design* is
  ambiguous, stop and ask the orchestrator.
- **Acceptance:** `npm run validate` passes on `adventures/hollowdeep`
  (all 58 locations reachable, 350 reconciles, no dangling ids, no unwritten
  flags); `npm run gate` green; test-cave still validates.
- **Commit:** `feat(content): add hollowdeep module skeleton — 58 rooms, 12 treasures, 350 points`
- **Deps:** preconditions

---

### Phase 2 — Voice and chains, region by region

Each task replaces its region's draft prose with the real thing (rooms, items,
strings) and builds its puzzle chains to the §12 spec. **These tasks all edit
the same JSON documents and are strictly serial.** Each leaves zero `[draft]`
markers inside its own region.

---

**T2 — Region A: Weir's Landing** · `opus`

- **Files:** `adventures/hollowdeep/locations.json`, `items.json`,
  `creatures.json`, `events.json`, `strings.json` (region A entries)
- **Does:** the seven surface rooms of §11.1 in full voice. The chapel key
  under the memorial board; the storekeeper and the canary-on-credit (§6 —
  how the player gets it, in character); the assay-office lock chain (T3's
  treasure: key → `open` → `search` bench → button, §12.2 #3); the repository
  deposit events including the `on-the-books` achievement (first treasure
  banked — per-treasure `drop` events at `assay-office`, §12.7); the
  `enter-the-cave` milestone fires on `visited: behind-the-seal` (already in
  scoring.json from T1 — verify, don't duplicate).
- **Acceptance:** gate green; playing by hand (`npm run dev`): town walkable,
  office opens with the chapel key, button banks, canary purchasable; no
  `[draft]` remains in region A.
- **Commit:** `feat(content): write Weir's Landing — the town, the office, the canary`
- **Deps:** T1

---

**T3 — Region B: the Workings** · `opus`

- **Files:** same documents (region B entries)
- **Does:** the sixteen rooms of §11.2 in full voice, plus:
  - **T1 payroll tin** — findable, no puzzle (the ten-minute clock, §12.2 #1);
  - **T2 garnets** — the full timer chain (§12.2 #2): `use`("pull") stull →
    `startTimer roof-fall 6`; two `timerExpired` events (present → `die`;
    absent → `roof-fallen` + print); `search` rubble recovery. This is the
    first timer content the engine has ever run — if the semantics surprise,
    that is a finding for the hints/timers plan, not something to work around;
  - **T4 watch + tally book** on the foreman under `search` (§12.2 #4);
  - the **pump gate** chain finished in voice (§12.1 B→C), `blockedMessage` =
    the black water;
  - the **magazine** (locked container door, keg + fuse, the *NOT WITHOUT A
    FUSE, DAVEY* label) and death #4 (light the unfused keg);
  - death #5 (ore chute, warn-then-die via `chute-warned`);
  - **KIBBLE scratched on the stull** in `long-drift` (`read` pays the word —
    the word events themselves are T6's).
- **Acceptance:** gate green; hand-check: stull → timer → death in room /
  survival outside / garnets from rubble; pump chain drains the winze; keg
  death telegraphed and fatal; no `[draft]` in region B.
- **Commit:** `feat(content): write the Workings — garnets under a timer, the pump gate, the magazine`
- **Deps:** T2

---

**T4 — Region C: the cavern, the maze, the creatures** · `opus`

- **Files:** same documents (region C entries)
- **Does:** the sixteen rooms of §11.3 in full voice, plus:
  - **the maze** exactly per the §11.3 table — five rooms verbatim-identical
    text, `twisty-5` appends the draught sentence ("the draught is coming from
    the east"), one shared `artId`, **T8 cache** in `twisty-6`;
  - **T5 flowstone** — `use`("pry") gad → take + `activateCreature stalker`
    (§12.2 #5); **T6 pearls** — `take` → `startTimer gour-flood 5`, expiry
    drowns if present (§12.2 #6); **T7 nugget** — gad frees it, wry refusal
    without (§12.2 #7);
  - **stalker** live: roams the four named C rooms only, warded by the carried
    canary; the canary quiet-warning `enter` events (`creatureAt` +
    `hasItem canary-cage`, §12.3); the cathedral echo foreshadow;
  - **thief** live: spawns on `visited: breakthrough`, steals once after
    `stealAfterTurns ≈ 25`, stash at `midden`; drag-marks prose, never a
    portrait; `everything-you-carried` achievement on entering the midden with
    stolen treasure there (OR-list of `itemAt`, §12.7);
  - death #6 (swim the Black River — warn once, then die; the fish telegraph);
  - the **breach blast** chain (§12.1 C→D) ending `teleport twisty-5` +
    `breach-blasted` + `revealExit`, and death #8's groundwork (stalker) plus
    death #1 (darkness) need no content — note that in the commit.
- **Acceptance:** gate green; hand-check: maze navigable per the table and by
  drop-marking; blast run works end to end; canary goes quiet in the right
  rooms; thief steals and the midden gives it back; no `[draft]` in region C.
- **Commit:** `feat(content): write the cavern and the maze — stalker, thief, and the blast run`
- **Deps:** T3

---

**T5 — Regions D & E: past the breach, and the seal** · `opus`

- **Files:** same documents (region D + E entries)
- **Does:** the nineteen rooms of §11.4–11.5 in full voice — this is where the
  fiction earns itself (§3: the strangeness is *specific*; the narrator
  remarks on the tidiness), plus:
  - **T9 bronze tool** (takeable; it is also the D→E key), **T10 tally**
    (`search` then `read` — the count given, the unit not), **T11 warm stone**
    (the canary sings in the warm gallery; nothing about that is reassuring),
    **T12 the kept thing** (take → its weight, and nothing else);
  - the **mechanism gate** (§12.1 D→E): `use`("fit") bronze tool →
    `mechanism-turned` ("It was not made for your hand. Your hand makes do.");
  - death #7 (jump the stair gap); the cistern's sluice-marks lore (`read` —
    the flood was somebody's drainage); the newt, ordinary, which is the joke;
  - the watch-room reveal prose — which way the seal faces, never the word.
- **Acceptance:** gate green; hand-check: mechanism needs the tool (and
  re-fetching a banked tool works); stair gap kills; all four Tier-3 treasures
  reachable and bankable; no `[draft]` in regions D/E.
- **Commit:** `feat(content): write past the breach and the seal — the mechanism, the vault`
- **Deps:** T4

---

**T6 — The magic words and the gunnis** · `opus`

- **Files:** `adventures/hollowdeep/events.json`, `locations.json`,
  `strings.json`, `vocabulary.json` (word entries)
- **Does:** §12.4 in full. **KIBBLE**: bidirectional `shaft-head` ⇄
  `shaft-foot` teleports, wry elsewhere-line; it legitimately bypasses the
  pump gate — verify the exit guard story still holds. **GUNNIS**:
  `broken-drift` ⇄ `the-gunnis`; first arrival sets `gunnis-known`, reveals
  the `tailings-path` nw scree (and the climb both ways — §11.6's
  reachability move); the gunnis prose (the older scar, closed from *this*
  side); `last-lousy-point` milestone on `visited: the-gunnis`; `the-answer`
  achievement (`enter`, `once`). Confirm neither word ever surfaces:
  suggestions/UI must not complete them (engine-enforced, FR-1.9 — assert it
  in T10's tests, note here).
- **Acceptance:** gate green; hand-check: both words work both ways and
  deadpan elsewhere; the scree exists both directions after first GUNNIS; the
  point and the achievement land once each.
- **Commit:** `feat(content): wire kibble and gunnis — the hoist word and the hidden gunnis`
- **Deps:** T5

---

**T7 — The endgame: two endings, ranks, remaining achievements** · `opus`

- **Files:** `adventures/hollowdeep/events.json`, `strings.json`,
  `scoring.json`, `achievements.json`, `items.json` (vault scenery)
- **Does:** §12.6–§12.7 in full:
  - **Ending A** — `once: true` `turnStart` event, guard = one `all` of twelve
    `itemAt(treasure, assay-office)`; epilogue `printId`; `award
    the-full-ledger`; `endGame` victory. It does not congratulate you, exactly.
  - **Ending B** — `use`("seal") on the vault scenery, guard = `all` of the
    eleven banked + `itemAt(the-kept, the-vault)`; epilogue; `award
    kept-the-seal`; `endGame` victory at 310.
  - Final **rank ladder** including the 310 and 350 titles, chosen so neither
    reads as simply "better" (an authoring deliverable, §12.6 — state the two
    titles in the commit body).
  - Remaining achievements wired: `unhurried` (ending events +
    `deathsAtMost: 0`), `nobody-asked` (ending events + `hintsAtMost: 0`),
    `the-bird-went-too` (`enter the-vault` + `hasItem canary-cage`).
- **Design-sensitive:** the ending-A guard is the module's largest condition
  and the endgame is the product's last impression. Check the interaction:
  ending A's `turnStart` guard must not fire during an ending-B run (it can't —
  `the-kept` is in the vault, not the office — but say so in a comment).
- **Acceptance:** gate green; hand-check both endings reachable and mutually
  exclusive; ranks land at 310/350.
- **Commit:** `feat(content): add the two endings, the rank ladder, and the endgame achievements`
- **Deps:** T6

---

### Phase 3 — Hints

---

**T8 — Author the hint ladders** · `opus`

- **Files:** the hollowdeep hints document, `adventures/hollowdeep/scoring.json`
  (`hintPenalty` final value), `strings.json` if the hints schema references it
- **Does:** FR-7.2 ladders (nudge → hint → solution) for every gate and every
  treasure chain T2–T7 built, plus the maze, the ward, and the two words —
  availability-guarded by condition (a hint for the breach must not exist
  before the player has found the magazine, etc.). The exact document shape
  comes from the hints engine plan — **read it first**. Every solution rung
  must describe an action the engine actually accepts (use the chains as
  written, not as remembered). Set `hintPenalty` so a full-hints run still
  clears 0 comfortably; state the arithmetic in the commit.
- **Why now:** design plan §12.9.5 — hints are written while the puzzles are
  fresh; that ordering is the entire reason the engine work blocked authoring.
- **Acceptance:** gate green; every puzzle/gate has a complete ladder; hint
  availability spot-checked in dev at three points of a playthrough.
- **Commit:** `feat(content): author hint ladders for every hollowdeep puzzle`
- **Deps:** T7

---

### Phase 4 — Walkthrough and integration tests

---

**T9 — The walkthrough, and the harness that plays it** · `opus`

- **Files:** `adventures/hollowdeep/walkthrough.json`,
  `adventures/hollowdeep/manifest.json` (`startFuel` tuning),
  `tests/walkthrough.test.ts` (generalize per-adventure)
- **Does:**
  - Author the full step-by-step walkthrough along the §12.10 spine, with the
    fuel-and-carry audit attached: every leg's inventory ≤ 5 with lamp +
    canary aboard (the blast run is the squeeze: lamp + canary + keg + fuse =
    4); one planned robbery and one midden detour; `expect` assertions on
    prose actually printed (never room names); `expectedScore: 350`,
    `expectedRank` = T7's top title, `expectedAchievements` = the canon set
    (per §12.10: `on-the-books`, `the-full-ledger`, `the-answer`,
    `everything-you-carried`, `unhurried`, `nobody-asked` — **not**
    `kept-the-seal`, **not** `the-bird-went-too` unless the spine carries the
    canary into the vault; decide and state it).
  - Tune `startFuel` to ≥ 2× the walkthrough's consumed turns, oil flask as
    the margin (§12.9.2); state both numbers in the commit.
  - Generalize `tests/walkthrough.test.ts` from its hardcoded test-cave path
    to a per-adventure harness driving **both** modules, hollowdeep at ≥ 5
    pinned seeds asserting identical outcome (350, rank, achievements,
    0 deaths, 0 hints).
- **Expect this to fight back** — T23's precedent, at 5× the content. It is
  the first end-to-end run of every chain, both timers, the thief detour, and
  the ward discipline. Fixing walkthrough data is in scope; fixing content
  bugs it surfaces is in scope; an engine bug is a stop-and-report; loosening
  an assertion is not in scope. A seed-dependent failure means something on
  the spine rolled a die — find the draw (standing rule 4 says there are only
  two possible sources: an unwarded stalker room or an unlit dark room).
- **Acceptance:** `npm run gate` green; hollowdeep walkthrough reaches 350/350
  with the top rank, the canon achievements, 0 deaths and 0 hints at ≥ 5
  pinned seeds; test-cave's walkthrough still passes unchanged.
- **Commit:** `test: author the hollowdeep walkthrough — 350/350 at every seed`
- **Deps:** T8

---

**T10 — Content integration tests: the branches the walkthrough doesn't take** · `sonnet` · **parallel-safe with T11**

- **Files:** `tests/hollowdeep.test.ts` (new)
- **Does:** scripted `step()` runs against the loaded hollowdeep module (the
  T9 harness's helpers may be shared):
  - **Ending B** end-to-end: eleven banked, `the-kept` left, `seal` → victory
    at 310, `kept-the-seal`, ending-B rank; and ending A does **not** fire;
  - each of the **eight deaths** (§12.5) fires under its condition, its
    telegraph precedes it, and the world stays winnable after resurrection
    (spot-check: the killed-in path to that region's treasure still closes);
  - both **timers**: expiry in-room kills, expiry elsewhere prints and (roof)
    leaves garnets recoverable from rubble;
  - the **thief** steals exactly once, everything lands in the midden, deposit
    points still award after recovery;
  - **KIBBLE bypasses the pump gate** (reach `shaft-foot` without
    `pump-drained`);
  - FR-1.9: `suggestions()` never completes `kibble`/`gunnis` at any prefix;
  - maze **connectivity as data**: every twisty room reachable from
    `twisty-1`, `breach-wall` only via `twisty-5`, per the §11.3 table.
- **Acceptance:** `npm run gate` green; all of the above asserted; no test
  stubs RNG (force by seed where a roll is unavoidable, test-cave style).
- **Commit:** `test: cover hollowdeep's deaths, ending B, the thief, and the maze`
- **Deps:** T9. Files disjoint from T11 (`tests/` vs `src/app/`).

---

### Phase 5 — App wiring and closeout

---

**T11 — Dev app loads Hollowdeep** · `sonnet` · **parallel-safe with T10**

- **Files:** `src/app/App.tsx`
- **Does:** replace the hardcoded `ADVENTURE_BASE_DIR = 'adventures/test-cave'`
  (App.tsx:24) with a `?adventure=<id>` query param, **default `hollowdeep`**
  — the game is now the game; the fixture stays reachable at
  `?adventure=test-cave`. No select screen, no chrome (Phase 3 owns that);
  validate the param against a hardcoded id list so a typo'd param shows the
  existing error boundary, not a fetch soup.
- **Acceptance:** `npm run gate` green; `npm run dev` opens on Weir's Landing;
  `?adventure=test-cave` still plays test-cave; save keys are already
  per-adventure (`cave.<id>.…`) so saves don't collide — verify, don't assume.
- **Commit:** `feat(app): load hollowdeep by default, test-cave via query param`
- **Deps:** T9

---

**T12 — Voice pass, docs, and closeout** · `opus`

- **Files:** `adventures/hollowdeep/strings.json` / `locations.json` /
  `items.json` (voice fixes only — no mechanics), `docs/hollowdeep-plan.md`
  (status), `CLAUDE.md`, `docs/SCOPE.md`, `README.md`, `docs/PLAYING.md` (only
  if a hollowdeep behaviour contradicts it)
- **Does:**
  - A full-transcript **voice pass**: play the walkthrough, read every line as
    a player would, fix register drift (portent, snark at the player rather
    than the choice, any surviving `[draft]` — there must be none; grep for
    it). Mechanical prose edits only; anything that changes behaviour goes
    back to the orchestrator.
  - Mark `docs/hollowdeep-plan.md` **IMPLEMENTED**; tick Phase 2 items in
    `docs/SCOPE.md`; update `CLAUDE.md`'s status header ("Hollowdeep content
    not started" is no longer true) and its dev-command line; refresh
    `README.md`'s status/feature table and test counts.
  - Closeout report: the SCOPE Phase 2 exit criteria demonstrated, plus this
    plan's Done-when.
- **Acceptance:** `npm run gate` green; zero `[draft]` markers anywhere in
  `adventures/hollowdeep/`; docs consistent with the shipped reality.
- **Commit:** `docs: hollowdeep voice pass and Phase 2 closeout`
- **Deps:** T10, T11

---

## Progress Tracker

- [x] T1 — Module skeleton: structure, no voice (`sonnet`) — `709542a`
- [x] T2 — Region A: Weir's Landing (`opus`) — `eb28ee7`
- [x] T3 — Region B: the Workings (`opus`) — `47eb6e7`
- [x] T4 — Region C: cavern, maze, creatures (`opus`) — `57a0cdf`
- [x] T5 — Regions D & E: past the breach, the seal (`opus`) — `e5dec1f`
- [x] T6 — Magic words and the gunnis (`opus`) — `11c81bc`
- [x] T7 — Endgame: two endings, ranks, achievements (`opus`) — `8c687b2`
- [x] T8 — Hint ladders (`opus`) — `eb88fe1`
- [x] T9 — Walkthrough + per-adventure harness (`opus`) — `6de4ec1`
- [ ] T10 — Content integration tests (`sonnet`)
- [ ] T11 — Dev app loads Hollowdeep (`sonnet`)
- [ ] T12 — Voice pass, docs, closeout (`opus`)

**Done when:** every box is ticked with its commit SHA, `npm run gate` is
green on `feat/hollowdeep`, the hollowdeep walkthrough reaches 350/350 with
the top rank, canon achievements, 0 deaths and 0 hints at ≥ 5 pinned seeds,
ending B and all eight deaths are test-covered, `npm run dev` plays Hollowdeep
end to end, and `docs/hollowdeep-plan.md` is marked IMPLEMENTED. Opening a
PR / merging is the human's call.

---

## Notes for the orchestrator

1. **The preconditions are real.** This plan was written before the
   hints/timers engine plan existed. When that plan lands it may change
   details this one assumes (the hints document's name and shape, T1's and
   T8's field names, whether test-cave gains a hints document). Re-read this
   file against the landed engine work before T1 and reconcile — mechanical
   drift is yours to fix; design drift goes back to the human.
2. **One module, single-file documents.** T2–T8 all edit the same six JSON
   files; they are serial by construction. The only parallel pair is T10/T11.
3. **The validator is the co-author.** Every commit from T1 onward must keep
   all ~40 checks green over the *whole* module — including
   `borrowed-source-text` over new prose and `missing-art-file` for every new
   `artId`. A region task that adds an artId regenerates placeholder art in
   its own commit (standing rule 2).
4. **T3 runs the engine's first-ever content timer.** If `startTimer`/
   `timerExpired` semantics don't match the design plan's sketch (§12.2 #2 —
   two events on one expiry, snapshot guards), that is a finding against the
   hints/timers plan. Stop and report; don't redesign the garnets around a bug.
5. **Watch the ward discipline in T9.** The stalker roams exactly four C
   rooms; every walkthrough step through them must carry the canary, or the
   run is seed-dependent and the failure surfaces two tasks late as a flaky
   test. Same logic as foundation's T23: debug the draw, never dilute.
6. **Deposit-then-refetch is legal and load-bearing** (§12.1 D→E): points
   award once ever, items can leave the repository. T5's mechanism and T7's
   ending-A guard both rest on it; T10 asserts the ending-A guard counts
   `itemAt` **at the office**, so a treasure carried back out un-fires nothing
   retroactively — the guard is evaluated fresh each turn.
7. **Room cuts are cheap until T9, expensive after.** §11.6 licenses cutting
   `low-crawl`, `deep-cut`, `worked-face` if a region feels flabby. After the
   walkthrough is authored, a cut re-opens T9. Decide by end of T5 or not at
   all.

## Assumptions for the human to confirm

1. **The blocking prerequisite:** the hints + timers engine work needs its own
   design plan (§10.2/§10.3 give the spec skeleton) and `/run-plan` **before**
   this plan can start. That plan does not exist yet.
2. **`npm run dev` defaults to Hollowdeep after T11** (test-cave via
   `?adventure=test-cave`). Say so now if test-cave should stay the default.
3. **The title ships as "Hollowdeep"** — the brief calls it a working title;
   T1 bakes it into `manifest.title`. Renaming later is one field plus prose.
4. **Placeholder SVGs are acceptable for the whole plan** — real art is
   Phase B and arrives on its own branch against the committed art manifest.
