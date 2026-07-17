# Hollowdeep — Adventure Design Plan

**Status:** READY — signed off 2026-07-17. Fiction, map (§4; room-by-room in
§11), treasures and their chains (§5, §12), creatures (§6), scoring (§7), words
and secrets (§8), the maze (§9), and all three §10 questions are settled.
Prerequisite before authoring: ~~the hints + timed-events engine work (§10.2,
§10.3) needs its own design plan and must land first~~ — **built 2026-07-17**
(`docs/hints-timers-plan.md`, IMPLEMENTED): `startTimer`/`timerExpired`/
`hintsAtMost`/`hints.json`/the `hint` verb/`SAVE_VERSION 2` all shipped.
**Phase:** 2 (content). Blocks: all Hollowdeep authoring, Phase B art, v1.
**Settled by:** [PROJECT-BRIEF.md](PROJECT-BRIEF.md) §2 and §9 — decisions there
are not re-litigated here.
**Built on:** the engine as shipped. [module-format.md](module-format.md) is the
contract; where this document and the schemas disagree, **the schemas win**.

This is the WHAT/WHY. `/impl-plan` turns it into an authoring task graph once it
is settled.

---

## 1. What is already decided

Quoted from the brief so this document cannot drift from it:

> A century ago, the mining town of **Weir's Landing** sealed the entrance to
> the Hollowdeep — the cavern system that made it rich and then swallowed half
> its miners in a single night. Now the seal has cracked. You, a traveler with
> more curiosity than sense, arrive with a brass lantern, empty pockets, and a
> rumor: everything the miners ever pulled from the deep is still down there.

| | |
|---|---|
| **Scale** | ~55–65 locations: a small above-ground intro + the cave |
| **Treasures** | ~12 unique, each with its own puzzle or risk, returned to a repository |
| **Hazards** | a stalker, a thief, darkness, drops, water, **one maze on the critical path** — but *fair* |
| **Secrets** | original magic words (xyzzy tradition), ≥1 hidden area, an homage or two |
| **Endgame** | scored finale with a "last lousy point" secret. **350 points** |
| **Voice** | dry, wry, occasionally snarky — aimed at the player's *choices*, never the player |

---

## 2. Design constraints — what the engine can actually express

**Read this before designing a single puzzle.** The engine is built and its
vocabulary is fixed; a puzzle outside it is not a puzzle, it is an engine change.
T9 discovered five schema gaps while authoring an *eleven-room* fixture. At
sixty rooms and twelve puzzles, finding them late is the expensive failure this
section exists to prevent.

### The puzzle vocabulary, in full

A puzzle is **`on:` a trigger → `if:` conditions → `do:` effects.** That is the
whole language. Nothing else runs.

**Triggers (11)** — `enter`, `take`, `drop`, `use`, `read`, `open`, `search`,
`verb`, `turnStart`, `flagSet`, `word`.

**Conditions (10 fields)** — `flag`, `notFlag`, `hasItem`, `atLocation`,
`itemAt`, `creatureAt`, `visited`, `deathsAtMost`, `chance`, `all`.
Fields AND; a list ORs; `all` ANDs. `[{all:[…]}, {all:[…]}]` is disjunctive
normal form, so **any boolean guard is expressible**.

**Effects (12, frozen)** — `print`, `printId`, `setFlag`, `clearFlag`,
`moveItem`, `revealExit`, `addScore`, `teleport`, `die`, `award`, `endGame`,
`activateCreature`.

Adding a 13th effect is a schema version bump and an engine change. **If a
puzzle needs one, that is a finding for this document, not a decision to make
while authoring.**

> **The grown vocabulary shipped 2026-07-17** (`docs/hints-timers-plan.md`,
> IMPLEMENTED): the 13th effect `startTimer`, the 12th trigger `timerExpired`,
> and the 11th condition field `hintsAtMost` are built, validated, and
> exercised by test-cave. Authoring may proceed against them. One
> expressibility note from that work: the condition grammar has no complement
> of `atLocation`, so a timer's "else the player left" guard is an OR-list of
> every other room (test-cave's bee swarm is the worked example — the garnet
> and gour chains will want the same shape).

### Consequences a designer must plan around

These are not bugs. They are the shape of the thing:

| Constraint | What it means for design |
|---|---|
| **One lamp per adventure** | `manifest.lamp` is singular and `GameState` tracks one `lampFuel`. A second fuel-burning light source is a **state-shape change and a save migration** — not authorable. Design one light source. |
| **No counters** | Flags are `boolean \| number`, but no effect *increments* one. "Do X three times" cannot be counted. Model repetition as distinct flags, or don't. |
| **Timers: built** | *Was:* `turnStart` fires on an absolute turn number only, so "N turns after X" had no expression. **Built 2026-07-17 (§10.3)** — `startTimer` effect, `timerExpired` trigger, `GameState.timers`. Contract: `startTimer t n` from a player action = exactly n further consumed turns, expiry after the n-th's action. An arming `use` event must print (a silent one refuses the turn), and there is no complement of `atLocation` — "the player left" is an OR of the other rooms. |
| **`chance` is the only randomness** | And it consumes RNG, so it perturbs seeded tests. Fine in flavour; risky on the critical path — the walkthrough must win at every seed. |
| **A container is how you make a door** | `capacity: 0` + `locked` + `keyId`. That is the grate, and it is the only lock mechanism. |
| **No liquid model** | FR-1.10's "bottle of water/oil" is `moveItem` plus flags. Pouring is a `use` trigger that sets a flag; there is no volume. |
| **Creature behaviour is 3 kinds** | `stalker`, `thief`, `static`. Parameterized, never scripted. A creature that does something *else* is not authorable. |
| **`deathsAtMost` is the only history** | The only thing content can ask about the player's past beyond flags and `visited`. |
| **Achievements have no `when:`** | They are awarded by an `award` effect from an ordinary event. Every achievement needs a trigger that can fire it. |

