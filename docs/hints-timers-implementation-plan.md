# Hints & Timers Implementation Plan — Engine Prerequisite to Phase 2

**Status:** READY (2026-07-17)

Execution plan for [`docs/hints-timers-plan.md`](hints-timers-plan.md) (the
WHAT/WHY); rules live in
[`docs/orchestration-playbook.md`](orchestration-playbook.md).

> **Design defaults stand.** The design plan's §12 named two veto-able
> defaults — `hints.json` required + `ENGINE_VERSION 2.0.0`, and a turn-free
> `hint` verb. Running `/impl-plan` without a veto confirms both; this plan
> builds on them. Landing this plan unblocks
> [`docs/hollowdeep-implementation-plan.md`](hollowdeep-implementation-plan.md)
> — its six preconditions are this plan's exit criteria.

---

## Kickoff

A fresh Opus session should execute this with:

```
/run-plan docs/hints-timers-implementation-plan.md
```

If starting cold without the slash command: read
[`docs/hints-timers-plan.md`](hints-timers-plan.md) (the design — §4 and §5
pin the semantics; do not re-derive them),
[`docs/orchestration-playbook.md`](orchestration-playbook.md) (Rules of
Engagement, model policy, gate) and this file, then execute the task graph in
order — one subagent per task at the task's model, review the diff, run the
gate yourself, commit, tick the tracker, repeat. Never commit red. The
Progress Tracker at the bottom is the source of truth for resuming.

## Scope & branch

**Branch:** `feat/hints-timers`, from `main`.

**In scope:** design plan §3–§10 in full — the `startTimer`/`timerExpired`
timer machinery, the `hints.json` document + `hint` core verb +
`hintPenalty`/`hintsUsed`/`hintsAtMost`, `SAVE_VERSION 2` with a real
migration, `ENGINE_VERSION 2.0.0`, validator additions, test-cave grown to
exercise all of it, and the documentation debt (§10).

### Deferred / out of scope

Carried from design plan §11 — do not create tasks for these:

| Item | Reason |
|---|---|
| Hints **UI** panel (browse, re-read bought rungs) | Phase 3; `hintsRevealed` is designed to feed it, transcript notice suffices now |
| Per-rung / escalating hint costs | Flat `hintPenalty` meets FR-7.2; additive later if ever needed |
| `stopTimer` or any timer-cleanup effect | Design §4.6 — expressible via guards; no consumer |
| Targeted hints (`hint about X`) | Needs a puzzle-noun namespace that doesn't exist |
| Hollowdeep's hint ladders and timer content | `hollowdeep-implementation-plan.md` T3/T4/T8 — the plan waiting on this one |
| Onboarding / contextual tips (FR-7.1) | Phase 3 UI |

---

## Task graph

### Phase 1 — Contract: schema, versions, and the catch-up

---

**T1 — Schema v2: new vocabulary, 11th document, version bumps, content catch-up** · `opus`

- **Files:** `src/engine/schema/effects.ts`, `event.ts`, `conditions.ts`,
  `scoring.ts`, `hints.ts` (new), `index.ts` (`MODULE_DOCUMENTS`),
  `src/engine/engine.ts` (`ENGINE_VERSION`),
  `adventures/test-cave/hints.json` (new), `scoring.json`, `strings.json`,
  `manifest.json`; `tests/validator/fixtures/*.json`,
  `tests/engine/schema.test.ts`, plus whatever hand-built module fixtures the
  compiler and validator flag (see the blast-radius note)
