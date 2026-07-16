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

### Conditions cannot AND two of the same field (T9) — **the big one for Hollowdeep**

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

**Hollowdeep will hit this immediately** — any puzzle gated on two flags. The
fix is small (`flags?: string[]` meaning all-of, or an `all?: Condition[]`
combinator) but it is a schema-version bump and a documented contract change,
so it was left alone rather than smuggled into T9. Decide it deliberately
before Phase 2 content authoring starts.

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

### Probe the library API before writing against it

Zod 4's `z.record(enum, value)` requires **every** enum key. Exits are
`Partial<Record<Direction, Exit>>` and need `z.partialRecord` — a five-minute
probe caught what would otherwise have been a bug in every location in the
game. (`tseslint.configs.disableTypeChecked` is likewise a single config
object, not an array.)

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
