# Foundation Execution Notes

**Status:** live — appended to as `/run-plan docs/foundation-implementation-plan.md` executes.
**Started:** 2026-07-15

Decisions, deviations, and latent issues surfaced while executing
[`foundation-implementation-plan.md`](foundation-implementation-plan.md).

The Progress Tracker in the implementation plan remains the source of truth for
*what is done*. This file records *what we learned and chose along the way* —
the things a commit message alone would bury and a future session would
otherwise have to rediscover. Entries are grouped by the task that produced
them.

---

## Deviations from the plan (decided in-flight)

Each of these departs from a literal reading of a plan document. All were made
under the design plan's own rule that **the schema files are authoritative**
over §4.1's abridged sketch, or under the playbook's "a necessary mechanical
consequence of an in-scope change is not new scope."

### T4 — `Effect` is a discriminated union, not a bag of optional fields

**The plan sketches** `Effect = { printId?, setFlag?, moveItem?, … }` — one
object, all fields optional. **We shipped** a `z.discriminatedUnion('kind', …)`
of 12 variants, each element being exactly one effect.

**Why:** `do: Effect[]` is *ordered*, and the order is observable — it
determines RNG consumption order and output-event sequence. A single object
carrying both `moveItem` and `die` has no defined order between them, so the
bag shape admits states the engine cannot describe. The union also gives T12's
`applyEffects` an exhaustive `switch`, making an unhandled variant a compile
error rather than a silent no-op.

**Supporting evidence:** the implementation plan itself calls it "the `Effect`
union" and says T12 covers "every variant in the frozen §4.1 list" — *union*
and *variant* are the union reading.

**Blast radius:** every downstream task assumes it. T12 (apply), T5
(consistency walks `event.do[]` switching on `kind`), T9 (content authoring),
T27 (docs).

### T4 — `Verb` takes `patterns[]`, not a single `pattern`