- **Does:** the entire §3 contract in one atomic commit:
  - `zEffect` gains `startTimer { timer: zId, turns: int ≥ 1 }` — update the
    frozen-union banner (twelve → thirteen, "frozen at v2") and
    `EFFECT_KINDS`; the exhaustive-switch design means `applyEffects` will
    not compile until T3 stubs the case — **stub it there? No:** add the case
    in this task as a typed `not implemented` throw with a `TODO(T3)`, so the
    schema and the interpreter never diverge silently.
  - `zTrigger.type` gains `timerExpired`; `superRefine` requires its `target`
    (the timer id), same shape as `verb`'s requirement.
  - `LEAF_FIELDS` gains `hintsAtMost` (int ≥ 0) — evaluation is T4's;
    schema-only here.
  - `zScoring` gains required `hintPenalty` (int ≥ 0), beside `deathPenalty`
    with the same deduction comment.
  - New `src/engine/schema/hints.ts`: `zHints = { noHintMessageId: zId,
    hints: HintEntry[] }`, `HintEntry = { id, when: zConditions (min 1),
    ladder: string[] (min 1, each min 1 char) }`, `.strict()` throughout.
    `MODULE_DOCUMENTS` gains `'hints.json'` — the loader picks it up by
    construction (loader.ts derives its file list from the registry).
  - `ENGINE_VERSION` → `'2.0.0'` with a version-history comment mirroring the
    1.1.0 one (engine.ts:25): why a required document is a major.
  - **Content catch-up, same commit:** test-cave gains the minimal legal
    hints document (`noHintMessageId: "no-hints"`, `hints: []` — T6 fills
    it), the `no-hints` string, `hintPenalty: 5`, and
    `engineVersion: "^2.0.0"`. Every validator golden fixture and every
    hand-built `AdventureModule` in tests gains the new required pieces.
  - Schema tests: each new shape accepts valid / rejects malformed (bad
    `turns: 0`, empty ladder, missing `noHintMessageId`, `timerExpired`
    without target, unknown keys).
- **Blast radius — expected, not scope creep:** a required document plus a
  required scoring field breaks *every module-shaped fixture in the repo* at
  once. The compiler (`AdventureModule` gains `hints`) and the validator find
  them all; fixing them is the playbook's "mechanical consequence" rule.
  Also grep tests for a hardcoded `'1.1.0'`.
- **Design-sensitive:** this is the engine↔content contract change the whole
  plan exists for, and the freeze-discipline banner is being amended — the
  precedent it sets is the point.
- **Acceptance:** `npm run gate` green (the whole gate — validate must pass
  with test-cave's minimal hints document); schema tests cover every new
  shape both ways.
- **Commit:** `feat(engine)!: add timers, hints document, and hintsAtMost to the module format (v2)`
- **Deps:** none

---

**T2 — GameState fields and the 1 → 2 save migration** · `opus`

- **Files:** `src/engine/types.ts`, `src/engine/state.ts`,
  `src/engine/save.ts`, `tests/engine/save.test.ts`,
  `tests/engine/state.test.ts`
- **Does:** design §4.3/§5.3 state and §6's bump:
  - `GameState` gains `timers: Record<string, number>` (id → expiry turn),
    `hintsUsed: number`, `hintsRevealed: Record<string, number>` — with the
    types.ts field-rationale comments the file's convention demands.
  - `createGame` initialises all three empty/zero.
  - `SAVE_VERSION` → 2; `MIGRATIONS[1]` adds the three defaults (`{}`, `0`,
    `{}` — honest: a v1 save predates the features); `toGameState` gains the
    three fields so the compiler enforces the rebuild.
- **Design-sensitive:** save migration is explicitly `opus` in the model
  policy; this registry entry is the first that will ever run *chained*
  (0→1→2).
- **Acceptance:** `npm run gate` green. Tests: a fabricated v1 blob from a
  **played** walkthrough state migrates to 2 and deep-round-trips; a
  fabricated v0 blob chains 0→1→2; a state with live timers and
  part-revealed ladders (hand-built — the systems don't exist yet, the fields
  do) survives `saveGame`/`loadGame` exactly; serializability invariant
  (`JSON.parse(JSON.stringify(s))` deep-equals) still holds.
- **Commit:** `feat(engine): add timers and hint state; bump SAVE_VERSION to 2`
- **Deps:** T1

---

### Phase 2 — Systems

---

**T3 — The timer system** · `opus`

- **Files:** `src/engine/systems/events.ts` (the `startTimer` case),
  `src/engine/engine.ts` (`worldTick`), `tests/engine/timers.test.ts` (new)
- **Does:** design §4 exactly:
  - `applyEffects`'s `startTimer` case (replacing T1's TODO): write
    `timers[id] = state.turn + turns`, unconditionally — restart resets.
  - `worldTick`: inside the events stage, **after** `turnStart` triggers and
    **before** `creatureTick`, collect timers with `expiry <= turn`, iterate
    in **lexicographic id order**, delete-then-fire
    `fireTriggers({type: 'timerExpired', target: id})`. Update the stage-order
    comment (engine.ts:169) — the order is a public contract and the comment
    is where it lives.
  - Draw **no RNG** and read no clock; `die` from an expiry flows through
    `DIED_THIS_TURN` untouched.