### The arithmetic that must close

`checkConsistency` **enforces** this, and a module that fails it will not load:

```
maxScore  ==  Σ treasures (carryPoints + depositPoints)  +  Σ milestones.points
```

- Achievements award **no** points.
- The death penalty is a *deduction*; it must not count toward `maxScore`.
- A positive `addScore` in a repeatable event is a **validation error**
  (unbounded score). In a `once: true` event it counts toward the sum.
- So **350 must be constructible from ~12 treasures + milestones**, exactly.
  §6 does that arithmetic; it is not a rounding target.

### Known gaps this design must confront

| Gap | Status |
|---|---|
| **Hints have no home in the format.** SCOPE Phase 2 says "author … hints … as module data"; there are ten module documents and none of them is `hints.json`. FR-7.2 (nudge → hint → solution) is **[S]** — but FR-1.5 **[M]** and FR-1.12 both depend on it. | **Built — see §10.2.** `hints.json` is the eleventh required document; the `hint` verb, `hintPenalty`, and `hintsAtMost` shipped with it. |
| **No timed events relative to an action.** | **Built — see §10.3.** Landed on the same `SAVE_VERSION` bump as hints (1 → 2), as planned. |

---

## 3. The fiction

Settled 2026-07-16: **something was down there first.**

The miners of Weir's Landing followed a good seam east and, ninety-odd years
ago, broke through into a chamber that had been closed deliberately — walled,
from a side that was not theirs. Half of them did not come back up that night.
The town did not re-open the workings and did not explain; it sealed the adit,
wrote the men off, and kept the name.

Three things follow, and they are the spine of the design:

1. **The cave is real all the way down.** Water, rock, timber, and gravity do
   most of the killing. Nothing is haunted. The strangeness is *specific*, and
   it is behind one particular hole in one particular wall.
2. **The deeper you go, the less the things you find match each other.** The
   miners' own leavings are ordinary and sad. Past the breach the objects are
   made for hands that are not shaped like ours — and they are not decorated,
   they are *used*. Tools, not idols.
3. **The seal is the question and the answer.** The endgame is finding out which
   side it was built on, and by whom. The narrator never says the word the
   player is reaching for.

**Voice note.** The temptation here is portent, and portent would kill this
narrator. The dry register does the work: the horror is that these are
somebody's ordinary tools, left tidy, and they are the wrong shape. The narrator
remarks on the *tidiness*.

## 4. The map

**58 locations** across four regions plus the endgame — inside the brief's
55–65, and sized so each region carries a distinct feel without padding.

```
  A. WEIR'S LANDING (surface, 7)
       repository: the assay office — where treasure goes
       │  the adit, its seal cracked
       ▼
  B. THE WORKINGS (16)  ── timber, rails, tools. Man-made and legible.
       the miners' own leavings. Tier-1 treasures.
       │  the pump gave out; below here is flooded, or was
       ▼
  C. THE NATURAL CAVERN (16)  ── karst. The workings broke into it.
       includes THE MAZE (§9). Tier-2 treasures.
       │  a hole in a wall that somebody else closed
       ▼
  D. PAST THE BREACH (14)  ── older, tidier, wrong. Tier-3 treasures.
       │
       ▼
  E. THE SEAL (5)  ── the endgame. What it was for, and which side it was built on.
```

The critical path runs A→B→C→(maze)→D→E. Each boundary is a **milestone** (§7)
and each is gated by a puzzle rather than a door, so the score curve and the
difficulty curve are the same curve.

*The room-by-room graph is drawn in §11 — 58 rooms, ids, contents and exits,
region by region. The region shape above is the settled frame; the graph is the
detail and stays cheap to change.*

## 5. Treasures

Twelve, in three tiers of four. The tier is the depth, the depth is the value,
and the value is the arithmetic (§7) — so the tiers are structure, not flavour.
*The event-level chain for every treasure is worked in §12.2.*

**Tier 1 — the workings.** Ordinary, and sad rather than glamorous. What people
drop when they run.

| # | Treasure | The puzzle or the risk |
|---|---|---|
| 1 | The payroll tin | Wages nobody collected. *Findable*, not puzzling — the first treasure must arrive inside ten minutes (brief §8) |
| 2 | A pocket of cut garnets | Behind a stull you have to be willing to pull out |
| 3 | The assayer's button | A bead of gold in the office; the office is locked and the key is somewhere honest |
| 4 | The foreman's watch | Stopped at the hour. On him. |

**Tier 2 — the natural cavern.** The mine's later, greedier reach.

| # | Treasure | The puzzle or the risk |
|---|---|---|
| 5 | Silver flowstone | A sheet of native silver; taking it is a noise problem (see §6, the stalker) |
| 6 | Cave pearls | A nest of them in a gour pool. Water. |
| 7 | The Weir nugget | The thing the town is named for, and it was never in the assay ledger |
| 8 | A miner's cache | Someone hid this and did not come back for it. Reachable only from the maze. |

**Tier 3 — past the breach.** Not decorated. *Used.*

| # | Treasure | The puzzle or the risk |
|---|---|---|
| 9 | A bronze tool | The grip is wrong, and it is worn smooth by a hand that held it that way for years |
| 10 | A tally, of sorts | Marks cut into a plate. They are counting something. The narrator does not say what. |
| 11 | The warm stone | It has no reason to be warm. It is not warm *because* of anything. |
| 12 | *The thing the seal was for* | The endgame treasure. Taking it is the last decision the game asks. |

## 6. Creatures