Real verbs span grammars: `look` is both `V` ("look") and `VN` ("look at
carving"); `oil` is `VN` and `VNPN`. One pattern per verb forces duplicate verb
entries sharing a word list, and the parser would have to reconcile duplicate
ids.

### T4 — Milestones are declarative (`when: Condition[]`)

Rather than being awarded by an `addScore` effect. This is what makes milestone
points **derivable from data**, which is the only reason T5 can reconcile
`maxScore` against content at all. `addScore` remains in the frozen union for
scoring outside the treasure/milestone model; `effects.ts` documents the hazard
of using it for treasure/milestone points (double-counting).

### T4 — Fields §4.1 implies but does not table

- `manifest.carryLimit` — FR-1.2 requires carry limits and T16 enforces them;
  the field had no home.
- `manifest.lamp` carries `itemId`/`startFuel`/`warnAt`/`refuel` — fuel is
  manifest-level because `GameState` tracks a single `lampFuel` number (§5.2),
  so there is one lamp per adventure *by construction*. An adventure wanting
  two fuel-burning lamps would need a state-shape change (i.e. a save
  migration), which should not be reachable by editing a content file.
- `src/engine/schema/common.ts` — not in T4's file list; holds the id/direction
  primitives every other schema imports, which otherwise had no non-arbitrary
  home.

### T4 → T19 — `stealAfterTurns` already exists

T19's task text says "Add `stealAfterTurns` to the creature schema (T4)". It is
already in the design plan's amended §4.1, so T4 shipped it. **T19 has no
schema work to do.**

### T9 — five schema gaps that only real content revealed

Orchestrator note 3 predicted this ("budget for the validator and schemas to be
wrong in ways only real content reveals"). It was right. Every one of these is
forced by §8's own content, not invented:

| Addition | Why nothing else worked |
|---|---|
| `Condition.atLocation` | §4.1 has `itemAt`/`creatureAt` but no way to ask where the **player** is. §8's `zeeble` teleports road↔entry-hall — one word whose effect depends on which end you say it from. `visited` is not a substitute (true forever once true). |
| `search` trigger | §8's `search tree` reveals the iron key. Parallels take/drop/use/read/open exactly. |
| `verb` trigger | §8's ledge `jump` hazard. Intransitive, so no noun-bearing trigger fits; not a magic word (those are never surfaced in UI, FR-1.9). Engine contract documented in `event.ts` for T13/T14: after dispatch, fire `verb` triggers; a verb with no handler and no matching event is a nudge. |
| `Condition.deathsAtMost` | §8's `no-deaths` achievement was **unwinnable as specified**. `deaths` lives in GameState where content cannot see it. Engine-side hardcoding ("award the achievement named `no-deaths`") would make engine code reference one adventure's content — the playbook forbids it. Setting a flag from the `die` effect fails too: darkness and creature kills are engine-driven and never touch content effects, so a player eaten by the rat would still collect it. |
| `container.capacity` → nonnegative | `container` is where open/closed/locked state lives, so it is also how a **door** is modelled. §8's grate is openable, lockable, and holds nothing. |

Also closed a real hole in T5: **trigger targets were never validated at all**.
An `enter` trigger with a typo'd location silently never fired — the quietest
possible bug, since the content reads as though it should work. Now checked per
trigger type. `verb` triggers are only checked against module-declared verbs,
with a `TODO(T13)` — core verbs ship in-engine and that file does not exist yet.

### T9 — `addScore` is deliberately absent from test-cave

11 of 12 effect variants appear in the module; `addScore` does not, and this is
a decision rather than an oversight. `effects.ts` documents that treasure and
milestone points must **not** also flow through `addScore` or `maxScore` cannot
reconcile (T5 checks that sum), and test-cave has no scoring outside the
treasure/milestone model. Adding one purely for coverage would teach content
authors the exact pattern the comment warns against, in the module they are
meant to learn the format from. T12's unit tests cover the variant — that is
T12's stated acceptance criterion.

### T9 — placeholder art ships early, ahead of T10

**A plan ordering flaw.** T9's acceptance requires a green gate; T10 lands the
art. But `npm run validate` correctly treats a missing art file as a real
error, so between T9 and T10 the gate would be red for an entire commit — and
the playbook forbids committing red. T9 therefore ships minimal placeholder
SVGs (one per artId) so its own commit is green; T10 lands the reproducible
generator (`tools/gen-placeholder-art.ts`) and regenerates them properly.

Same root cause as the T8/T9 ordering note below: **the gate couples tasks that
the plan treats as independent.**

### T16 — `use` had no owner in any task (a plan gap)

The plan never assigns the `use` verb a handler: T15 is movement/senses/meta,
T16 is handling/containers, T17 is lamp/combat. `use` falls through all three.
**T16 took it**, in `handling.ts`.

Not a judgement call — verified against the real engine before assigning it:

```
oil door with flask -> Nothing happens.
door-oiled flag set? false
turn consumed? false
```

`use` is a trigger type in the schema and test-cave authors against it, so the
gap is load-bearing rather than cosmetic. Unhandled, `oil-the-door` and
`door-already-oiled` can never fire, `door-oiled` never sets, the hidden
`grotto → deep-vault` exit stays shut, the jade idol is unreachable, and
`walkthrough.json` — which asserts `{"cmd": "oil door with flask", "expect":
"The rust gives up its grudge"}` — fails at T23. Filling in a verb the schema
already promises is a mechanical consequence of T16, not new scope.

The handler is deliberately thin: fire the trigger, consume a turn if content
answers, nudge if it doesn't. There is no generic "using" mechanic and should
not be — what `use` *does* is entirely the adventure's business. `search`
(senses.ts) is the same shape, and differs only in that its "nothing of
interest" fallback is itself an answer, so it still costs a turn.

### T18 — `manifest.lamp` gains `warnMessageId` + `exhaustMessageId` (schema change, **human-approved**)

The sixth schema gap that only real content revealed, and the first one
escalated rather than decided in-flight — it sets Hollowdeep's authoring
contract, so it was the human's call.

`zDarknessConfig` has always declared `warningMessageId` **and**
`deathMessageId`: every string it needs comes from the adventure.
`zLampConfig` declared none. So T18's fuel warning and burnout text had
nowhere to live but the engine:

> The lamp gutters, flares once, and goes out. It is bone dry.

Narrative prose, in the narrator's voice, hardcoded in `light.ts` — and it
hardcodes the word **"lamp"**. An adventure lit by a torch, a candle, or a
phosphorescent mushroom gets *"The lamp gutters"*, and the only way to fix it
is to edit the engine. That is **FR-6.1** ("adding an adventure must require
zero engine changes") failing outright, not a style quibble. The two halves of
one system were asymmetric for no reason.

**Decided:** one `warnMessageId` serves every `warnAt` threshold rather than
one string per level. This matches the 1977 original, whose single repeated
"Your lamp is getting dim" let the escalation come from the warnings arriving
closer together rather than from changing text. It also means the string never
names a number, which sidesteps inventing interpolation for the string table
(it has none) to serve one line. FR-1.4 only asks for "clear warnings at
defined thresholds".

**Both fields are required, not optional.** A default would mean the engine
still owns a fallback line, which is the bug. Cost: every fixture module in the
suite gained the two fields — mechanical, and exactly the kind of breakage a
required field *should* cause while there is one real adventure and it lives in
this repo.

**The bit worth remembering:** the gap was invisible until a task needed to
*say* something. Schemas get audited for the data a feature reads; the strings
a feature has to emit are easy to leave out, because nothing references them
until the code that prints them exists. When adding a system, ask what it will
need to say before asking what it needs to know.

### T20 — `systems/achievements.ts` does not exist, and shouldn't

The plan lists it as a T20 file. There is nothing for it to do. Every
achievement is awarded by the `award` Effect, applied at events.ts's single
choke point, from an ordinary content event — test-cave's `first-treasure-award`
fires on `take`, `win-clean` on the `both-deposited` `flagSet` with a
`deathsAtMost: 0` guard. Both are content, in the same Condition/Effect
vocabulary as everything else. `engine.ts` rightly carries no `TODO(T20)` for
achievements, only for scoring's tick and the rank.

`Achievement` also deliberately has no `when: Condition[]` the way `Milestone`
does, and must not gain one: a second condition-evaluation path duplicating
`fireTriggers`/`evalConditions` is two implementations of one rule — the exact
hazard the choke point exists to prevent.

**T20's achievement deliverable is its tests**, which is what the acceptance
bullet actually asks for ("`first-treasure` and `no-deaths` award under the
right conditions and not otherwise"). The reasoning above now lives in
`tests/engine/achievements.test.ts`'s header.

A first draft did ship the file, with read-side view helpers implementing
`hidden`. They were cut: nothing in `src/` called them, and the file's own
header noted the design plan puts achievements UI in **Phase 3, explicitly out
of scope**. Implementing `hidden` in a function with no caller does not close
that gap — `hidden` means nothing until something renders it, so it closes
where it is consumed, shaped by a real caller. **A schema field being
unimplemented is not, by itself, a reason to implement it now.**

### T21 — `saveGame`/`loadGame`, not `toSave`/`fromSave`

The task text says `toSave`/`fromSave`. Design plan §5.1 says
`saveGame(state): SaveBlob`, and T21's own acceptance bullet says
`loadGame(saveGame(s))`. Two of three agree, including the one that is a
testable contract. Used `saveGame`/`loadGame`.

### T21 — `engineVersion` and `adventureVersion` are recorded, not enforced

Both sit in the blob; neither gates a load. Deliberate, and the reasoning is
worth keeping because the opposite is superficially attractive:

- **`engineVersion`** is the loader's job, not the save's. `loadAdventure`
  already checks `manifest.engineVersion` against `ENGINE_VERSION` before a
  module exists to load a save *into*. Re-checking here would refuse saves the
  format says are fine, on a question already answered upstream.
- **`adventureVersion`** is a genuine judgement call. Content can change under
  a save in ways no version number adjudicates. An equality check refuses
  working saves after a typo fix; a permissive read allows a save referencing a
  location a later version deleted. **We take the permissive side**, because
  `saveVersion` guards the *shape* — the thing that corrupts silently — while
  missing content fails loudly on its own.

**Where this bites:** Hollowdeep, once content ships and then changes under
live saves. A deleted location or a renamed item id will produce a state
pointing at nothing. If that turns out to matter, the fix is a
`checkStateAgainstModule(module, state)` returning typed errors — a
*consistency* check, like T5's, not a version equality test. Deliberately not
built now: no content is live, and guessing at the failure modes before seeing
one would be inventing rules.

### T21 — the round-trip property is trivially true on a fresh game

`loadGame(saveGame(s))` deep-equals `s` passes on `createGame`'s output even if
the save system **drops entire fields**: nearly every collection is empty, every
optional absent, the RNG untouched. There is nothing to lose, so nothing is
lost. This is why T21's acceptance says "across a played walkthrough" — and the
first draft of that fixture still never advanced the RNG (the lamp was lit
before entering the one dark room, so darkness never rolled). A guard test
asserting the fixture is non-trivial caught it immediately; without it, the
strongest test in the file would have been quietly weightless.

**The rule:** when a property is only interesting on non-trivial input, test
that the input is non-trivial. Otherwise the fixture decays and takes the
property's meaning with it, silently, at a green gate.

### T22 — the FR-2.7 round-trip paid for itself three times

The acceptance asks that every `UIAction.command` round-trip through `step`.
That one property found three real bugs in a single run, none of which any
unit test of `availableActions` would have noticed, because each looked
perfectly correct in isolation:

| Bug | Why it survived review |
|---|---|
| `examine cup` offered while the tin cup **and** the silver chalice (also named "cup") were in scope → clicking asked *which cup* | `names[0]` is the documented canonical name. It is simply not unique, and nothing says it must be. |
| `take` offered with hands full (FR-1.2 refuses) | The item genuinely is portable and genuinely is there. The refusal lives in a rule the view never consulted. |
| `suggestions` never completed `ta` → `take` | Built from `module.vocabulary.verbs`, which is exactly what it sounds like — and holds only the adventure's OWN verbs. Core verbs ship in-engine. |

**The generalizable bit:** a read-side query that decides what to OFFER is
re-deriving what the write side will ACCEPT. Every such rule is duplicated by
construction, and every duplicate is free to drift. The only defence is to
execute the offer against the real thing. This is the same shape as T17's
`give` bug — one predicate, two verbs, two different questions — but where
T17's duplication was visible in a shared helper, this one is invisible: the
view and the handlers never touch.

**T22 also settled how "did it work?" gets asserted.** The first draft of the
round-trip grepped output for refusal phrases, and immediately produced a
FALSE failure: `twisty-1`'s `e` exit works fine, but the room beyond says
"…there is nothing you would care to meet at speed", which the regex read as
the engine refusing. Prose cannot distinguish the engine's voice from the
adventure's — the exact mistake that let a real bug through T15 behind a
`/lamp/i` assertion, made again while writing the file that criticizes it. The
fix is to assert a real invariant instead: **a refusal, a nudge, and a parse
error all consume no turn; every genuine action consumes one.** No prose, no
judgement.

### T22 — a `chance` condition on an exit guard would flicker (latent)

`evalConditions` DRAWS RNG for a `chance` condition. Everything in `view.ts` is
a read-side query a UI calls on every render, so `exitPassable` discards the
returned state and nothing in the file returns a `GameState` — otherwise the
seeded sequence would depend on how often the screen repainted, and T23 plus
every seeded test would be hostage to the renderer. **Rendering must never be a
move.**

The residue: an exit guarded by `chance` answers differently on each call and
would flicker in and out of the UI. No content does this and test-cave cannot
reach it.

**Where it bites:** Hollowdeep, if any exit guard uses `chance`. The clean fix
is a `checkConsistency` rule refusing `chance` in an exit `if` — a random
passage is better modelled as an event anyway. Not built now: it forbids a
content pattern nothing has asked for, and that is a design call, not a
mechanical consequence.

### T22 — `suggestions` completes verbs in noun position (minor)

`take f` suggests `fight` alongside `flask`: the pool is position-blind, since
knowing that `take` wants a noun next would mean parsing partial input. FR-2.6
asks only for prefix-filtered suggestions over currently-valid vocabulary, and
the UI does not wire this until Phase 3. Worth revisiting there, with a real
input box to feel it against.

### T23 — the room name is not in the transcript, and never was

The walkthrough asserted room names ("Tin Shed", "Entry Hall") on six arrival
steps. The transcript has never contained them. Not an engine bug — a settled
design decision the content author (T9) did not know about:

- Design plan §6 gives the location name to **`ScenePanel`**, and `SceneView`
  carries a `name` field precisely so the UI can render it.
- `movement.ts`'s `moveDescription` and `senses.ts`'s `lookHandler` both print
  the description alone. Both were reviewed and committed that way.
- **The 1977 original had no name header either.** It printed a long or short
  description, which is exactly what test-cave's `brief` fields imitate ("You
  are at the end of a road before a small brick building.").

Three independent sources agree, so this was not ambiguous and the walkthrough
was corrected rather than the engine. The assertions now use distinctive
substrings of the text the engine really prints — and two of them land on the
`brief`, because those rooms are revisits, which pins the brief-on-revisit rule
as a bonus.

**Worth noticing:** the content author and the engine author were the same
agent, days apart, and still disagreed about the format. Content written
against an unbuilt engine encodes assumptions about it, and T23 is where they
get audited. That is the whole reason the plan schedules an end-to-end test
against real content rather than trusting unit tests plus a walkthrough that
nobody runs.

### T23 — seed-independence means the OUTCOME, not the transcript

The first version of the test asserted identical transcripts at every seed, on
the reasoning that nothing on the winning path may draw. It failed immediately
— and it was **the test that was wrong**.

`maze-mutter` is a `chance: 0.3` ambient line on entering the maze ("something
small dislodges a pebble and declines to explain itself"). It fires in about
half of all runs and does nothing but print. So the walkthrough path really does
consume RNG, by design, and the prose legitimately differs between seeds.

NFR-4 promises **completability** does not depend on luck. It never promised the
cave would be silent about it. Demanding identical transcripts would have been
demanding that content may not have atmosphere — a rule nobody wrote, enforced
by accident, that would have been "fixed" by deleting a good piece of writing.

The assertion now compares **material outcome** across seeds — score, rank,
achievements, deaths, item locations, milestones — which still catches the bug
§8 exists to prevent (mutation-checked: make the theft time on the seed and it
fails at once), while permitting deliberate randomness. A companion test asserts
that the flavour *is* seed-dependent, so the weaker comparison cannot quietly
become unnecessary without someone noticing.

**The rule:** before strengthening an assertion because it *feels* like the
system should be that deterministic, check what the requirement actually
promised. An over-strong test does not fail safe — it fails toward deleting the
feature that contradicts it.

### T25 — the dark room had a picture of itself (a real bug, and a good lesson)

`describeScene`'s dark branch carefully emptied `items`, `creatures`, and
`exits` — then returned `artId: location.artId`. `ScenePanel` drew the room's
illustration above a caption reading "It is pitch dark."

Three things worth keeping from this one:

**1. The subagent reasoned correctly from a false premise.** Its comment:

> `scene.artId` is already `location.artId` in BOTH the lit and dark branches
> … the engine never swaps in a "can't-see-the-room" placeholder image for
> darkness — so the accompanying alt text naming what the (already-shown) art
> depicts discloses nothing the image isn't already showing.

That is *valid*. It observed the engine's behaviour, inferred the behaviour was
intended, and built on it — including making the accessibility story worse, on
the grounds that the leak already existed. **"The engine already does X" is
evidence about the code, not about the design.** When downstream work leans on
an upstream behaviour, that is the moment to check the behaviour was chosen.

**2. TypeScript caught nothing, and could not have.** `` `${scene.artId}.svg` ``
happily interpolates `undefined` — a template literal accepts it silently. The
fix would have shipped `/art/undefined.svg` and a broken image with a green
typecheck. Found by driving the browser and looking at the dark room, which is
now four for four on bugs no test and no diff review caught.

**3. The boundary belongs in the engine, per `view.ts`'s own header** — "rather
than in a component that a later redesign (Phase 3 replaces this UI wholesale)
could quietly forget". So `SceneView.artId` became **optional and omitted** when
dark rather than being filtered in `ScenePanel`: a UI cannot render what it was
not given. The rule that the file argued for was the rule the file broke.

The leak was small today (placeholder art carries only the room's name) and
large soon: Phase B ships a painterly illustration of every location.

### T26 — the guard that broke the thing it was guarding

T26's brief says "shortcuts must not fire while the command input has focus."
Read as a blanket, that includes `Ctrl+S` — and the first implementation did
exactly that, arguing a uniform rule is easier for a player to learn. Measured
in a real browser:

```
input focused : Ctrl+S -> defaultPrevented: false, dialog open: false
body  focused : Ctrl+S -> defaultPrevented: true,  dialog open: true
```

The command input autofocuses and is the primary interface, so **the broken
case was the normal case**. Worse than a dead shortcut: with no
`preventDefault()`, the keystroke falls through to the browser, so a player
mid-command who reaches for Ctrl+S gets Chrome's *"Save page as…"* dialog. The
implementation's own comment said `preventDefault()` was there to stop precisely
that — the guard just returned before it.

**The rule had one purpose: a bare letter typed into the input must not also be
a command.** `l` in "light lamp" is the entire hazard. `Ctrl+S` cannot collide
with typing — you cannot type an `s` with Ctrl held — so the blanket reading
bought nothing the narrow one didn't, and cost the shortcut its only useful
moment. The uniformity argument doesn't survive contact either: what a player
learns from it is "Ctrl+S works, except while I'm doing the thing I do
constantly."

**The general shape:** a guard written to prevent a *collision* was applied to
an input that cannot collide. When a rule is phrased as a place ("not while X
has focus") but its reason is a mechanism ("letters are ambiguous with typing"),
the place will eventually include something the mechanism doesn't cover. Check
the reason, not the phrasing.

**On measuring it:** the first probe listener gave an inconsistent reading,
because `useKeyboard`'s effect deps are inline closures, so it re-subscribes on
every render and the app's listener can end up registered *after* an externally
attached one. Order-dependent probes are a trap. `target.dispatchEvent(ev)`
returns `false` iff some listener called `preventDefault()` — an
order-independent measurement of the only thing that matters.

### Post-merge — the three known gaps, closed (2026-07-16)

The three items this document had been carrying as "decide before Phase 2".

**1. `Condition.all`** — the format could not express "flag a AND flag b". Fixed
additively; `ENGINE_VERSION` 1.0.0 → 1.1.0. `all` holds **leaves only**, because
`[{all:[a,b]}, {all:[c,d]}]` is disjunctive normal form and DNF expresses any
boolean formula — nesting adds no power, only tree. The recursive version was
tried first and abandoned for a better reason than taste: **the probe lied.** A
recursive getter parsed and inferred fine under `tsx`, which does not typecheck;
`tsc` rejects the circular inference outright. *Probe the layer the gate checks,
not the one that is easy to run.*

**2. Borrowed prose** — now a consistency rule (`borrowed-source-text`,
`schema/borrowed-text.ts`). Verified against the real bug by re-introducing the
five lines: all three call sites flagged, naming the source and §9.

The honest scope: **it cannot prove originality**, and nothing can except a
person who has read the source. It catches the failure that actually happened —
famous lines are famous because they are memorable, which is exactly why they
arrive unbidden while writing in the genre, and they are a short finite list.

The curation rule is the load-bearing part. **Only phrases distinctive enough
to be quotation.** "It is pitch dark" is deliberately absent: it is the plain
English for the situation, and a check that flags ordinary sentences gets
switched off, after which it defends nothing. There is a test asserting the
check stays silent on innocent prose, and it is as important as the ones
asserting it fires.

**3. LICENSE** — MIT, human's choice. The README notes that the generated art
may also depend on FLUX.2-klein's own licence; **that was not verified** (the
local model cache holds weights only, no licence file) and wants checking before
the art is published anywhere.

### T3 — `--passWithNoTests` retired early

Orchestrator note 1 scheduled its death for "T4's first tests". T3's
`lint-guards.test.ts` turned out to be the first test file, so the flag came
off there. Left in place it would let the gate pass green on an empty suite.

### T8 — run serially before T9, not in parallel

The plan marks T8 `parallel-safe with T9` on the grounds that their files are
disjoint (`tests/validator/**` vs `adventures/test-cave/**`). They are — but
the **gate** couples them: `npm run validate` globs `adventures/*`, so a
half-authored test-cave sitting in the tree turns `validate` red and blocks
T8's commit. Ran T8 first instead; both are green and independently verifiable.

**General lesson for the rest of the plan:** file-disjointness is necessary but
not sufficient for parallel safety. The gate is a shared resource.

---

### T12 — trigger guards evaluate against a snapshot (a real bug, caught by a test)

**The rule:** when a trigger fires, *every* matching event's guard is evaluated
against the state as it was when the trigger fired. Only then do the surviving
events apply their effects, in order. **Guards decide together; effects happen
in sequence.**

The first implementation did the obvious thing — check each guard against
whatever the previous event just did — and a test caught it bouncing the player
back to the road on `zeeble`. A sweep of test-cave found the same bug in three
of the six trigger-sharing event pairs:

| Trigger | Sequential guards (wrong) |
|---|---|
| `word: zeeble` | descend moves you to entry-hall → ascend's `atLocation: entry-hall` guard now passes → bounced back |
| `search tree-trunk` | reveal-key sets `tree-searched` → "the hollow is empty now" fires in the same turn |
| `use rusted-door` | oil-the-door sets `door-oiled` → "the hinges are already slick" fires in the same turn |

Each is a pair of **mutually exclusive** events, which is a completely ordinary
way to author content. A snapshot keeps them exclusive. Sequential guards would
force an author to reason about the relative order of every event sharing a
trigger — spooky action a data file must not have.

**This generalizes:** any adventure will write "do X, else say why not" as two
events on one trigger with opposite guards. It has to work.

### T12 — `setFlag` cascades into `flagSet` triggers

`flagSet` triggers had no one firing them, which made test-cave's `win` (on
`flagSet both-deposited`) unreachable from `victory-on-idol` (which sets it).
`applyEffects` now cascades, with two limits:

- **Transition only** — re-setting an already-set flag does not re-fire.
  `packrat-arms` re-sets its flag on every take; announcing that each time is
  noise at best and a loop at worst.
- **Depth-bounded (8)** — two events that set each other's flags would hang the
  engine, and the validator would accept them. An engine that stops beats one
  that hangs. test-cave's deepest real chain is 2.

### T16 — a container could be put inside itself (a real bug, caught by driving it)

`put box in box` succeeded, leaving the box located **at itself**: carried by no
one, in no room, reachable by no scope resolution, and taking its contents with
it. Permanent item loss from one legal command. The transitive case (`put sack
in bag` when `bag` is inside `sack`) orphaned both.

No test would have found this, and neither would a reading of the diff — the
handler looks right. It surfaced from **driving the engine**, the same way
T15's prose bug did.

test-cave cannot trigger it (both its containers are non-portable), which is
exactly why it was worth fixing now rather than filing: nothing downstream in
this plan would ever have gone red, and Hollowdeep will certainly ship a
portable sack. Fixed in `putHandler` by walking the containment chain upward
from the destination and refusing if it reaches the item — bounded against
cycles, so a corrupt state cannot hang the walk.

**Counted as in-scope for T16, not scope creep:** "container nesting" is one of
T16's stated acceptance criteria, and a cycle is a nesting case — the
degenerate one.

**The generalizable bit:** `moveItem` treats item ids and location ids as one
flat namespace, so "inside item X" and "in room X" are the same kind of edge.
That is what makes the containment graph capable of cycles at all, and the
check has to live in the handlers that build those edges — the schema cannot
express it and the validator cannot see runtime state.

### T17 — `give` asked the right question of the wrong subject (a real bug)

`isWardedOff` answers **"is the player warded?"** That is exactly right for
`attack`: a lit lamp wards the rat off regardless of what you swing. Under
`give` it meant carrying a lit lamp made the rat accept — and destroy — *any*
item offered:

```
> give flask to rat      (rat's wardOff.itemIds is ['brass-lamp'] and nothing else)
    You set the flask down for the rat, which accepts the tribute...
flask location: nowhere
```

The flask was annihilated by a rat with no interest in it, and the
`"has no interest whatsoever"` refusal was unreachable while carrying a lit
lamp — which, in a dark cave, is always. `give lamp to rat` destroyed the only
light source permanently: dark cave, no lamp, unwinnable.

`give` has to ask a different question — **does the creature want THIS item?**
Same field, different subject.

**Two lessons worth more than the fix:**

- **A shared helper is not a shared question.** `attack`/`throw`/`give` all
  consult `wardOff`, which made one predicate look like the obvious
  factoring. Three verbs reading one field were asking three different things
  of it. The subagent's own comment argued no item-specific check was needed
  because the general carrying check cannot produce **false negatives** — true,
  and beside the point. The bug was **false positives**. Worth checking, when a
  guard is reused across verbs, that they're asking the same question and not
  merely reading the same data.
- **Don't invent mechanics out of fields that don't claim them.** Accepted
  gifts were moved to `nowhere`, on the reasoning that a creature given
  something consumes it. `schema/creature.ts` has no gift, tribute, or
  creature-inventory concept anywhere — `wardOff` claims only to ward off. The
  invented mechanic bought an unrecoverable state. Gifts now land at the
  creature's location. **When the schema is silent, the engine does the
  recoverable thing.**

## Latent issues — noted, not fixed

Things that are correct for this plan but will bite later. Recorded here rather
than fixed, because fixing them now would be scope creep.

### Reachability BFS follows exits only (T5)

A location reachable **only** by magic-word teleport would be reported as an
`orphan-location`. This does not affect test-cave (every room has an exit
path), and the design plan §4.2 explicitly specifies the BFS over exits.

**Where it bites:** Hollowdeep, if any room is teleport-only. Modeling it
properly is awkward — a `teleport` effect is global (an event can fire
anywhere), so there is no single source node for the edge.

### ~~Conditions cannot AND two of the same field (T9)~~ — **FIXED 2026-07-16, `Condition.all`**

The composition rule is "fields within one Condition AND together; a
`Condition[]` ORs". But each field appears **once** per condition. So:

- `{flag: 'a', hasItem: 'b'}` — fine (different fields, ANDed).
- `[{flag: 'a'}, {flag: 'b'}]` — **ORs**, not ANDs.
- "flag A **and** flag B" — **inexpressible.**
- "chalice at shed **and** idol at shed" — **inexpressible** (one `itemAt` per
  condition).

test-cave routes around it: each victory event's *trigger* supplies half the
test (`on: drop silver-chalice` + `if: [{atLocation: 'shed', itemAt: {item:
'jade-idol', location: 'shed'}}]`), so only one `itemAt` is ever needed. That
trick works because a trigger names one entity — it does not generalize.

**Fixed after the merge**: `Condition.all` (ENGINE_VERSION 1.1.0). Kept here
because the *diagnosis* is the durable part — a field that appears once per
condition cannot be ANDed with itself, and no amount of array nesting fixes
that. See the post-merge entry above for the shape that was chosen and why it
does not nest.

### `creature.deathMessageId` is overloaded, and undocumented (T19)

`deathMessageId` is the only message field a creature has, and it carries **no
doc comment** — unlike almost every other field in the schemas. T9's content
already uses it two different ways: the rat's is the message shown when it
kills you; the packrat's (`packrat-taunt`) is the message shown when it **robs**
you. A thief can never kill, so the field is unambiguous *per creature* and
T19's engine reads it correctly for both — no bug, and no prose is wrong.

But the name lies for half its uses, and a field with no docstring being read
two ways is how T17's `give` bug started. **For T27's authoring guide:** either
document `deathMessageId` as "the message this creature is defined by — its
kill for a stalker, its theft for a thief", or split it (`theftMessageId`)
before Hollowdeep authors against the wrong reading. Not fixed here: it changes
no behavior, and renaming a content field mid-plan buys nothing.

### The thief is dodgeable by timing (T19) — decided, not a bug

If `stealAfterTurns` elapses while the player happens to be carrying nothing,
the theft fires, takes zero items, prints nothing, and marks `hasStolen` — so
it never comes back. A player can beat the packrat once, by accident or by
timing.

This is the honest consequence of "the theft is deterministic and draws no
RNG", which is a deliberate, documented decision (design plan §8) protecting
T23. The alternative — waiting until the player *has* something — would make
theft timing depend on player behavior in a way no `stealAfterTurns` value
describes. Worth a deliberate look for Hollowdeep, where a dodgeable thief may
or may not be the intent.

### `addScore` can silently break `maxScore` accounting (T4/T5)

T5 counts positive `addScore` in `once: true` events toward attainable points
and errors on positive `addScore` in a repeatable event (unbounded score). A
*negative* `addScore` in a repeatable event is silently excluded. That is
correct for now but is an accounting hole if content ever leans on it.

### Toolchain pinned below latest (T2)

TypeScript 5.9 and Vite 7.3, though TS 7.x and Vite 8.x are on the registry.
TS 7 is the native-compiler rewrite; Vite 8 needs `@vitejs/plugin-react` 6.
With 25 tasks still to run against the scaffold, a compiler swap mid-plan buys
nothing. **Revisit at closeout (T27).**

---

## Verification practices worth keeping

Things that caught real problems, recorded because they are cheap to repeat.

### Mutation-check the tests that ARE the enforcement mechanism

T3's lint guards were first written to mirror the rule block from
`eslint.config.js` rather than exercise it. All 12 tests passed — and would
have kept passing if the entire engine-purity override were deleted, silently
retiring exit criterion #4. Reworked to resolve the **real** config from `cwd`
(layering `disableTypeChecked` + `projectService: false` so virtual filePaths
lint without a tsconfig entry), then **verified by mutation**: removing the
guard block fails exactly 6 of 12 tests.

Same technique confirmed T5's consistency tests genuinely bind to the
implementation (neutering `checkConsistency` to `return []` fails 37 of 44; the
7 survivors are the valid-module cases that correctly expect `[]`).

**The rule:** when a test suite exists to enforce a contract, prove it fails
when the contract is removed. A green suite is not evidence until then.

**It caught a fresh one in T18.** Two new `checkConsistency` rules (the lamp
message ids) were added along with a green gate at 537 — and deleting both
rules outright failed **zero** tests. The rules were real, the gate was green,
and nothing whatsoever held them in place. Tests added; the same mutation now
fails exactly its two. Note the timing: this was a rule *I* added minutes
earlier and would have sworn was covered. Write the check and the test that
kills it in the same sitting, or the check is decoration.

### Probe the library API before writing against it

Zod 4's `z.record(enum, value)` requires **every** enum key. Exits are
`Partial<Record<Direction, Exit>>` and need `z.partialRecord` — a five-minute
probe caught what would otherwise have been a bug in every location in the
game. (`tseslint.configs.disableTypeChecked` is likewise a single config
object, not an array.)

### Drive the game, not just the test suite

Two of the three real bugs found so far were invisible to unit tests and to
diff review, and fell out of playing the thing for one minute:

- **T15** — `look` printed "You can see An iron key lies here." Every test
  passed; item `brief` is already a complete sentence in the narrator's voice,
  so wrapping it in engine prose is the engine talking over the adventure.
- **T16** — `put box in box` destroyed the box and its contents. Needed a
  portable container to reach, which test-cave has none of, so it took
  deliberately synthesizing one.

- **T15 (again, found during T16)** — `inventory` printed each item's `brief`
  too: "You are carrying: A brass lamp sits on the shelf, waiting to be
  useful." There *was* a test, and it passed: it matched `/lamp/i`, which the
  name and the brief both satisfy. A test that cannot distinguish the right
  field from the wrong one is not coverage. Fixed in `3f3e1fe` (separate
  commit — T15's file, not T16's lane).

**The rule:** after each action task, walk the cave. Tests check the cases
someone thought of; playing surfaces the ones nobody did.

### Vary the fixture along the axis nobody varied (T20)

`rankFor` seeded `best` with `ranks[0]` before checking whether `ranks[0]`
qualified. The same rank table written **best-first** — which nothing in
`zScoring` forbids — handed every score the top rank:

```
best-first: score 0 -> Master of the Test Cave
```

A player who scored zero, crowned Master, at the one moment the game owes them
an honest verdict.

There *was* a boundary test, and a good one: "resolves a synthetic table at
every boundary, not just the middle of a band". It passed. Its synthetic table
was **also ascending** — the fixture and the real content shared the one
property that hid the bug, so testing more values along the score axis could
never find it. The bug wasn't at a band edge; it was in the seed.

**The rule:** when a schema permits something content happens not to do
(unsorted tables, empty arrays, a portable container, a light source not called
a lamp), the fixture inherits the content's habits and the test inherits the
blind spot. Ask what the schema *allows* that every fixture happens to avoid,
then build one that does it. Compare: T16's container cycle needed a portable
container test-cave doesn't have; T18's lamp prose needed an adventure whose
light isn't a lamp. Same shape, three times now.

**The corollary:** if a data structure's meaning must not depend on its order,
test it shuffled. `zScoring`'s own `.refine` comments already name
order-dependence as the hazard ("which one wins would depend on array order") —
the schema was defending against it while the engine quietly relied on it.

**The `brief` trap generalizes.** Three handlers so far have reached for
`brief` because it is the shortest human-readable string on an `Item`. It is
not a name — it is the adventure's prose for one situation (an item lying in a
room), and every other use puts the engine's frame around the narrator's
sentence. When T22's `SceneView` and T25's panels need to name an item, they
want `names[0]`. Worth a line in T27's authoring guide: `names[0]` is the
canonical name, `brief` is in-room only, `description` is for `examine`.

### Drive the CLI, don't trust the paste

T7 was verified by pointing it at throwaway modules outside the repo: a clean
module exits 0 with its confirmation line, a module with five planted errors
reports all five grouped and exits 1, and `engineVersion: ^2.0.0` is refused
against the 1.0.0 engine. The semver matcher was separately probed across 16
cases including the `^0.2.0`/`^0.0.3` edge semantics and **fail-closed**
behavior on ranges it cannot parse (`>=1.0.0 <2.0.0`, bare `1.0`).

---

## Open questions resolved in-flight

Per the implementation plan's "Open questions" section, both remaining
questions were **T9's call**, decided in-task and confirmed by the validator
(the scoring arithmetic reconciles at exactly 100):

- **test-cave location count → 11.** The §8 table's 11 rows are right; the "10
  locations" prose is stale. Each room carries a distinct engine feature, so
  dropping one to satisfy FR-6.5's approximate 5–10 range would cost coverage.
- **`maxScore: 100` split → 20 carry + 25 deposit per treasure (=90) + 10 grate
  milestone.** Achievements award no points; the death penalty is a deduction
  that does not count toward `maxScore`.
- **Corollary:** the walkthrough must never die, or it silently forfeits the
  `no-deaths` achievement and breaks T23. The `ledge` death, reincarnation, and
  score penalty are exercised by unit tests (T15/T20), never by
  `walkthrough.json`.
