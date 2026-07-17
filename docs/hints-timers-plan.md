# Hints & Timers — Engine Design Plan

**Status:** READY (2026-07-17)
**Phase:** engine prerequisite to Phase 2. **Blocks:** all Hollowdeep authoring
(`docs/hollowdeep-plan.md` status block, §10.2, §10.3) and therefore
`docs/hollowdeep-implementation-plan.md`'s preconditions.
**Settled by:** [hollowdeep-plan.md](hollowdeep-plan.md) §10.2 and §10.3 —
both questions were decided 2026-07-16/17 with spec skeletons; this document
is those skeletons worked out against the engine as built. Where the two
disagree on a detail, this document wins (it was written reading the code).
**Requirements served:** FR-7.2 [S] (nudge → hint → solution, each step
costing points), FR-1.5 [M] (deductions for hints), FR-1.12 [S] (no-hint
completion achievement) — the dependency chain that made hints a prerequisite
rather than a Phase 3 nicety.

This is the WHAT/WHY. `/impl-plan docs/hints-timers-plan.md` turns it into a
task graph.

---

## 1. Why this exists, in one paragraph

Two treasures in Hollowdeep (§10.3: the garnets, the cave pearls) are timer
puzzles, and the engine can only fire an event on an *absolute* turn number.
And three requirements (FR-7.2, FR-1.5, FR-1.12) need hints the format has no
home for. Both changes touch `GameState`, and a `GameState` field is a
`SAVE_VERSION` bump and a migration — so they ship **together, on one bump**,
or the second one pays for a pointless second migration. That co-scheduling is
the entire reason this is one plan and not two.

## 2. Design rules this plan is bound by

Inherited from the engine as built; none is negotiable here:

1. **Determinism.** No RNG, no clock. Nothing in this plan draws from the
   seeded RNG or reads time — timers count *consumed turns*, hints are pure
   state. The walkthrough-at-every-seed property must survive untouched.
2. **The frozen-vocabulary discipline** (schema/effects.ts banner): adding an
   effect or trigger is a deliberate, versioned act. This plan adds exactly
   one effect (`startTimer`), one trigger type (`timerExpired`), and one
   condition field (`hintsAtMost`) — the set §10.2/§10.3 settled, and no more.
   In particular there is **no `stopTimer`** (§4.6) and **no hint-related
   effect** (hints are engine machinery, not content events).