Three behaviours exist and no more (§2), so these are cast to fit them exactly
rather than described and then wedged in.

**The stalker — `behavior: stalker`.** Not an animal, exactly, and the design
never says what it is. It wakes at depth (`spawn.afterTurn` + `spawn.if`), walks
the cavern on `moveEvery`, and rolls `aggression` when it shares a room.

Its `wardOff` is the design decision here. Light is the obvious choice and the
wrong one: the lamp is already mandatory, so warding by lamplight makes the ward
free and the stalker decorative. **It is warded by an item you have to choose to
carry** — one that costs you a hand against the carry limit. The tension is a
real trade, every trip.

**Settled 2026-07-17: the ward is a caged canary** (`canary-cage`), had on
credit at the general store from a keeper who would rather the bird earned its
keep. It is mining-true, it occupies a carry slot every trip below, and it pays
the fiction twice: the bird goes quiet when the stalker is near (per-room enter
events, §12.3), and it gets the endgame's best achievement (§12.7). Mechanic:
`wardOff: { itemIds: ["canary-cage"] }` — carried, the stalker never rolls.

**The thief — `behavior: thief`.** Something acquisitive that has had ninety
years and no competition. It takes **all** carried treasure once, after
`stealAfterTurns`, and stashes it at one location; recovering the hoard is a
detour the walkthrough must take.

It draws **no RNG** — the schema refuses `aggression` on a thief. That is what
makes "the walkthrough wins at every seed" achievable, and it is not negotiable
(design plan §8, and T19/T23 rest on it).

**Static life — `behavior: static`.** Blind fish in the sump, bats in the adit,
whatever lives on the flowstone. They exist to be examined and to make the cave
inhabited. One of them should be past the breach, and it should be **ordinary** —
the joke is that something down there is just a newt.

## 7. Scoring — the 350

Computed, not rounded. `checkConsistency` enforces
`maxScore == Σ treasures (carry+deposit) + Σ milestones`, and a module that
misses it **will not load**.

| Tier | n | carry | deposit | each | subtotal |
|---|---|---|---|---|---|
| Workings | 4 | 5 | 10 | 15 | 60 |
| Cavern | 4 | 10 | 15 | 25 | 100 |
| Past the breach | 4 | 15 | 25 | 40 | 160 |
| **Treasures** | **12** | | | | **320** |

| Milestone | Points |
|---|---|
| Enter the cave | 5 |
| Reach the breach | 9 |
| Get past the seal | 15 |
| **The last lousy point** | **1** |
| **Milestones** | **30** |

**Total: 350.** ✓

The last lousy point is a *literal one-point milestone*, so the joke is
mechanical rather than decorative: a completionist finishing on 349 has exactly
one thing left to find. Achievements award nothing (they cannot — §2). The death
penalty is a deduction and is not in this table.

## 8. Magic words and secrets

**The magic words are real miners' vocabulary.** Cornish and Welsh workings had
`kibble` (the hoist bucket), `gunnis` (a stope worked open to daylight), `winze`
(an internal shaft), `stull` (a timber). To a modern player these are
indistinguishable from magic nonsense — which is the joke, and it is an homage to
`xyzzy` without borrowing a syllable of it. They are also words the miners
*actually said*, so the fiction pays for them: the cave has heard them before.

