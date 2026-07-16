# Hollowdeep — Adventure Design Plan

**Status:** DRAFT — in progress (started 2026-07-16)
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

## 3. The map

*To be designed. Region structure first, then the graph.*

## 4. Treasures and their puzzles

*To be designed — twelve, each with a puzzle or a risk.*

## 5. Creatures

*To be designed — the stalker, the thief, and the static life of the cave.*

## 6. Scoring — the 350

*To be computed, and it must reconcile exactly. See §2.*

## 7. Magic words and secrets

*To be designed — original words in the xyzzy tradition, ≥1 hidden area, the
"last lousy point".*

## 8. The maze

*To be designed. It is on the critical path (brief §9, decision 4) and it must
be fair: droppable items mark rooms, and Phase 3's auto-map helps once rooms are
distinguishable. `twisty-1`/`twisty-2` in test-cave share one `artId` — the same
trick applies here, and the format supports it.*

## 9. Open questions

Each of these blocks authoring, and each is the human's call.

1. **The fiction of the deep** — what actually happened the night the miners
   were swallowed, and what is down there now. Drives the regions, the
   treasures, the endgame, and the entire tone. **See the discussion attached to
   this draft.**
2. **Hints** — grow the format an eleventh document, or cut FR-7.2 from Phase 2?
   It is [S], so cutting is legitimate. Deciding *now* is what matters: a hint
   system retrofitted after 12 puzzles are authored is 12 puzzles re-read.
3. **Timed events** — does any intended puzzle need "N turns after X"? If yes,
   it is an engine change and belongs in a plan, not in authoring.