3. **All player-facing prose belongs to the adventure** (strings.json's rule).
   The hint verb's "no hint available" line, every ladder rung — all of it is
   module data. If the engine seems to speak about content in its own voice,
   that is a bug.
4. **State is plain JSON** (types.ts banner). New fields are
   `Record`/`number`, serializable, rebuilt field-by-field in
   `save.ts`'s `toGameState` so forgetting one is a compile error.
5. **Engine references no specific adventure.** `hintsAtMost` exists for
   exactly the reason `deathsAtMost` does (conditions.ts:74): content cannot
   see `GameState`, and the engine must not know an achievement called
   `nobody-asked` exists.

## 3. The one-line summaries

| Piece | What it is |
|---|---|
| `startTimer` | 13th `Effect` variant: name a timer, give it a turn count |
| `timerExpired` | 12th `Trigger` type: fires once when the count runs out |
| `GameState.timers` | `Record<timerId, expiryTurn>` — the thief's arithmetic, generalized |
| `hints.json` | 11th module document, **required**: condition-gated ladders of rungs |
| `hint` core verb | Reveals the next rung of the first relevant ladder; free of turns, not of points |
| `scoring.hintPenalty` | Deduction per rung revealed — outside `maxScore`, like `deathPenalty` |
| `GameState.hintsUsed` / `hintsRevealed` | The count (for penalty and `hintsAtMost`) and the per-ladder progress (for the Phase 3 panel) |
| `Condition.hintsAtMost` | Mirrors `deathsAtMost` exactly |
| `SAVE_VERSION 2` | One migration adds `timers`, `hintsUsed`, `hintsRevealed` |
| `ENGINE_VERSION 2.0.0` | A required new document is a format break; semver says so honestly (§6) |

---

## 4. Timers

### 4.1 The effect

```json
{ "kind": "startTimer", "timer": "roof-fall", "turns": 6 }
```

`timer` is a content-chosen id in the same implicit namespace as flags —
declared nowhere, created by first use, kebab-case per `zId`. `turns` is an
integer ≥ 1.

**Restart semantics: starting a running timer resets it.** `startTimer` writes
`timers[id] = <expiry>` unconditionally. Rationale: the alternative (ignore,
or error) makes the *second* pull of the stull silently weaker than the first,
and "the roof starts working again" is the intuitive reading. An author who
wants one-shot arming guards the event with a flag — expressible today, no
machinery needed.

### 4.2 The trigger

```json
{ "on": { "type": "timerExpired", "target": "roof-fall" } }
```

`target` is the timer id — the existing polymorphic-`target` pattern
(schema/event.ts: a location for `enter`, a flag for `flagSet`, now a timer
for `timerExpired`), and `superRefine` requires it, exactly as `verb` requires
its target. No new trigger field.

**Snapshot semantics come free and are load-bearing.** All events sharing a
trigger are judged against the state as of the firing (T12's rule), so
Hollowdeep's garnet pair — one event `if [{atLocation: stull-gallery}]` →
`die`, a second with the opposite guard → prose + flag — works with no
ordering reasoning. This plan changes nothing about `fireTriggers`; it only
calls it with a new trigger type.

### 4.3 State and arithmetic

```ts
/** timer id → the turn its expiry fires. Entry removed when it fires. */
timers: Record<string, number>;
```

Absolute expiry turn, not a countdown — the thief's own idiom
(`creatures.ts`: `state.turn - cs.activatedTurn` vs `stealAfterTurns`),
generalized. A countdown would need decrementing every tick; an expiry turn is
written once and compared. Applying `startTimer` during turn `T` (the turn
counter has already incremented when effects run — engine.ts stage 3 → 4)
writes `expiry = T + turns`.

**Observable contract, stated for authors:** after `startTimer t n` on the
turn you acted, you have **exactly `n` further consumed turns**; the expiry
fires during the world tick of the `n`-th, i.e. *after* that turn's action.
So "you have six moves to get clear" means the sixth move may be the one that
takes you out of the gallery, and the guard sees you already gone. Parse
errors, disambiguation questions, and free meta verbs consume no turn and
therefore never advance a timer — the same clock the lamp burns by, which is
the point: one notion of time, everywhere.

### 4.4 Where it fires in the pipeline

In `worldTick`, inside the **events stage**: `turnStart` triggers first (they
are the older mechanism; existing seeded tests observe their position), then
expired timers, then creatures → light → scoring as today. For each timer
with `expiry <= turn` (in **lexicographic timer-id order**, so same-turn
multi-expiry is deterministic and stated): delete the entry, then fire
`fireTriggers(type: 'timerExpired', target: id)`. Delete-then-fire means an
expiry event may legally `startTimer` its own id — that is the periodic-timer
idiom, free of charge.

`die` from an expiry event sets `DIED_THIS_TURN` and flows through
`handleDeath` in stage 5 like every other death — no special casing, one
penalty path, as the engine already insists.

### 4.5 Validator additions

- `unstarted-timer-expiry` — a `timerExpired` trigger whose `target` no
  `startTimer` effect anywhere names. Mirrors `unwritten-flag-read`: a
  listener that can never hear is always a typo.
- A `startTimer` no event listens for is **legal** — exactly as a flag set
  and never read is legal. (Hollowdeep uses none, but symmetry with flags is
  the rule worth keeping.)

### 4.6 Rejected on purpose

- **`stopTimer`.** A 14th effect for something the one consumer never does.
  "Defuse" is expressible today: guard the expiry events on `notFlag
  defused`. If a future adventure genuinely needs cancellation-with-cleanup,
  that is a finding for a future plan.
- **Countdown state / per-tick decrement.** More writes, same information.
- **Real-time anything.** Timers count consumed turns. The engine has no
  clock, and lint enforces that it never will.

---

## 5. Hints

### 5.1 The document — `hints.json`, the 11th, required

```json
{
  "noHintMessageId": "no-hints",
  "hints": [
    {
      "id": "pump-gate",
      "when": [{ "all": [{ "visited": "shaft-head" }, { "notFlag": "pump-drained" }] }],
      "ladder": [
        "The pump did not seize because it wanted to.",
        "It is missing something. The stables kept the mine's spare everything.",
        "Take the pump handle from the stables, fit it to the pump, then work the pump."
      ]
    }
  ]
}
```

- `id` — kebab id, unique within the document (the `duplicate-id` check
  extends to it).
- `when: Condition[]` — the standard grammar, ORing, `all` available. A hint
  is **available** while `when` holds. Authors *retire* a hint the same way
  they open one: the pump hint above closes itself when `pump-drained` sets.
  There is no separate `until` field — conditions already express it.
- `ladder: string[]`, min 1 — the rungs, nudge → hint → solution, inline
  prose. Three is the convention (FR-7.2), not a schema rule: a findable
  treasure may need one rung; the maze may want four.
- `noHintMessageId` — a `strings.json` id, required: what the `hint` verb says
  when nothing is available. Rule 3 of §2 — the engine has no voice of its own
  for this.

**Required document, may be empty.** `{"noHintMessageId": "...", "hints": []}`
is a complete, legal hints document — an adventure is allowed to offer no
hints, but it is not allowed to be *silent* about it. The format's stance is
already "all documents required, every object strict" (module-format.md);
optional documents are how a format grows dark corners. The cost is two lines
in the most minimal module and a version consequence (§6).

### 5.2 The verb

`hint` ships as a **core verb** (parser/vocab.ts — `hint`, synonym `hints`,
pattern `V`), so every adventure gets it and what a player learns transfers
(the core-verb rule). No noun form: "hint about the pump" would need the
parser to resolve nouns against an abstract puzzle namespace that does not
exist. Which puzzle you get help with is the selection rule's job:

**Selection:** scan `hints` in **document order**; the active hint is the
first whose `when` holds and whose ladder still has unrevealed rungs
(`hintsRevealed[id] < ladder.length`). Document order = priority order,
author-controlled, zero new syntax.

**On `hint` with an active hint:** reveal the next rung —
`hintsRevealed[id] += 1`, `hintsUsed += 1`, `score = max(0, score -
hintPenalty)` — and emit it. Each rung costs; FR-7.2 says "each step costing
points" and means it.

**On `hint` with nothing available:** print `noHintMessageId`. No penalty, no
count — being told "no" is not a hint.

**`hint` consumes no turn.** It joins `inventory`/`score`/`help` on the free
side of meta.ts's split, and for a sharper reason than theirs: hints exist for
the stuck, and the stuck player asking for a nudge during the gour flood must
not have the asking drown them. The lamp does not burn, creatures do not
move, timers do not advance. The penalty is the price; the price is not paid
twice. (Note the mechanical subtlety for the implementer: this is a handler
that *changes state* — score, counters — while returning `consumesTurn:
false`. `verbose`/`brief` already established that shape.)

Exhausted-and-still-available ladders are *skipped* by selection, so a player
who bought all three pump rungs and asks again gets the *next* relevant
puzzle's nudge, not a re-run. Re-reading rungs already bought is a UI concern:
`hintsRevealed` persists per ladder precisely so the Phase 3 hints panel can
redisplay purchased rungs without new state. In this phase the transcript
notice is the whole UI, per the achievements precedent.

### 5.3 State, condition, scoring

```ts
/** Total rungs revealed, ever. Read by hintsAtMost and the penalty math. */
hintsUsed: number;
/** hint id → rungs revealed (0..ladder.length). The Phase 3 panel's data. */
hintsRevealed: Record<string, number>;
```

- **`Condition.hintsAtMost`** — `z.number().int().nonnegative()`, true when
  `state.hintsUsed <= n`. A copy of `deathsAtMost`'s reasoning verbatim: the
  no-hints achievement (FR-1.12, Hollowdeep's `nobody-asked`) is content, the
  counter is engine state, and this field is the only bridge that doesn't make
  the engine name a specific adventure's achievement.
- **`scoring.hintPenalty`** — required, `int ≥ 0`, sits beside `deathPenalty`
  and follows its every rule: a **deduction**, never counted toward
  `maxScore` (the consistency arithmetic does not change), floored at 0,
  applied in exactly one place (the hint handler — the third member of the
  club deathPenalty/`handleDeath` founded).
- **`OutputEvent`** gains `{ kind: 'hint', text, hintId, rung }` — the union
  exists so the UI never parses prose (types.ts), and a hint is a thing Phase
  3 will want to style. Additive; not save state.

### 5.4 What hints must never do

FR-1.9 stands: **magic words are never surfaced**, and a solution rung that
prints `KIBBLE` would surface one. This is an *authoring* rule, not an engine
check (the engine cannot know which strings are words) — but it belongs in
`module-format.md`'s hints section in bold, and Hollowdeep's hint task
(hollowdeep-implementation-plan T8) already inherits it: a word-secret's
ladder points at where the word is *learned* ("the foreman kept notes"), never
at the word.

`suggestions()` may complete `hint` like any core verb — the verb is in
`help`, it is not a secret. The check that suggestions never complete magic
words is untouched.

---

## 6. Versions: one save bump, one engine major

**`SAVE_VERSION 1 → 2.`** Three new `GameState` fields (`timers`,
`hintsUsed`, `hintsRevealed`), one registry entry with honest defaults
(`{}`, `0`, `{}` — a v1 save predates all three features, so empty is the
truth, not a guess). `toGameState` gains three lines and the compiler enforces
them. The migration is real and tested with a fabricated v1 blob from a
*played* state, per T21's round-trip precedent — this is the first migration
that will ever run against the registry twice (0→1→2 chained), which is worth
a test of its own.

**`ENGINE_VERSION 1.1.0 → 2.0.0.`** Not 1.2.0, and the reason is the
handshake's own logic (engine.ts:25): the version exists so a module gets a
clean refusal instead of a confusing failure. A required 11th document means
**every pre-hints module fails to load on the new engine** — that is a
breaking format change, and calling it minor would make `^1.0.0` a lie the
loader acts on. Honest consequence: both in-repo modules update their
manifests to `"engineVersion": "^2.0.0"` in the same change. (The additive
pieces — `startTimer`, `timerExpired`, `hintsAtMost` — ride the same bump;
they'd have been 1.2.0 alone, but there is no reason to ship two bumps.)

There are no third-party modules and no released saves; both bumps are as
cheap today as they will ever be. That cheapness is §10.2's stated reason for
doing this *now*.

## 7. The fixture obligation — test-cave grows, minimally

test-cave's contract is "deliberately exercises every feature the engine has"
(module-format.md; foundation plan T9: *if a feature is not in test-cave, it
is untested* at the fixture level). So test-cave gains, smallest-possible:

1. **`hints.json`** with `noHintMessageId` and **two ladders** (so selection
   order is exercised, not just existence): one for the locked-door/oil chain
   (3 rungs — the canonical nudge→hint→solution), one single-rung hint
   elsewhere, each retiring via its puzzle's flag.
2. **`scoring.hintPenalty`** (suggest 5 — any value; unit tests assert the
   deduction, nothing asserts the number).
3. **One timer chain** anchored on an action the walkthrough does not take,
   in an existing room — arm via an event (`startTimer`), two `timerExpired`
   events with opposite guards (the Hollowdeep garnet shape, proven here
   first). The impl plan picks the anchor; the constraint is that it must not
   add a location or perturb the walkthrough's transcript.
4. **A `no-hints` achievement** awarded at victory with `hintsAtMost: 0` —
   exercising the new condition end-to-end and mirroring FR-1.12.
   `walkthrough.json`'s `expectedAchievements` gains it (the walkthrough never
   types `hint`; a hint would cost points and break 100/100 — same logic as
   the existing no-deaths corollary in the foundation plan).

Achievements award no points and `hintPenalty` is a deduction, so
**`maxScore: 100` does not move.** The walkthrough's transcript must not
change except for the new expected achievement at the end.

## 8. Validator additions (consistency.ts)

| Check | Error | Kind |
|---|---|---|
| `timerExpired` target never started | `unstarted-timer-expiry` | mirrors `unwritten-flag-read` |
| hint `when` conditions | existing dangling-condition checks, extended to the hints document | reuse |
| hint `when` flag reads | count as reads in `unwritten-flag-read` | reuse |
| `noHintMessageId` resolves | `dangling-no-hint-message` | mirrors `dangling-lamp-warn-message` |
| duplicate hint ids | existing `duplicate-id` | reuse |
| ladder rung prose | `borrowed-source-text` scans rungs | reuse — hints are prose, and prose is where borrowing happens |

Schema-level (zod, no consistency rule needed): empty ladders rejected
(`min 1`), empty conditions already rejected, strict objects throughout.

## 9. Tests this plan owes

- **Timers:** start/expiry arithmetic at the §4.3 contract exactly (the
  n-moves reading, off-by-one pinned by test); restart-resets; multi-expiry
  same turn in id order; expiry `die` → one death, one penalty; periodic
  re-arm from own expiry; no advance on parse errors/free verbs; timers
  survive save round-trip mid-count.
- **Hints:** selection order; retirement via `when`; exhaustion skips to next;
  rung/penalty/counter math incl. the 0 floor; no-turn property (fuel,
  creatures, timers all unmoved by `hint`); `noHintMessageId` path;
  `hintsAtMost` boundary (at n, above n); the `hint` OutputEvent shape.
- **Save:** v1 blob (played, not fresh) migrates 1→2; chained 0→1→2; round-trip
  with live timers and part-revealed ladders.
- **Fixture:** test-cave walkthrough still 100/100 at the pinned seeds with
  the new achievement; golden-test fixtures for each new validator error.
- **Determinism:** the whole suite's existing seeded tests pass unchanged —
  nothing here draws RNG, so any seeded diff is a bug in this plan's
  implementation, full stop.

## 10. Documentation this plan owes

- `docs/module-format.md` — "Ten JSON documents" becomes eleven; full
  `hints.json` section (shape, selection rule, the §4.3 timer contract for
  authors, the FR-1.9 bold warning); `startTimer`/`timerExpired`/`hintsAtMost`
  rows in their tables; `hintPenalty` beside `deathPenalty`; the
  `^2.0.0` handshake note.
- `CLAUDE.md` — the format summary ("ten JSON documents", "Hints are Phase 3
  and are not in the format") is now false twice; fix both.
- `docs/PLAYING.md` + `meta.ts` `help` text — the `hint` verb, what it costs,
  and that the two must agree (T27's standing rule).
- `docs/hollowdeep-plan.md` — tick the "being built" hedges in §2/§10 to
  "built" once landed (a one-line status touch, not a rewrite).

## 11. Out of scope

| Item | Why not here |
|---|---|
| Hints **UI** panel (browse, re-read bought rungs) | Phase 3 — `hintsRevealed` is designed to feed it; transcript notice suffices now |
| Per-rung or escalating hint costs | Flat `hintPenalty` meets FR-7.2; a per-rung cost is an additive schema change if a real adventure ever wants it |
| `stopTimer` / timer cleanup effects | §4.6 — expressible via guards; no consumer |
| Targeted hints (`hint about X`) | Needs a puzzle-noun namespace that doesn't exist; selection rule covers the need |
| Hollowdeep's actual hint ladders and timer content | `docs/hollowdeep-implementation-plan.md` T3, T4, T8 — that plan's whole reason to wait for this one |
| Onboarding/tips (FR-7.1) | Phase 3 UI |

## 12. Open questions

None blocking. Two defaults the human may veto before `/impl-plan`:

1. **`ENGINE_VERSION 2.0.0`** (§6) — the honest-semver reading of a required
   new document. The alternative (optional `hints.json`, engine 1.2.0) keeps
   old modules loading at the price of the format's first optional document.
   Default: **2.0.0, required document.**
2. **`hint` consumes no turn** (§5.2) — the player-kind reading. The
   classic-severe alternative (a turn, so hints burn lamp oil) is one boolean
   away if playtesting wants it. Default: **free.**

## 13. Exit criteria

1. `npm run gate` green; every seeded test passes unchanged.
2. test-cave walkthrough: 100/100, rank, **three** achievements, 0 deaths, 0
   hints, at all pinned seeds.
3. A fabricated v1 save from a played game loads at SAVE_VERSION 2 and plays
   on; a fabricated v0 save chains 0→1→2.
4. Every §3 piece demonstrably exercised by test-cave data (the fixture
   obligation) — a grep for `startTimer`, `timerExpired`, `hintsAtMost`,
   `hint` in `adventures/test-cave/` is non-empty.
5. `docs/hollowdeep-implementation-plan.md`'s six preconditions all pass as
   written.
