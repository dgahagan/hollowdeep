# Hollowdeep — Adventure Design Plan

**Status:** DRAFT — fiction, map regions, treasures, creatures, scoring, secrets
and the maze are settled. Outstanding: the room-by-room graph, the puzzle
chains, and the three open questions in §10.
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

### Consequences a designer must plan around

These are not bugs. They are the shape of the thing:

| Constraint | What it means for design |
|---|---|
| **One lamp per adventure** | `manifest.lamp` is singular and `GameState` tracks one `lampFuel`. A second fuel-burning light source is a **state-shape change and a save migration** — not authorable. Design one light source. |
| **No counters** | Flags are `boolean \| number`, but no effect *increments* one. "Do X three times" cannot be counted. Model repetition as distinct flags, or don't. |
| **No timers except `turnStart`** | `turnStart` fires on an absolute turn number, not "N turns after X". The thief's delay is engine code (`stealAfterTurns`), not content. A timed puzzle ("the water rises 20 turns after you open the sluice") **has no expression**. |
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
| **Hints have no home in the format.** SCOPE Phase 2 says "author … hints … as module data"; there are ten module documents and none of them is `hints.json`. FR-7.2 (nudge → hint → solution) is **[S]**. | **Open — see §9.** Either the format grows an eleventh document (schema bump) or hints are cut from Phase 2. |
| **No timed events relative to an action.** See the table above. | **Open — see §9.** If a puzzle wants one, it is an engine change. |

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

*Room-by-room graph: next pass. Region shape and the critical path settle first
— the graph is authoring detail and cheap to change; these are not.*

## 5. Treasures

Twelve, in three tiers of four. The tier is the depth, the depth is the value,
and the value is the arithmetic (§7) — so the tiers are structure, not flavour.

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
3. **Timed events** — does any intended puzzle need "N turns after X"? If yes,
   it is an engine change and belongs in a plan, not in authoring.