- **KIBBLE** — the hoist word. Moves you the way the bucket did: bidirectional,
  and which way depends on where you say it (`atLocation` exists for exactly
  this; test-cave's `zeeble` is the same shape).
- **GUNNIS** — the second word, and the way into the hidden area.

Neither is ever surfaced in the UI (FR-1.9, and it is *enforced* — `suggestions`
never completes a magic word). Both are **discoverable**: scratched on a stull,
and in the foreman's tally book. So `read` sits on the critical path for
secrets, and a player who examines things is paid for it.

**The hidden area** is reached by `GUNNIS` and holds nothing needed to win — only
the last lousy point, and the answer to a question the game never asks aloud.

## 9. The maze

On the critical path (brief §9, decision 4), and **fair** — which is a design
obligation, not a disclaimer.

- **Six rooms**, sharing one `artId` and one description, exactly as test-cave's
  `twisty-1`/`twisty-2` already do. The engine lists dropped items on the floor,
  which is the classic solution: the player marks the rooms themselves.
- **Solvable without mapping.** One room has a draught, named in its
  description. Following it out is the intended path; mapping is the *fallback*,
  not the tax.
- **It pays.** Treasure 8 (the miner's cache) is inside, so the maze is worth
  solving properly rather than merely escaping.
- Phase 3's auto-map makes it kinder once rooms are distinguished — but the maze
  must be fair **without** it, because Phase 2 ships first.

## 10. Open questions

Each of these blocks authoring, and each is the human's call.

1. ~~**The fiction of the deep.**~~ **Settled 2026-07-16** — see §3.
2. ~~**Hints**~~ — **Settled 2026-07-16: build it, before Phase 2 authoring.**

   Hints turn out to be wired into more than FR-7.2's `[S]` suggests: **FR-1.5
   `[M]`** names "deductions for hints", and **FR-1.12** names a "no-hint
   completion" achievement. The engine has none of it.

   **This is a prerequisite engine change and it blocks Phase 2 authoring** —
   the point of deciding now is that puzzles get their hints written while the
   puzzle is fresh, not re-read twelve times later. It needs its own design plan
   and `/run-plan`:

   | Piece | Note |
   |---|---|
   | `hints.json` | 11th module document. Keyed by `when: Condition[]`, like `Milestone` — a hint is *available* when its guard holds |
   | `scoring.hintPenalty` | The deduction. A deduction, so it must NOT count toward `maxScore` — same rule as `deathPenalty` |
   | `GameState.hintsUsed` | **SAVE_VERSION 1 → 2 and a real migration.** Free today (no saves exist); this is exactly what T21 built |
   | `Condition.hintsAtMost` | Mirrors `deathsAtMost` exactly, and for the identical reason — an achievement content cannot otherwise see |
   | `hint` core verb | Ships in-engine like every other core verb, so every adventure gets it |

   Phase 3 draws the panel. The engine + data land first.
3. ~~**Timed events**~~ — **Settled 2026-07-17: yes, build them — on the same
   `SAVE_VERSION` bump as hints (§10.2).**

   Two puzzles in §5 want a timer, and one only looks like it does:

   - **Treasure 2, the garnets.** "Behind a stull you have to be willing to pull
     out" *is* a timer puzzle: pull the timber, the roof starts working, get in
     and out before it comes down. Without one it degrades to a `chance` roll or
     an instant death — both strictly worse, and `chance` on the critical path
     is a walkthrough-at-every-seed problem (see the constraints table).
   - **Treasure 6, the cave pearls.** The brief names water among the hazards. A
     pool that rises is a timer; a pool that doesn't is scenery.
   - **Treasure 5, the flowstone** — *does not need one.* The noise problem is
     already carried by the stalker's existing behaviour. Named here so it is not
     re-litigated later.

   | Piece | Note |
   |---|---|
   | `startTimer` effect | **A 13th variant on the frozen union.** Names a timer id and a turn count |
   | `timerExpired` trigger | 12th trigger. Fires once, on the turn the count runs out |
   | `GameState.timers` | The state field. **Rides the 1 → 2 bump hints already forces** — one migration, not two |

   **This is not a foreign concept to the engine.** The thief already does it:
   `creatures.ts:182` computes `state.turn - cs.activatedTurn` and compares it to
   `stealAfterTurns`. The engine already records when something happened and
   measures elapsed turns against it — hardcoded for one creature, never exposed
   to content. This generalizes what is already there.

   **The deadline is why this was decided now:** hints force a save migration
   regardless. Timers ride it for nearly nothing, or arrive later as
   `SAVE_VERSION 2 → 3` and a second migration for no reason.

---

## 11. The room-by-room graph

The 58 rooms, with ids, contents, and exits. Ids are the module's location ids.
Directions are shown as `n s e w ne nw se sw u d`; authoring maps them onto the
schema's exit keys. A `[guard]` on an exit is a condition (with a
`blockedMessage` in the narrator's voice); *(hidden)* means the exit is not
described until a `revealExit` — but is walkable by a player who guesses, which
is deliberate (module-format, Exits).

**Light:** everything below the adit mouth is `dark`, with two exceptions —
`behind-the-seal` (daylight through the crack) and `the-gunnis` (open to the
sky; that is what a gunnis is).

### 11.1 Region A — Weir's Landing (7)

| id | name | what's here | exits |
|---|---|---|---|
| `coach-road` | Coach Road | **Start.** The walk in; the town below, smaller than its name | e→main-street |
| `main-street` | Main Street | What is left of Weir's Landing. It is not nothing, which is somehow worse | w→coach-road, n→chapel, s→general-store, e→assay-office, ne→tailings-path |
| `chapel` | The Chapel | The memorial board with the lost men's names. The **assay office key** hangs beneath it, where keys go | s→main-street |
| `general-store` | General Store | The storekeeper (static, the only person who will talk to you); the **caged canary**, on credit (§6) | n→main-street |
| `assay-office` | Assay Office | **The repository.** Door locked (`key-office`); **T3** inside, under `search` | w→main-street |
| `tailings-path` | Tailings Path | Spoil heaps; the old tramway grade | sw→main-street, u→adit-mouth, nw→the-gunnis *(hidden)* [flag `gunnis-known`] |
| `adit-mouth` | The Adit Mouth | The seal, cracked. The town side of the question | d→tailings-path, e→behind-the-seal |

### 11.2 Region B — The Workings (16)

| id | name | what's here | exits |
|---|---|---|---|
| `behind-the-seal` | Behind the Seal | Milestone: **enter the cave.** Bats (static). Daylight gives up a few yards in | w→adit-mouth, e→adit-drift |
| `adit-drift` | The Adit Drift | Rails, straight and patient | w→behind-the-seal, n→lamp-room, s→stables, e→junction |
| `lamp-room` | Lamp Room | The deputy's station. The **oil flask** — the game's one refuel (§12.9) | s→adit-drift |
| `stables` | Underground Stables | Mule tack, tool cribs, and two tools worth taking: the **steel gad** and the **pump handle** | n→adit-drift |
| `junction` | The Junction | Where the drifts cross; the workings' hub | w→adit-drift, n→timekeepers-nook, e→shaft-head, s→long-drift |
| `timekeepers-nook` | Timekeeper's Nook | **T1, the payroll tin.** Findable, on schedule (brief §8) | s→junction, e→foremans-office |
| `foremans-office` | Foreman's Office | The **assay ledger** (lore: the count, and what is not in it); the **magazine key**, under `search` | w→timekeepers-nook |
| `shaft-head` | Shaft Head | The winze; the kibble bucket rusted on its chain. **KIBBLE endpoint.** Black water below until the pump runs | w→junction, n→pump-room, e→ore-chute, d→winze-ladderway [flag `pump-drained`] |
| `pump-room` | Pump Room | The great pump, seized, missing its handle | s→shaft-head |
| `ore-chute` | Ore Chute | The chute throat (scenery item). It has been waiting ninety years for one more careless thing (§12.5) | w→shaft-head |
| `long-drift` | The Long Drift | Timbered; **KIBBLE scratched on a stull**, waist height, plain as a signature | n→junction, w→magazine, s→stull-gallery |
| `magazine` | The Powder Magazine | Door locked (`key-magazine`). The **powder keg** and the **fuse coil**. The keg is labelled (§12.5) | e→long-drift |
| `stull-gallery` | The Stulled Gallery | **T2, the garnets**, behind a stull you have to be willing to pull out (§12.2) | n→long-drift, e→broken-drift |
| `broken-drift` | The Broken Drift | The foreman. **T4 (his watch)** and the **tally book** (GUNNIS), both on him, under `search`. **GUNNIS endpoint** | w→stull-gallery |
| `winze-ladderway` | The Ladderway | The winze's ladders, sound enough, wet to the knee where the water stood | u→shaft-head, d→shaft-foot |
| `the-gunnis` | The Gunnis | Open to daylight. Milestone: **the last lousy point.** The answer to the question nobody asked (§12.4). **GUNNIS endpoint** | d→tailings-path *(first arrival sets `gunnis-known` and reveals the climb from below — §11.6)* |

### 11.3 Region C — The Natural Cavern (16 = 10 + the maze's 6)

| id | name | what's here | exits |
|---|---|---|---|
| `shaft-foot` | Shaft Foot | Where the kibble landed its men. **KIBBLE endpoint.** Drained mud, recent water-line | u→winze-ladderway, s→breakthrough |
| `breakthrough` | The Breakthrough | Where the timbering stops and the rock stops being anyone's work | n→shaft-foot, s→low-crawl, e→cathedral |
| `low-crawl` | The Low Crawl | Wet, and exactly as tall as it needs to not be | n→breakthrough, s→black-river |
| `cathedral` | The Cathedral | The cavern's hub. Echo. You hear the stalker's gait here before you ever share a room with it | w→breakthrough, n→gallery-of-veils, e→gour-pools, s→river-strand, d→twisty-1 |
| `gallery-of-veils` | The Gallery of Veils | **T5, the silver flowstone.** Taking it is a noise problem (§12.2) | s→cathedral |
| `gour-pools` | The Gour Pools | **T6, the cave pearls**, nested in a rimstone dam. Water, with opinions (§12.2) | w→cathedral |
| `black-river` | The Black River | The blind fish (static). They stay out of the channel; note that they stay out of the channel (§12.5) | n→low-crawl, e→river-strand |
| `river-strand` | The River Strand | **T7, the Weir nugget**, wedged in a pothole; the gad frees it | w→black-river, n→cathedral, e→midden |
| `midden` | The Midden | **The thief's stash.** Ninety years of shiny things, catalogued by something's private logic | w→river-strand |
| `breach-wall` | The Breach | The hole somebody else closed — mortar laid from the far side. Blast it (§12.1) | w→twisty-5, e→beyond-the-breach *(hidden)* [flag `breach-blasted`] |

**The maze (§9), wired.** Six rooms, one `artId`; five share verbatim text and
`twisty-5` appends the one draught sentence (*"the draught is coming from the
east"* — the settled §9 reading of "named in its description"). **T8, the
miner's cache**, is in `twisty-6`, the dead end. Intended path in: down from the
cathedral, wander until the draught room announces itself, then east. Dropped
items mark rooms, per the engine.

| room | n | e | s | w | u |
|---|---|---|---|---|---|
| `twisty-1` | 2 | 4 | 3 | **1** | cathedral |
| `twisty-2` | 4 | 5 | 1 | **2** | — |
| `twisty-3` | 1 | 6 | **3** | 4 | — |
| `twisty-4` | 1 | 2 | 3 | 5 | — |
| `twisty-5` *(draught)* | 2 | **breach-wall** | 4 | **5** | — |
| `twisty-6` *(cache)* | — | — | — | 3 | — |

Bold self-loops are the classic tell that mapping is working. Every room is
reachable from `twisty-1`; `breach-wall` is reachable only through `twisty-5`;
the way back from the wall is w, then s-n or n-s to `twisty-1`, then up.

### 11.4 Region D — Past the Breach (14)

| id | name | what's here | exits |
|---|---|---|---|
| `beyond-the-breach` | Beyond the Breach | Milestone: **reach the breach.** The dust settles on the other side of the argument | w→breach-wall, e→dressed-gallery |
| `dressed-gallery` | The Dressed Gallery | Walls worked smooth. The tool marks slant a way no shoulder you know swings | w→beyond-the-breach, n→toolroom, s→store-rooms, e→closed-row |
| `toolroom` | The Toolroom | Racks, tidy. **T9, the bronze tool** — the grip is wrong, and worn smooth anyway | s→dressed-gallery |
| `store-rooms` | The Store-Rooms | Tidy stores for a shift that never came back on. **The newt** (static, ordinary — the joke, §6) | n→dressed-gallery |
| `closed-row` | The Closed Row | A corridor of shut doors. The narrator declines to try them, and says so | w→dressed-gallery, e→tally-chamber, s→long-stair |
| `tally-chamber` | The Tally Chamber | Stacked plates. **T10, the tally**, under `search`; `read` it for what it is counting — almost | w→closed-row, e→worked-face |
| `worked-face` | The Worked Face | Where they stopped digging. Mid-shift. Away from you | w→tally-chamber |
| `long-stair` | The Long Stair | Steps cut for longer legs. A gap you could jump, and shouldn't (§12.5) | n→closed-row, d→undercroft |
| `undercroft` | The Undercroft | The lower level's hub. Quieter than the acoustics explain | u→long-stair, e→cistern, s→warm-gallery, w→deep-cut |
| `cistern` | The Cistern | Their waterworks. `read` the sluice marks: the flood that took the workings started as somebody's drainage — lore closing the "or was" of §4 | w→undercroft |
| `warm-gallery` | The Warm Gallery | **T11, the warm stone**, in a niche. The canary sings here. Nothing about that is reassuring | n→undercroft |
| `deep-cut` | The Deep Cut | A single passage, dead straight, patient | e→undercroft, w→quiet-gallery |
| `quiet-gallery` | The Quiet Gallery | Even the lamp seems to burn politely | e→deep-cut, s→antechamber |
| `antechamber` | The Antechamber | The mechanism: a door with slots for a grip that isn't yours. The bronze tool makes do (§12.1) | n→quiet-gallery, s→seal-gate [flag `mechanism-turned`] |

### 11.5 Region E — The Seal (5)

| id | name | what's here | exits |
|---|---|---|---|
| `seal-gate` | The Seal Gate | Milestone: **get past the seal.** You are inside a built thing now, and it was built well | n→antechamber, d→keepers-stair |
| `keepers-stair` | The Keepers' Stair | Down, in their stride, not yours | u→seal-gate, d→keepers-walk |
| `keepers-walk` | The Keepers' Walk | A patrol route. Worn by feet, on duty, for a long time | u→keepers-stair, e→watch-room, s→the-vault |
| `watch-room` | The Watch Room | The reveal room: from here you see which way the seal faces, and therefore which side built it, and therefore why. The narrator never says the word | w→keepers-walk |
| `the-vault` | The Vault | **T12, the thing the seal was for.** Taking it is the last decision the game asks (§12.6) | n→keepers-walk |

### 11.6 Graph notes

- **Reachability.** The validator BFS ignores conditions but walks exits, so a
  teleport-only room is an orphan. `the-gunnis` therefore has a real scree exit
  down to `tailings-path`, hidden until the first GUNNIS visit reveals it and
  sets `gunnis-known` — which also opens the climb back up, because a scree you
  have come down is a scree you can climb. Validation constraint and better
  design, same move.
- **Region boundaries** are exactly the four gates of §12.1. Every other edge is
  unconditional.
- **58 = 7 + 16 + 16 + 14 + 5.** ✓ Inside the brief's 55–65 with room to give
  back if authoring finds a region flabby; cut flavour rooms (`low-crawl`,
  `deep-cut`, `worked-face`) before structural ones.

---

## 12. The puzzle chains

Every chain below is expressed as `on:` → `if:` → `do:` sketches over the grown
vocabulary (§2), and **none of them needs anything beyond it** — the two settled
timers (§10.3) are the only two timers used, and no thirteenth effect surfaced.
That was the point of drawing these before authoring.

A recurring trick, used throughout and noted once: **the `verb` trigger takes no
noun**, so every transitive custom verb rides `use` as a synonym
(`pull`, `pry`, `oil`, `fit`, `light`, `seal` → `use` in `vocabulary.json`), and
the event triggers on `use` of the target item. test-cave already does this.
Likewise **hidden-until-searched** is `initialLocation: "nowhere"` +
`on: search` → `moveItem` here, and **state-changed room prose** is an `enter`
event guarded on a flag, because descriptions are static.

### 12.1 The four gates

| Gate | Chain |
|---|---|
| **A→B, the adit** | Open — the seal is already cracked; that is the premise. Milestone `enter-the-cave` (5): `when: [{visited: "behind-the-seal"}]`. |
| **B→C, the pump** | Take **pump handle** (stables) → `use` handle on pump [`atLocation` pump-room] → `setFlag pump-fixed`, print → `use` pump [`flag pump-fixed`] → `setFlag pump-drained`, print (the sump giving the water back). Exit `shaft-head d` is guarded on `pump-drained`; its `blockedMessage` is the black water. **KIBBLE bypasses this gate** — the bucket hangs above the water — which is the secret's real value (§12.4). Walkthrough uses the pump. |
| **C→D, the breach** | `key-magazine` (foreman's office, `search`) → magazine door (container, `capacity: 0`, locked) → carry **powder keg** + **fuse coil** to `breach-wall` → `use` powder [`atLocation breach-wall`] → `setFlag powder-placed`, `moveItem` keg → nowhere → `use` fuse [`flag powder-placed`] → `setFlag fused` → `use`("light") fuse [`flag fused`] → print (the spark walks off into the dark; you walk the other way, quickly), `teleport twisty-5`, `setFlag breach-blasted`, `revealExit breach-wall e`. Lighting the **keg** instead of the fuse is a death (§12.5); the keg's label is the telegraph. Milestone `reach-the-breach` (9): `when: [{visited: "beyond-the-breach"}]`. |
| **D→E, the mechanism** | `use`("fit") **bronze tool** (T9) on the antechamber door → `setFlag mechanism-turned`, print ("It was not made for your hand. Your hand makes do."). Exit opens. Depositing T9 first is not a lockout: items can be re-taken from the repository and deposit points award once, ever. Milestone `past-the-seal` (15): `when: [{visited: "seal-gate"}]`. |

### 12.2 The twelve, chained

| # | Treasure (id) | Chain |
|---|---|---|
| 1 | Payroll tin (`payroll-tin`) | `timekeepers-nook`, in the open. `take` → carry points. The ten-minute clock (brief §8) is met: road → town errands → adit → nook is ~14 moves. |
| 2 | Cut garnets (`cut-garnets`) | `stull-gallery`. `use`("pull") stull → print (the roof clears its throat), `moveItem` garnets nowhere → here, `startTimer roof-fall 6`. `timerExpired roof-fall`: one event `if [{atLocation: "stull-gallery"}]` → `die`; a second (snapshot semantics, §2) → `setFlag roof-fallen` + print (somewhere behind you, the mountain sits down). If the garnets were still there, they are in the rubble now: `search` rubble [`flag roof-fallen`] → `moveItem` garnets → here. Deadly, fair, and never a lockout. |
| 3 | Assayer's button (`assay-button`) | The office lock **is** the puzzle: key from the chapel → `open` door → `search` the bench → `moveItem` button → here. Born at the repository — take it, drop it, and both awards land (wry, and legal). |
| 4 | Foreman's watch (`foremans-watch`) | `broken-drift`. `search` the foreman (scenery item) → watch + **tally book** revealed. The prose owes him gentleness; the narrator pays in dryness. |
| 5 | Silver flowstone (`silver-flowstone`) | `gallery-of-veils`. `use`("pry") gad on flowstone → `moveItem` → here, print (the crack goes off like a shot), `activateCreature stalker`. Taking it is choosing to wake the thing early — the noise problem, exactly as §10.3 said, carried by existing behaviour. |
| 6 | Cave pearls (`cave-pearls`) | `gour-pools`. `take` pearls → print (the rim gives; somewhere below, water starts to argue), `startTimer gour-flood 5`. `timerExpired gour-flood`: `if [{atLocation: "gour-pools"}]` → `die` (drown); else print. The pool refills and settles; the room stays passable. |
| 7 | Weir nugget (`weir-nugget`) | `river-strand`, wedged in a pothole. `use`("pry") gad → free. Without the gad, a wry refusal that names what you'd need. The ledger (B) never listed it — `read` pays lore. |
| 8 | Miner's cache (`miners-cache`) | `twisty-6`, the maze's dead end. The puzzle is the maze itself (§9); the cache is why solving beats escaping. |
| 9 | Bronze tool (`bronze-tool`) | `toolroom`, takeable. Its weight is downstream: it is the D→E key (§12.1), so it banks last — or gets re-fetched, which costs only walking. |
| 10 | The tally (`tally-plate`) | `tally-chamber`. `search` the stacks → revealed. `read` → the marks are counting something; the count is given, the unit is not. |
| 11 | Warm stone (`warm-stone`) | `warm-gallery` niche, takeable. The mood piece of the twelve — its cost is where it lives (past the stair, §12.5) and the slot it occupies on the long walk home. |
| 12 | The kept thing (`the-kept`) | `the-vault`. `take` → print (its weight, and nothing else). No trap, no timer. The decision is the endgame (§12.6). |

### 12.3 The creatures, wired

| Creature | Parameters |
|---|---|
| **The stalker** | `spawn: { locations: [cathedral, gallery-of-veils, river-strand, low-crawl], if: [{visited: "cathedral"}] }`, `moveEvery: 3`, `aggression: ~0.3`, `wardOff: { itemIds: ["canary-cage"] }`. Roams named C rooms only — never the maze (§9's fairness) and never past the breach (what wards *there* is not your problem, which is its own kind of answer). T5 wakes it early via `activateCreature`. The canary's quiet-warning is per-room flavour: `enter` events guarded `creatureAt` + `hasItem canary-cage`. |
| **The thief** | `spawn: { if: [{visited: "breakthrough"}] }`, `stealAfterTurns: ~25`, stash `midden`. Steals all carried treasure once, deterministically, no RNG by schema. The walkthrough plans one robbery and one detour to the midden; the fiction is drag-marks, never a portrait. |
| **Static life** | Bats (`behind-the-seal`), blind fish (`black-river`), the storekeeper (`general-store`), **the newt** (`store-rooms`) — past the breach, and ordinary, which is the joke §6 ordered. |

### 12.4 The magic words, wired

- **KIBBLE** — learned by `read`ing the scratched stull in `long-drift`. `word`
  event: `if [{atLocation: "shaft-head"}]` → `teleport shaft-foot`;
  `if [{atLocation: "shaft-foot"}]` → `teleport shaft-head`; else a wry line
  (the word wants machinery). Value: a hauling shortcut past the ladders, and a
  legitimate secret bypass of the pump gate — found by reading, paid by fiction.
- **GUNNIS** — learned from the tally book (on the foreman, §12.2 T4). `word`
  event: `if [{atLocation: "broken-drift"}]` → `teleport the-gunnis`, and on
  first arrival `setFlag gunnis-known` + `revealExit tailings-path nw`;
  `if [{atLocation: "the-gunnis"}]` → `teleport broken-drift`; else the wry
  line. The gunnis holds the **last lousy point** (milestone,
  `when: [{visited: "the-gunnis"}]`) and the answer nobody asked for: an older
  scar in its wall, closed from *this* side, generations before the breach —
  the town had been told once already. Nothing needed to win.
- Neither word is ever surfaced (FR-1.9, engine-enforced).

### 12.5 The ways to die (classic-lethal: eight, every one telegraphed)

| # | Death | Telegraph |
|---|---|---|
| 1 | The dark (engine `darkness.deathChance`) | The genre's oldest promise, and the lamp's whole job |
| 2 | The stull gallery roof (`timerExpired roof-fall`, present) | You pulled the stull; the roof cleared its throat |
| 3 | The gour flood (`timerExpired gour-flood`, present) | The water started arguing five turns ago |
| 4 | Lighting the keg unfused (`use` lamp/light on keg → `die`) | The keg is labelled: *NOT WITHOUT A FUSE, DAVEY* |
| 5 | The ore chute (`use`("climb") chute: first event `once` warns + `setFlag chute-warned`; second, `if` flagged → `die`) | The warning **is** the first attempt |
| 6 | The Black River (`use`("swim"): warn once, then `die`) | The blind fish stay out of the channel |
| 7 | The stair gap (`use`("jump") at `long-stair` → `die`) | The steps were cut for longer legs. The gap knew that |
| 8 | The stalker (unwarded `aggression` roll) | The echo in the cathedral; the bird going quiet |

Deaths are the deduction (§7) and `deathsAtMost` remembers. Nothing here
soft-locks a game: every death path leaves the world winnable for the
resurrected.

### 12.6 The endgame, and the two endings

- **Ending A — the 350.** A `once: true` `turnStart` event whose guard is the
  DNF `all` of twelve `itemAt(treasure, assay-office)` conditions → epilogue
  `printId` → `endGame` (win). Greed is the canon ending; the rank table's top
  rank sits at 350 and the epilogue does not congratulate you, exactly.
- **Ending B — kept the seal.** With the other eleven banked and `the-kept`
  still in the vault: `use`("seal") on the vault (scenery item), guarded by
  `all` of the eleven `itemAt`s + `itemAt(the-kept, the-vault)` → epilogue,
  `award kept-the-seal`, `endGame` (win). Tops out at 310; the rank table knows
  310 and says something 350 never hears.
- Ranks (`scoring.json`, authoring tunes the rungs): 0 *Tourist* → 60 *Mucker*
  → 120 *Timberman* → 200 *Shift Boss* → 280 *Mine Captain* → 310 *(ending B's
  word)* → 350 *(ending A's word)*. The two top titles are an authoring
  deliverable, chosen so neither is simply "better."

### 12.7 Achievements (award no points; each names its firing event)

| id | For | Fired by |
|---|---|---|
| `on-the-books` | First treasure banked | `drop` events at the repository (one per treasure, guarded `atLocation`; `award` grants once, ever) |
| `the-full-ledger` | All twelve banked | Ending A's event |
| `unhurried` | Finish without dying | Ending event + `deathsAtMost: 0` |
| `nobody-asked` | Finish without hints | Ending event + `hintsAtMost: 0` (arrives with §10.2) |
| `the-answer` | Found the gunnis | `enter the-gunnis`, `once` |
| `everything-you-carried` | Met the midden after the thief did | `enter midden` guarded by an OR-list of `itemAt(treasure-n, midden)` |
| `kept-the-seal` | Ending B | Ending B's event |
| `the-bird-went-too` | Reached the vault still carrying the canary | `enter the-vault` + `hasItem canary-cage` |

### 12.8 Support items (the non-treasures that do the work)

| id | Where | For |
|---|---|---|
| `brass-lantern` | Start inventory (the brief hands it to you) | `manifest.lamp` |
| `oil-flask` | `lamp-room` | The one refuel (§12.9) |
| `canary-cage` | `general-store` | The ward (§6); a carry slot, every trip |
| `key-office` | `chapel` | Assay office door |
| `key-magazine` | `foremans-office` (`search`) | Magazine door |
| `steel-gad` | `stables` | Pries T5, T7 (and the cache box, if authoring wants it) |
| `pump-handle` | `stables` | The B→C gate |
| `powder-keg`, `fuse-coil` | `magazine` | The C→D gate |
| `tally-book` | On the foreman (`search`) | GUNNIS; lore |
| `assay-ledger` | `foremans-office` | Lore: the count; the nugget's absence |
| Scenery that events hang on | stull, rubble, foreman, chute, pump, breach wall, mechanism door, vault | Non-portable items with `use`/`search`/`read` triggers |

### 12.9 Expressibility findings & authoring notes

1. **No new engine work found.** Every chain closes over the grown vocabulary;
   the two §10.3 timers are the only two; `chance` appears in **no content** —
   the only randomness in Hollowdeep is the stalker's die and the engine's
   darkness roll, both off the critical path (warded and lit, respectively).
   The walkthrough therefore wins at every seed by construction.
2. **One refuel per game** — `manifest.lamp.refuel` names one `itemId`,
   consumed. Accepted: `startFuel` is sized generous (target: ≥ 2× the
   walkthrough spine), the flask is the margin, and the darkness deaths stay
   honest.
3. **Carry limit: 5.** The blast run (lamp + canary + keg + fuse = 4) and the
   treasure hauls (lamp + canary + 3) both breathe, barely — which is the
   point. The canary is a real trade every trip, as §6 ordered.
4. **The `verb`-rides-`use`** and **hidden-until-searched** patterns (§12
   intro) are the two idioms authoring will use constantly; they are proven in
   test-cave.
5. **Hint ladders** (nudge → hint → solution, FR-7.2) are authored *with* each
   chain above once the §10.2 engine work lands — that ordering is the entire
   reason §10.2 blocks authoring.

### 12.10 The walkthrough spine

The shape of `walkthrough.json`, at trip level; the step-by-step is an
authoring task with a fuel-and-carry audit attached.

1. **Town.** Chapel (key) → office (open; T3 banked where it was born) → store
   (canary) → up to the adit. Milestone 5. T1 from the nook — first treasure
   well inside the ten minutes.
2. **The workings.** Stables (gad, handle) → offices (ledger, magazine key) →
   long drift (KIBBLE off the stull) → the garnet dance (T2) → the foreman
   (T4, tally book) → GUNNIS (the last lousy point) → down the scree with a
   full bag → bank T1, T2, T4.
3. **The pump.** Handle → drain → down the winze.
4. **The cavern**, canary in hand. T5 (wakes the stalker, warded), T6 (the
   flood dance), T7 (the gad). The thief takes everything once; the midden
   gives it back with interest (`everything-you-carried`). Bank via KIBBLE.
5. **The blast run.** Keg + fuse through the maze (drop-marking; the draught
   room; T8 from the dead end) → place, fuse, light, retreat → milestone 9.
6. **Past the breach.** T9, T10, T11; the mechanism (T9 in hand) → milestone
   15 → the vault, and the decision. The walkthrough takes it; ending B is a
   branch the tests exercise separately.
7. **The banking.** Everything to the assay office. 350. `expectedRank` is the
   top title; `expectedAchievements` asserts the canon set.