- **Design-sensitive:** turn pipeline + the effect choke point, both named
  `opus` territory by the playbook. The §4.3 off-by-one contract ("after
  `startTimer t n` you have exactly n further consumed turns; expiry fires
  during the n-th's world tick, after its action") is **pinned — test it as
  written, do not re-derive it.**
- **Acceptance:** `npm run gate` green — including **byte-identical results
  on every existing seeded test**, since timers draw no RNG (design §9's
  "any seeded diff is a bug in this plan, full stop"). New tests: the n-turn
  contract exactly (including "the n-th move exits the room and the guard
  sees you gone"); restart-resets; two timers expiring the same turn fire in
  id order; expiry `die` → one death, one penalty; an expiry event
  re-arming its own id (the periodic idiom); parse errors and free meta verbs
  advance nothing; snapshot semantics across two opposite-guard expiry
  events.
- **Commit:** `feat(engine): add relative timers — startTimer effect, timerExpired trigger`
- **Deps:** T2

---

**T4 — The hint verb, selection rule, and hintsAtMost** · `sonnet`

- **Files:** `src/engine/parser/vocab.ts`, `src/engine/actions/meta.ts` (or a
  new `actions/hints.ts` — implementer's call, say which in the commit),
  `src/engine/actions/index.ts` (dispatch entry),
  `src/engine/systems/events.ts` (`evalCondition` `hintsAtMost` case),
  `src/engine/types.ts` (`OutputEvent` `hint` variant),
  `tests/engine/hints.test.ts` (new)
- **Does:** design §5.2/§5.3 exactly:
  - Core verb `hint` (synonym `hints`), pattern `V`, added to `CORE_VERBS`.
  - Handler: scan `module.hints.hints` in document order; active = first
    whose `when` holds (standard OR/`all` evaluation via `evalCondition`)
    **and** `hintsRevealed[id] < ladder.length`. Reveal next rung:
    `hintsRevealed[id]++`, `hintsUsed++`, `score = max(0, score −
    hintPenalty)`, emit `{kind: 'hint', text: rung, hintId, rung}`. Nothing
    available → print `noHintMessageId`, change nothing.
  - **`consumesTurn: false` in every path** — the state-changing-but-free
    shape `verbose` established (meta.ts's header comment gets a third
    entry). Note: `when` conditions may legally contain `chance`; evaluation
    threads RNG state exactly as everywhere else — the *hollowdeep* rule
    against `chance` is content discipline, not engine law.
  - `evalCondition` gains `hintsAtMost`: true when `hintsUsed <= n`. Mirrors
    `deathsAtMost`'s branch verbatim.
- **Acceptance:** `npm run gate` green. Tests (hand-built modules): selection
  order with two available ladders; retirement via `when` going false
  mid-ladder; exhaustion skips to the next available; penalty math including
  the 0 floor and a 0 `hintPenalty`; `hintsUsed` counts rungs, not commands;
  the no-turn property asserted three ways — lamp fuel unmoved, creatures
  untick'd, **a running timer does not advance** (needs T3, which is why this
  task follows it); `noHintMessageId` path free and uncounted; `hintsAtMost`
  boundary at n and n+1; the `hint` OutputEvent carries id and rung index.
- **Commit:** `feat(engine): add the hint verb, ladder selection, and hintsAtMost`
- **Deps:** T3 (shares `systems/events.ts`; the no-turn test needs live timers)

---

### Phase 3 — Validator

---

**T5 — Validator additions and golden fixtures** · `sonnet` · **parallel-safe with T6**

- **Files:** `src/engine/schema/consistency.ts`,
  `tests/engine/consistency.test.ts`, `tests/validator/golden.test.ts`,
  `tests/validator/fixtures/unstarted-timer-expiry.json`,
  `tests/validator/fixtures/dangling-no-hint-message.json` (+ any the checks
  below need)
- **Does:** design §8's table:
  - `unstarted-timer-expiry` — a `timerExpired` target no `startTimer`
    anywhere names (mirror `unwritten-flag-read`; a started-but-unheard timer
    stays **legal**, like a set-but-never-read flag).
  - Hints document joins the existing sweeps: `when` conditions through the
    dangling-condition checks; hint `when` flag reads count as reads in
    `unwritten-flag-read`; `noHintMessageId` → `dangling-no-hint-message`;
    hint ids join `duplicate-id`; ladder rungs join the
    `borrowed-source-text` scan.
- **Acceptance:** `npm run gate` green; each new/extended check has a golden
  fixture producing exactly its error and a passing counterpart; test-cave
  and the `valid.json` fixture stay quiet.
- **Commit:** `feat(engine): validate timers and hints — unstarted expiries, dangling hint refs`
- **Deps:** T1 (schema only). Files disjoint from T6
  (`src/engine/schema/` + `tests/validator/` vs `adventures/test-cave/`);
  whichever lands second must still pass the other's additions — that is the
  gate working, not a conflict.

---

### Phase 4 — The fixture obligation

---

**T6 — test-cave exercises everything** · `opus` · **parallel-safe with T5**

- **Files:** `adventures/test-cave/hints.json`, `events.json`,
  `strings.json`, `vocabulary.json`, `achievements.json`, `walkthrough.json`
- **Does:** design §7, with the anchor this plan now picks:
  - **The timer chain — shake the hollow tree.** `shake` joins the `use`
    verb's synonyms (the verb-rides-`use` idiom Hollowdeep will copy);
    `use tree-trunk` → print (an offended hum, somewhere above), `startTimer
    bee-swarm 3`; two `timerExpired bee-swarm` events with opposite guards —
    `atLocation hollow-tree` → `die` (stung; new string), else → print (the
    humming subsides). The walkthrough never shakes anything, no location is
    added, and its transcript is untouched — the three constraints §7.3 set.
    This is the exact two-event garnet shape Hollowdeep's stull copies, which
    is the point of a reference fixture.
  - **Two hint ladders**, exercising selection order: first (document order)
    the grate — one rung, `when: [{notFlag: "grate-open"}]`; second the
    rusted door — three rungs (the canonical nudge → hint → solution),
    `when: [{all: [{visited: "grotto"}, {notFlag: "door-oiled"}]}]`. Each
    retires via its puzzle's existing flag. Rungs in test-cave's own dry
    voice; the door's solution rung names the oil, **and no rung anywhere
    names `zeeble`** (FR-1.9, design §5.4).
  - **`no-hints` achievement** ("finish without asking") + a
    `win-unhinted` event on `flagSet both-deposited` guarded
    `hintsAtMost: 0` — the same shape as the existing no-deaths pair.
    `walkthrough.json` `expectedAchievements` gains `no-hints` (the
    walkthrough never types `hint`; a hint would cost 5 points and break
    100/100 — the no-deaths corollary, again).
- **Arithmetic check:** achievements award nothing, `hintPenalty` is a
  deduction — `maxScore: 100` must not move, and the validator will say so if
  it did.
- **Acceptance:** `npm run gate` green; `tests/walkthrough.test.ts` passes at
  all pinned seeds with 100/100, the rank, **three** achievements, 0 deaths;
  design-plan exit criterion #4's grep (`startTimer`, `timerExpired`,
  `hintsAtMost`, `hint` in `adventures/test-cave/`) is non-empty.
- **Commit:** `feat(content): test-cave exercises timers and hints — bees, ladders, no-hints`
- **Deps:** T3, T4

---

### Phase 5 — Integration and closeout

---

**T7 — Integration tests against the real fixture** · `sonnet`

- **Files:** `tests/engine/hints.test.ts`, `tests/engine/timers.test.ts`
  (extend both — new describe blocks driving loaded test-cave through
  `step()`)
- **Does:** the against-real-content layer T4/T3's hand-built modules can't
  give:
  - typed `hint` at turn 0 → the grate rung; after opening the grate →
    the door ladder (retirement + selection order, live); three more `hint`s
    walk the door ladder then `noHintMessageId`; `score` command reflects
    each deduction;
  - `shake tree` → wait out the swarm in place → death, penalty, scatter,
    reincarnation at `road`; and the walked-away branch prints the subsiding
    line — both via `step()`, transcript-asserted;
  - a save taken mid-swarm with one rung bought round-trips through
    `saveGame`/`loadGame` and the timer still fires on schedule;
  - the walkthrough's five seeds still produce identical outcomes
    (re-asserted here only by running the existing suite — do not duplicate
    the harness).
- **Acceptance:** `npm run gate` green; every scenario above asserted through
  `step()` against loaded test-cave, no RNG stubbing anywhere.
- **Commit:** `test: drive hints and timers end-to-end through test-cave`
- **Deps:** T6

---

**T8 — Documentation and closeout** · `opus`

- **Files:** `docs/module-format.md`, `CLAUDE.md`, `docs/PLAYING.md`,
  `src/engine/actions/meta.ts` (help text), `docs/hints-timers-plan.md`
  (status), `docs/hollowdeep-plan.md` (§2/§10 "being built" hedges),
  `README.md` (test count / feature table if stale)
- **Does:** design §10 in full:
  - `module-format.md`: "Ten JSON documents" → eleven; a full `hints.json`
    section (shape, selection rule, retirement idiom, the FR-1.9 warning in
    bold); the §4.3 timer contract stated *for authors* ("you have n moves");
    `startTimer`/`timerExpired`/`hintsAtMost` rows in the effect/trigger/
    condition tables; `hintPenalty` beside `deathPenalty`; the `^2.0.0`
    handshake note. Written to FR-6.3's bar — authorable from the docs alone.
  - `CLAUDE.md`: fix both stale claims ("ten JSON documents", "Hints are
    Phase 3 and are not in the format").
  - `PLAYING.md` + `meta.ts` `help`: the `hint` verb, that it costs points
    and not turns — **transcribed from the running game** (T27's rule), and
    the two must agree.
  - Mark `docs/hints-timers-plan.md` **IMPLEMENTED**; retick
    `docs/hollowdeep-plan.md`'s §2/§10 hedges to "built"; closeout report
    stating all five design-plan exit criteria, including that
    `hollowdeep-implementation-plan.md`'s six preconditions now pass **as
    written**.
- **Acceptance:** `npm run gate` green; the six Hollowdeep preconditions
  verified one by one in the closeout report; help text and PLAYING.md agree
  verbatim on the hint verb's cost.
- **Commit:** `docs: document the hints and timers format; mark the plan implemented`
- **Deps:** T5, T7

---

## Progress Tracker

- [x] T1 — Schema v2: new vocabulary, 11th document, version bumps, catch-up (`opus`) — `57871c0` (startTimer stub is a no-op, not a throw — the frozen-union coverage test asserts every effect applies cleanly; T3 replaces it. Loader-test handshake case moved to ^9.0.0, since ^2.0.0 now matches.)
- [x] T2 — GameState fields and the 1 → 2 save migration (`opus`) — `e0dcf8c` (v0Blob re-fabricated as a true v0 — missing all four latter-day fields — so the old v0 test now exercises the 0→1→2 chain for free)
- [x] T3 — The timer system (`opus`) — `fac0ce2` (expiry fires on *strictly-past*, not at-or-past — the design plan's §4.3 parenthetical about increment order was wrong for action effects, and strict-past is what keeps its stated n-further-moves contract exact. Tick-armed timers count from the next turn; documented. **Finding:** useHandler treats output-less use events as refusals while keeping their state mutations — pre-existing, flagged for the human, not fixed here.)
- [x] T4 — The hint verb, selection rule, and hintsAtMost (`sonnet`) — `dce5efb` (handler lives in meta.ts beside the other free verbs; lookupString exported from events.ts rather than duplicated; no app change needed — TranscriptPanel has no exhaustive kind switch)
- [x] T5 — Validator additions and golden fixtures (`sonnet`) — `0a7c4d6` (hints `when` routed through the existing checkConditions, so dangling refs and flag reads came for free — verified by test, not assumed; document-level error id is `hints`, matching the `manifest` convention)
- [ ] T6 — test-cave exercises everything (`opus`)
- [ ] T7 — Integration tests against the real fixture (`sonnet`)
- [ ] T8 — Documentation and closeout (`opus`)

**Done when:** every box is ticked with its commit SHA, `npm run gate` is
green on `feat/hints-timers`, all five design-plan exit criteria hold (gate
green with seeded tests unchanged; test-cave walkthrough 100/100 with three
achievements at all pinned seeds; v1 and chained v0 saves migrate; the
fixture grep is non-empty; the Hollowdeep preconditions pass as written), and
`docs/hints-timers-plan.md` is marked IMPLEMENTED. Opening a PR / merging is
the human's call — and merging is what unblocks
`/run-plan docs/hollowdeep-implementation-plan.md`.

---

## Notes for the orchestrator

1. **T1 is deliberately one big atomic commit.** A required document + a
   required scoring field cannot land apart from the content that satisfies
   them — any split leaves the gate red in between. Expect the diff to sprawl
   across tests; judge it by whether every hunk is the same mechanical
   catch-up, not by its size.
2. **Seeded tests are the tripwire.** Nothing in this plan draws RNG or
   perturbs the existing draw order — timers slot between `turnStart` and
   `creatureTick` and roll nothing. If any pre-existing seeded test changes
   behaviour at any point, stop: that is a real bug in the change, per design
   §9, and never something to re-pin.
3. **The off-by-one is pinned, not open.** Design §4.3 states the timer
   contract to the turn, including that the n-th move may be the escaping
   one. T3 tests it as written; T6's bee chain and the eventual garnet chain
   both rely on that exact reading. If implementation makes a different
   arithmetic feel natural, the design doc wins — or stop and ask.
4. **`hint` changes state without consuming a turn.** That shape already
   exists (`verbose`/`brief`) but this is its first score-touching instance.
   The no-turn property is load-bearing for Hollowdeep's flood-and-hint
   scenario — T4's three-way assertion (fuel, creatures, timers) is the
   regression guard; don't let it get simplified away.
5. **T5 ∥ T6 ordering is free but not commutative in review:** if T6 lands
   first, T5's new checks immediately audit the bee chain and the ladders —
   a failure there is most likely a real content typo T6 should fix, not a
   checker bug. If T5 lands first, T6 authors under the stricter validator
   from the start (mildly preferable when serializing anyway).
6. **The walkthrough gains an achievement, not a step.** T6 touches
   `expectedAchievements` only. If making the walkthrough pass ever seems to
   require adding a `hint` or `shake` step, something upstream is wrong —
   both would break 100/100 or the transcript; stop rather than adjust
   expectations.
