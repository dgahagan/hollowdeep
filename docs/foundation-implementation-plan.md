# Foundation Implementation Plan — Engine Core, Module Format, Minimal UI

**Status:** READY (2026-07-15)

Execution plan for [`docs/foundation-plan.md`](foundation-plan.md) (the WHAT/WHY);
rules live in [`docs/orchestration-playbook.md`](orchestration-playbook.md).
Decisions and deviations made while executing this plan are recorded in
[`docs/foundation-execution-notes.md`](foundation-execution-notes.md).

> **Cleared to run (2026-07-15).** The design plan is signed off as READY and its
> §8/§9 thief contradiction is resolved (deterministic theft — see T9/T19/T23).
> The two remaining open questions below are **T9's to settle, not blockers**:
> the orchestrator should decide them in-task and state the choice in T9's commit.

---

## Kickoff

A fresh Opus session should execute this with:

```
/run-plan docs/foundation-implementation-plan.md
```

If starting cold without the slash command: read
[`docs/foundation-plan.md`](foundation-plan.md) (the design),
[`docs/orchestration-playbook.md`](orchestration-playbook.md) (Rules of
Engagement, model policy, gate) and this file, then execute the task graph in
order — one subagent per task at the task's model, review the diff, run the gate
yourself, commit, tick the tracker, repeat. Never commit red. The Progress
Tracker at the bottom is the source of truth for resuming.

## Scope & branch

**Branch:** `feat/foundation` (created in T1, which also runs `git init` — the
repo is not yet under version control).

**In scope:** design plan §3–§9 in full — scaffold, module format v1 + validator,
headless engine core, test-cave reference module, minimal browser UI, unit +
walkthrough tests.

### Deferred / out of scope

Carried verbatim from design plan §2 — do not create tasks for these:

| Item | Reason |
|---|---|
| Auto-map, journal, hints UI, settings panel, onboarding, adventure-select screen | Phase 3 UI plan owns them |
| Achievements **UI** | Phase 3 UI plan; engine tracks + emits a transcript notice only |
| Save export/import to file (FR-5.4) | Phase 3 UI plan |
| Hollowdeep adventure content | Phase 2 content plan; blocked on the adventure design doc |
| Art pipeline, real illustrations | Phase B art plan; placeholder SVGs only here |
| Undo (FR-1.11), consistency linter beyond reachability (FR-6.6), PWA, phone layout | Post-v1 / stretch |

Also out of scope by omission: hardcore-mode toggle **UI** (FR-1.6) — the design
plan puts death-rescue policy in the UI layer, and the settings panel is Phase 3.
The engine must not encode a hardcore flag; T21's autosave ring is all that ships.

---

## Task graph

### Phase 0 — Repo bootstrap

The playbook's bootstrap caveat applies to T1–T3: `npm run gate` does not exist
until T2, so each task's acceptance criteria *are* the gate. From T4 onward the
full gate applies to every task.

---

**T1 — Initialize git repository and docs baseline** · `haiku`

- **Files:** `.gitignore` (new)
- **Does:** `git init`, add `.gitignore` (`node_modules/`, `dist/`, `.vite/`,
  `*.local`, editor cruft), commit the existing `docs/`, `CLAUDE.md`, and
  `.claude/` as the baseline, then create and switch to `feat/foundation`.
- **Acceptance:** `git log` shows one baseline commit on the default branch;
  `git status` clean; current branch is `feat/foundation`. No remote is
  configured — skip pushes for the whole plan.
- **Commit:** `chore: initialize repository with docs baseline`
- **Deps:** none

---

**T2 — Scaffold Vite + React + TypeScript** · `sonnet`

- **Files:** `package.json`, `vite.config.ts`, `tsconfig.json`,
  `tsconfig.node.json`, `.prettierrc`, `index.html`, `src/main.tsx`,
  `src/app/App.tsx`, `src/vite-env.d.ts`
- **Does:** single npm package, no workspaces. TS strict **plus
  `noUncheckedIndexedAccess`** and `exactOptionalPropertyTypes`. Vitest config
  inline in `vite.config.ts` (node environment — no jsdom; there are no
  component tests in this plan). Scripts exactly per design plan §3: `dev`,
  `build`, `preview`, `typecheck`, `lint`, `test`, `validate`, `gate`.
  `App.tsx` is a placeholder title card for now.
- **Bootstrap notes the subagent must handle:**
  - `test` must pass with zero test files at this point — use
    `vitest run --passWithNoTests`.
  - `validate` cannot work until T7. Ship it now as
    `node -e "console.log('no modules yet')"` **and leave a `TODO(T7)`
    comment**; T7 replaces it with the real CLI. This keeps `npm run gate`
    honest-green from T2 onward rather than pretending.
  - `lint` will be a stub until T3 — order T3 immediately after.
- **Acceptance:** `npm run typecheck`, `npm test`, `npm run build` all pass;
  `npm run dev` serves the placeholder page.
- **Commit:** `chore: scaffold vite + react + typescript app`
- **Deps:** T1

---

**T3 — ESLint flat config with engine-purity and determinism guards** · `sonnet`

- **Files:** `eslint.config.js`, `tests/lint-guards.test.ts`, `package.json`
  (real `lint` script)
- **Does:** flat config with `typescript-eslint` (type-aware) + React rules +
  Prettier compat. Then the architectural contract as lint, per design plan §3 —
  an override for `src/engine/**` and `src/loader.ts`:
  - `no-restricted-imports`: `react`, `react-dom`, `react/*`, and any path
    matching `src/app/*`;
  - `no-restricted-globals`: `window`, `document`, `localStorage`, `fetch`;
  - `no-restricted-properties` / `no-restricted-syntax`: `Date.now()`,
    `new Date()`, `Math.random()` (determinism, design plan §3).
- **Acceptance:** `npm run lint` clean on the current tree. `tests/lint-guards.test.ts`
  invokes ESLint's Node API on in-memory snippets and asserts each guard fires:
  a `react` import under `src/engine/`, a `Math.random()` call under
  `src/engine/`, and a `localStorage` reference in `src/loader.ts` each produce
  an error; the same snippets under `src/app/` produce none. (Fixtures are
  in-memory strings — do not commit a deliberately-bad file, it would turn the
  gate red.) Satisfies the "zero React/DOM imports, lint-enforced" exit criterion.
- **Commit:** `chore: add eslint flat config with engine purity guards`
- **Deps:** T2

---

### Phase 1 — Module format & validation

---

**T4 — Adventure module schemas (zod, v1)** · `opus`

- **Files:** `src/engine/schema/conditions.ts`, `effects.ts`, `manifest.ts`,
  `location.ts`, `item.ts`, `creature.ts`, `vocabulary.ts`, `event.ts`,
  `scoring.ts`, `achievement.ts`, `strings.ts`, `walkthrough.ts`, `index.ts`;
  `tests/engine/schema.test.ts`; `package.json` (add `zod`)
- **Does:** zod is the single source of truth — runtime validation plus inferred
  types via `z.infer`; no hand-written duplicate interfaces. Implements design
  plan §4.1 exactly. **Freeze the `Effect` union at the §4.1 list** (design plan
  §10 risk: over-general effect vocabulary) — new effects require a schema
  version bump, not an ad-hoc addition; say so in a comment in `effects.ts`.
  Export `AdventureModule` as the assembled type. Use `.strict()` on object
  schemas so typos in content files are errors, not silent no-ops.
- **Design-sensitive:** this is the engine↔content contract for every future
  adventure (FR-6.1). Get the shapes right; downstream tasks assume them.
- **Acceptance:** `npm run gate` green. Tests: each document type accepts a
  valid fixture and rejects a representative malformed one (bad enum, missing
  required field, unknown extra key); `z.infer` types are exercised by the test
  file compiling under strict TS.
- **Commit:** `feat(engine): add adventure module schemas (v1)`
- **Deps:** T3

---

**T5 — Module consistency checks** · `sonnet`

- **Files:** `src/engine/schema/consistency.ts`, `tests/engine/consistency.test.ts`
- **Does:** design plan §4.2 layer 2, as a pure function
  `checkConsistency(module, artFiles: string[]): ConsistencyError[]` — shared by
  the loader (T6) and the CLI (T7), which is why it lands first and alone.
  Checks: every exit `to`, `moveItem.to`, `initialLocation`, `teleport`,
  `stashLocation`, `spawn.locations` target resolves; every `artId` has a file;
  every event/creature/item/flag id reference resolves; every location reachable
  from `startLocation` by BFS **ignoring conditions** (conditional-only
  reachability is fine; orphans are errors); `maxScore` equals the sum of
  attainable points; `repositoryLocation` exists.
  **Errors carry `{ document, id, field, message }`** — the design plan requires
  errors that name all three.
  *T4 note:* attainable points = treasure `carryPoints + depositPoints` +
  `scoring.milestones[].points`. Milestones are declarative (`when: Condition[]`)
  precisely so this sum is derivable from data. A positive `addScore` effect
  sits outside that accounting, so treat one in a `once: false` event as an
  error (unbounded score) and count `once: true` ones toward the sum.
  Walkthrough-command parsing is checked in T7 (it needs the parser, which does
  not exist yet) — leave a `TODO(T13)` and wire it in T13's task.
- **Acceptance:** `npm run gate` green. Unit tests cover each check firing on a
  hand-built broken module and staying quiet on a valid one.
- **Commit:** `feat(engine): add module consistency checks`
- **Deps:** T4

---

**T6 — Adventure loader with injected reader** · `sonnet`

- **Files:** `src/loader.ts`, `tests/engine/loader.test.ts`
- **Does:** `loadAdventure(read: (path: string) => Promise<string>, baseDir: string,
  listArt?: (dir: string) => Promise<string[]>): Promise<AdventureModule>` —
  reads each document, zod-parses (T4), cross-checks (T5), returns the assembled
  module or throws a typed `ModuleLoadError` carrying the error list. **The
  loader never fetches or touches `fs` itself** (design plan §3/§7 — it is under
  the engine-purity lint override); callers inject the reader. Also enforce the
  `manifest.engineVersion` semver-range handshake against `ENGINE_VERSION`
  (export the constant from here for now; T14 re-exports it from `engine.ts`).
- **Acceptance:** `npm run gate` green. Tests use an in-memory reader (a
  `Record<path, string>`) — no `fs`, no network. Cover: happy path, schema
  failure, consistency failure, engineVersion mismatch.
- **Commit:** `feat(engine): add adventure loader with injected reader`
- **Deps:** T5

---

**T7 — `validate-module` CLI** · `sonnet`

- **Files:** `tools/validate-module.ts`, `package.json` (real `validate` script),
  `package.json` (add `tsx` dev dep)
- **Does:** thin CLI over T6 with an `fs` reader. Replaces T2's placeholder
  script. **Validate all modules, not one** — the playbook's gate says
  "consistency checks on `adventures/*`", while design plan §3 hardcodes
  `adventures/test-cave`; the playbook wins, so accept paths as argv and default
  to globbing `adventures/*`. Exit 0 clean, exit 1 with grouped, human-readable
  errors (`document → id → field: message`).
- **Acceptance:** `npm run validate` exits 0 (it will find no modules until T9 —
  that is a pass, and it must say so, not silently succeed on an empty glob).
  `npm run gate` green.
- **Commit:** `feat(tools): add validate-module CLI`
- **Deps:** T6

---

**T8 — Validator golden tests** · `sonnet` · **parallel-safe with T9**

- **Files:** `tests/validator/golden.test.ts`,
  `tests/validator/fixtures/*.json`
- **Does:** design plan §9 "Validator: golden tests" — a set of deliberately
  broken module fragments, each asserting its one specific consistency error
  (dangling exit target, missing art file, orphan location, `maxScore`
  mismatch, unknown event id, bad `initialLocation`). Fixtures live under
  `tests/validator/fixtures/`, **not** `adventures/`, so `npm run validate`
  never sees them.
- **Acceptance:** `npm run gate` green; each golden fixture produces exactly its
  expected error code/field and no others.
- **Commit:** `test: add validator golden tests for consistency errors`
- **Deps:** T7. Files are disjoint from T9 (`tests/validator/**` vs
  `adventures/test-cave/**`) — safe to run beside it.

---

### Phase 2 — test-cave reference module

---

**T9 — Author the test-cave module** · `opus`

- **Files:** `adventures/test-cave/manifest.json`, `locations.json`,
  `items.json`, `creatures.json`, `vocabulary.json`, `events.json`,
  `scoring.json`, `achievements.json`, `strings.json`, `walkthrough.json`
- **Does:** the 10-location fixture from design plan §8, exactly as tabled —
  `road`, `shed`, `hollow-tree`, `cave-mouth`, `entry-hall`, `low-passage`,
  `twisty-1`, `twisty-2`, `ledge`, `grotto`, `deep-vault` (note: §8's table
  lists 11 rows for a "10 locations" heading — **reconcile and state the count**;
  see §5 Open Questions). Plus the shadow-packrat thief, the cave-rat stalker,
  both treasures, the `zeeble` magic word, scoring to `maxScore: 100`, two
  achievements, and `walkthrough.json` reaching 100/100.
- **The thief is deterministic** (design plan §8, decided 2026-07-15): activate
  via `spawn.if` on first treasure carried, steal *all* carried treasure
  `stealAfterTurns` later, stash in `twisty-2`, once per game, **consuming no
  RNG**. The walkthrough must always detour to `twisty-2` to recover. This is
  what makes T23's multi-seed assertion satisfiable — do not give the thief a
  chance roll.
- **Design-sensitive:** this is simultaneously the test fixture, the
  format-documentation-by-example (FR-6.5), and the thing that must exercise
  **every** engine feature — if a feature is not in test-cave, it is untested.
  Cross-check the §8 table against §4.1's schema and §5's feature list before
  writing; every `Effect` variant and every `Condition` field should appear at
  least once.
- **Arithmetic that must close:** `maxScore` = sum of attainable points, or T5's
  check fails. Budget carry+deposit points for 2 treasures + the grate milestone
  to exactly 100; achievements award no points.
- **Note:** `walkthrough.json` is authored here but cannot be *executed* until
  T23. Getting it wrong is cheap to fix later; getting the data model wrong is not.
- **Acceptance:** `npm run validate` passes on `adventures/test-cave` (this is
  the first module the CLI has ever seen — expect real bugs surfaced in T5/T7
  here; fixing them is in scope per the playbook's "mechanical consequence"
  rule). `npm run gate` green.
- **Commit:** `feat(content): add test-cave reference adventure module`
- **Deps:** T7

---

**T10 — Placeholder art for test-cave** · `haiku`

- **Files:** `adventures/test-cave/art/*.svg`, `tools/gen-placeholder-art.ts`
- **Does:** one flat SVG per `artId` in the module (locations, items,
  creatures), each with its subject name overlaid on a muted background —
  generated by a small committed script so the set is reproducible when
  test-cave grows. Makes the art-loading path real end to end (design plan §6).
- **Acceptance:** every `artId` in test-cave resolves to a file — i.e. T5's
  missing-art check passes for real; `npm run gate` green.
- **Commit:** `feat(content): add placeholder art for test-cave`
- **Deps:** T9

---

### Phase 3 — Engine core

---

**T11 — Game state, RNG, and createGame** · `opus`

- **Files:** `src/engine/types.ts`, `src/engine/rng.ts`,
  `src/engine/state.ts`, `tests/engine/rng.test.ts`,
  `tests/engine/state.test.ts`
- **Does:** `GameState` exactly per design plan §5.2 (all plain JSON — no class
  instances, no `Map`/`Set`, they don't survive `JSON.stringify`; `visited` and
  `firedEvents` are arrays for that reason). `OutputEvent`, `SceneView`,
  `UIAction`, `StepResult` types per §5.1. `rng.ts` = mulberry32 with the seed
  state living **in** `GameState` (`rng: number`) and every draw returning
  `[value, nextState]` — no hidden mutation. `createGame(module, seed)` builds
  the initial state from the module (item locations, creature spawns, lamp fuel).
  `state.ts` holds pure read/write helpers (`itemsAt`, `isCarrying`, `setFlag`…).
- **Design-sensitive:** the state shape is what `save.ts` (T21) versions and
  migrates forever. Adding a field later is a migration; getting it right now is
  free.
- **Acceptance:** `npm run gate` green. Tests: `createGame` is deterministic for
  a fixed seed and module; `JSON.parse(JSON.stringify(state))` deep-equals
  `state` (the serializability invariant that save/load depends on); mulberry32
  reproduces a known sequence for a known seed.
- **Commit:** `feat(engine): add game state, seeded rng, and createGame`
- **Deps:** T4 (schemas). Can start before T9/T10 land if the orchestrator wants
  to parallelize, but **not** parallel-safe with them once T9 surfaces schema
  fixes — serialize unless the tree is quiet.

---

**T12 — Effect application (the single choke point)** · `opus`

- **Files:** `src/engine/systems/events.ts`, `tests/engine/events.test.ts`
- **Does:** design plan §5.3's central rule — **all** state mutation flows
  through effect application here; action handlers and triggers emit the same
  `Effect` vocabulary, so there is one tested choke point. Implements:
  - `evalCondition(module, state, cond): [boolean, GameState]` — optional fields
    AND together, arrays OR; `chance` draws from the seeded RNG and therefore
    **returns new state** (design plan §4.1);
  - `applyEffects(module, state, effects): [GameState, OutputEvent[]]` — every
    variant in the frozen §4.1 list;
  - `fireTriggers(module, state, trigger): [GameState, OutputEvent[]]` — matches
    `on.type`/`target`/`turn`/`word`, respects `once` via `firedEvents`.
- **Design-sensitive:** effect ordering and RNG consumption order are observable
  through tests-by-seed. Document the order in the file header.
- **Acceptance:** `npm run gate` green. Tests cover every `Effect` variant, every
  `Condition` field, `once` semantics, condition AND/OR composition, and that
  `chance` threads RNG state (same seed ⇒ same outcome; state advances).
- **Commit:** `feat(engine): add effect application and trigger system`
- **Deps:** T11

---

**T13 — Parser** · `opus`

- **Files:** `src/engine/parser/tokenize.ts`, `vocab.ts`, `parse.ts`,
  `tests/engine/parser.test.ts`; `src/engine/schema/consistency.ts` (resolve
  T5's `TODO(T13)`)
- **Does:** design plan §5.4 in full. Tokenize → drop noise words →
  synonym-normalize. Grammar `V`, `V N`, `V N prep N`; bare direction = `go X`.
  **Core verbs ship in-engine** (`vocab.ts` seeds them per design plan §10);
  modules extend but cannot remove them. Noun resolution scope = inventory +
  current location items/creatures/scenery + open container contents; adjectives
  narrow; ambiguity → `Disambiguation{question, options}`; `it` → `itRefers`.
  Magic words match **before** the unknown-word nudge. Returns
  `Command | ParseError{suggestion} | Disambiguation`.
  Also close T5's TODO: consistency now parses every `walkthrough.json` command
  and errors on unparseable ones.
- **Design-sensitive:** design plan §10 flags scope-resolution subtleties
  (containers, scenery, adjectives) as the known risk here and assigns it `opus`.
- **Acceptance:** `npm run gate` green. Tests: synonyms, noise words, all three
  grammars, direction shortcuts, adjective narrowing, ambiguity → question,
  pronoun resolution, magic word precedence over the nudge, unknown input
  suggesting a *valid nearby action* and never jargon (FR-2.4), `again`/`g`.
  Walkthrough commands in test-cave all parse.
- **Commit:** `feat(engine): add command parser with disambiguation and pronouns`
- **Deps:** T12

---

**T14 — Engine facade and turn pipeline (`step`)** · `opus`

- **Files:** `src/engine/engine.ts`, `src/engine/actions/index.ts` (dispatch
  table), `tests/engine/step.test.ts`
- **Does:** the public API surface (design plan §5.1) and the six-stage turn
  pipeline (§5.3): resolve `pending` → parse → dispatch to handler → world tick
  (`events` turnStart → `creatures` → `light` → `scoring`) → death handling →
  return `{state, events}`. **`step` is pure** — new state out, no mutation in.
  Two rules that are easy to get wrong and must be tested here:
  - **parse errors consume no turn** — no fuel burn, no creature tick (§5.3.2);
  - a fresh command **cancels** a pending disambiguation rather than being eaten
    by it (§5.3.1).
  Ship the dispatch table with handlers stubbed (`not implemented` → a nudge);
  T15–T17 fill them in. Export `ENGINE_VERSION` here and have T6's loader import
  it from this module.
- **Design-sensitive:** this is the contract `src/app` codes against and the
  ordering every system task assumes.
- **Acceptance:** `npm run gate` green. Tests: turn counter advances only on
  consumed turns; parse error burns no fuel and ticks no creature; pending
  question resolves by option pick and cancels on a fresh command; `step` does
  not mutate its input state (deep-freeze the input in the test).
- **Commit:** `feat(engine): add engine facade and turn pipeline`
- **Deps:** T13

---

**T15 — Actions: movement, senses, meta** · `sonnet`

- **Files:** `src/engine/actions/movement.ts`, `senses.ts`, `meta.ts`,
  `tests/engine/actions-movement.test.ts`, `tests/engine/actions-senses.test.ts`,
  `tests/engine/actions-meta.test.ts`
- **Does:** `go`/compass/`enter`/`exit`/`back` incl. conditional, hidden,
  one-way exits and `blockedMessage`; `look`/`examine`/`read`/`search` incl.
  scenery and `readText`; `inventory`/`score`/`wait`/`again`/`verbose`-`brief`.
  Handlers emit `Effect[]` and route mutation through T12 — never write state
  directly.
- **Acceptance:** `npm run gate` green. Tests drive real test-cave data (not
  hand-built stubs where avoidable): dark-room entry, hidden exit reveal,
  one-way exit, `search tree` revealing the iron key, brief-vs-full on revisit.
- **Commit:** `feat(engine): add movement, senses, and meta actions`
- **Deps:** T14

---

**T16 — Actions: handling and containers** · `sonnet`

- **Files:** `src/engine/actions/handling.ts`,
  `tests/engine/actions-handling.test.ts`
- **Does:** `take`/`drop`/`put in`/`open`/`close`/`lock`/`unlock`. Carry limits
  (FR-1.2), container `open`/`locked`/`keyId`/`capacity`, nested contents
  visibility, `portable` enforcement, taking from and putting into containers.
- **Acceptance:** `npm run gate` green. Tests: locked box needs the iron key;
  capacity refusal; container nesting; carry limit refusal message; taking a
  non-portable item nudges rather than errors.
- **Commit:** `feat(engine): add item handling and container actions`
- **Deps:** T15

---

**T17 — Actions: lamp and combat** · `sonnet`

- **Files:** `src/engine/actions/lamp.ts`, `combat.ts`,
  `tests/engine/actions-lamp.test.ts`, `tests/engine/actions-combat.test.ts`
- **Does:** `light`/`extinguish`/`refuel` (fuel config lives in
  `manifest.lamp`, not on the item — design plan §4.1); `attack`/`throw`/`give`
  including `wardOff` matching against `itemIds`/`verbIds`.
- **Acceptance:** `npm run gate` green. Tests: lighting an unlit lamp, refueling
  from the oil flask, warding the cave rat off with the lit lamp, attacking with
  nothing useful producing a wry refusal.
- **Commit:** `feat(engine): add lamp and combat actions`
- **Deps:** T16

---

**T18 — Light and darkness system** · `sonnet`

- **Files:** `src/engine/systems/light.ts`, `tests/engine/light.test.ts`
- **Does:** fuel burn per consumed turn while lit, warnings at each
  `manifest.lamp.warnAt` threshold (fired once each), darkness danger in `dark`
  locations without light (`manifest.darkness.deathChance` via seeded RNG),
  fuel exhaustion. FR-1.4.
- **Acceptance:** `npm run gate` green. Tests force outcomes **by seed choice**,
  never by stubbing RNG: a seed that kills in the dark and a seed that doesn't;
  each `warnAt` threshold fires exactly once; burn only on consumed turns.
- **Commit:** `feat(engine): add light, fuel, and darkness system`
- **Deps:** T17

---

**T19 — Creature system** · `sonnet`

- **Files:** `src/engine/systems/creatures.ts`, `tests/engine/creatures.test.ts`
- **Does:** the three data-driven behaviors from design plan §4.1 —
  `stalker` (spawn gating, `moveEvery`, `aggression` roll per encounter turn,
  `wardOff`), `thief` (activates via `spawn.if`/`afterTurn`, steals **all**
  carried treasure `stealAfterTurns` later, stashes at `stashLocation`, fires
  once per game), `static`. Behavior is **parameterized, never scripted**
  (FR-1.7). Add `stealAfterTurns` to the creature schema (T4) — a mechanical
  consequence of the 2026-07-15 deterministic-thief decision; note it in the
  commit.
- **The thief draws no RNG.** Its theft is fully deterministic (design plan §8):
  timing from `stealAfterTurns`, target = all carried treasure, destination =
  `stashLocation`. The stalker is the only creature that rolls. Getting this
  wrong doesn't fail here — it fails in T23, at a distance, as a flaky seed.
- **Critical:** design plan §10 requires the RNG consumption order within the
  tick to be **fixed and documented in this file's header** so tests can force
  outcomes by seed. Do it — T23's seed-independence test depends on it, and
  changing the order later silently breaks every seeded test in the suite.
- **Acceptance:** `npm run gate` green. Tests by forced seed: stalker spawns
  only after `afterTurn`, moves on schedule, attacks per `aggression`, is warded
  by a lit lamp; RNG order matches the documented header. Thief tests need **no**
  seed forcing — assert it activates on first treasure carried, steals all
  carried treasure exactly `stealAfterTurns` later, stashes in `twisty-2`, never
  fires twice, and **produces identical results across several seeds** (the
  regression guard for its no-RNG property).
- **Commit:** `feat(engine): add data-driven creature behaviors`
- **Deps:** T18

---

**T20 — Scoring and achievements** · `sonnet`

- **Files:** `src/engine/systems/scoring.ts`, `achievements.ts`,
  `tests/engine/scoring.test.ts`, `tests/engine/achievements.test.ts`
- **Does:** treasure carry/deposit point detection (deposit = treasure at
  `manifest.repositoryLocation`), milestones, death penalty, rank lookup at end
  (FR-1.5); achievements awarded via the `award` effect and at victory, appended
  to `state.achievements`, surfaced as an `achievement` OutputEvent — **engine +
  transcript notice only, no UI** (design plan §2).
- **Acceptance:** `npm run gate` green. Tests: carry points award once (not
  re-awarded on re-take), deposit points on reaching the repository, death
  penalty applied, correct rank at each band boundary, `first-treasure` and
  `no-deaths` award under the right conditions and not otherwise.
- **Commit:** `feat(engine): add scoring, ranks, and achievements`
- **Deps:** T19

---

**T21 — Save, load, and migrations** · `opus`

- **Files:** `src/engine/save.ts`, `tests/engine/save.test.ts`
- **Does:** design plan §5.5. `SAVE_VERSION`, `SaveBlob = {saveVersion,
  engineVersion, adventureId, adventureVersion, createdAt, state}`,
  `toSave`/`fromSave`, and a `migrations: Record<number, (old) => new>` registry.
  Mismatched `adventureId` or an unmigratable version → **typed** errors the UI
  can present (never silent corruption — FR-5.3).
  `createdAt` is a timestamp and engine code may not call `Date.now()` (lint
  will block it): `saveGame` takes the timestamp as a parameter from the caller.
- **Design-sensitive:** per the playbook's model policy, save migration is
  explicitly `opus`. This is the code that protects saves across every future
  release (brief §8: "a save made in an early build loads in the release build").
- **Acceptance:** `npm run gate` green. Tests: round-trip property —
  `loadGame(saveGame(s))` deep-equals `s` **across a played walkthrough**, not
  just a fresh state; a fabricated v0 blob exercises one real migration to the
  current version; wrong `adventureId` throws the typed error; an unknown future
  `saveVersion` throws rather than guessing.
- **Commit:** `feat(engine): add versioned save/load with migrations`
- **Deps:** T20

---

**T22 — Scene view, UI actions, and suggestions** · `opus`

- **Files:** `src/engine/engine.ts`, `src/engine/view.ts`,
  `tests/engine/view.test.ts`
- **Does:** `describeScene(module, state): SceneView` — location, artId, items,
  creatures, exits, **visible only** (hidden exits and unmet-condition exits do
  not leak; this is a spoiler boundary, not a cosmetic filter).
  `availableActions(module, state): UIAction[]` — exits + per-visible-item and
  per-inventory-item context verbs, **each carrying the command string it
  echoes**: this is the FR-2.7 mechanism that makes clicking and typing one code
  path. `suggestions(module, state, prefix)` over currently-valid vocabulary
  (FR-2.6 — ships now with tests, UI wires it in Phase 3).
- **Acceptance:** `npm run gate` green. Tests: hidden/blocked exits absent from
  `SceneView`; every `UIAction.command` **round-trips through `step`** and
  performs the advertised action (the property that keeps the two input paths
  honest); dark room yields no item list; suggestions filter by prefix and
  current validity.
- **Commit:** `feat(engine): add scene view, UI actions, and suggestions`
- **Deps:** T21

---

### Phase 4 — Walkthrough integration

---

**T23 — Scripted walkthrough test** · `opus`

- **Files:** `tests/walkthrough.test.ts`
- **Does:** design plan §9 — drives `adventures/test-cave/walkthrough.json`
  through `step()`, asserting per-step `expect` substrings, then final score
  (100), rank, and achievements. Deterministic via a fixed seed. **Plus runs at
  ≥2 further seeds asserting completability is seed-independent** — the
  walkthrough must not depend on luck.
- **Expect this to fight back.** This is the first time the whole engine runs
  end to end against real content; it is where T9's walkthrough authoring and
  T12–T20's semantics get reconciled. Fixing the walkthrough data is in scope.
  Fixing engine bugs it surfaces is in scope. **Silently loosening the
  assertions to make it pass is not.** Per design plan §8/§9 this test is now
  *known satisfiable*: the thief consumes no RNG and the stalker is wardable, so
  a seed that fails is a real content or engine bug — most likely a stray RNG
  draw in the thief path (T19) or an unwarded rat encounter the walkthrough
  should have prevented. Debug it; don't dilute the assertion.
- **Acceptance:** `npm run gate` green; walkthrough reaches 100/100 with the
  expected rank and both achievements at ≥3 distinct seeds. This is design plan
  exit criterion #2 and NFR-4.
- **Commit:** `test: add scripted walkthrough test for test-cave`
- **Deps:** T22

---

### Phase 5 — Minimal browser UI

Nothing here is meant to survive Phase 3 except the engine wiring pattern
(design plan §6). Keep it plain; resist polish.

---

**T24 — App shell, adventure loading, and game hook** · `sonnet`

- **Files:** `vite.config.ts` (adventure copy plugin), `src/app/main.tsx`,
  `src/app/App.tsx`, `src/app/useGame.ts`, `src/app/storage.ts`,
  `src/app/fetchReader.ts`, `src/app/ErrorBoundary.tsx`
- **Does:** a small vite plugin (or `npm run` copy step) publishing
  `adventures/` → `public/adventures/` so the browser can fetch module files;
  a `fetch` adapter satisfying T6's reader signature; `App.tsx` loads test-cave
  behind an error boundary that shows `ModuleLoadError` details legibly;
  `useGame` holds state and exposes `state, scene, actions, submit(input)` with
  **autosave every turn** into the ring (FR-5.2); `storage.ts` is the
  `localStorage` adapter with the design plan §6 key scheme
  (`cave.<adventureId>.slot.<n>`, `cave.<adventureId>.auto.<0..4>`).
- **Note:** `storage.ts` lives in `src/app/`, **not** the engine — engine purity
  lint blocks `localStorage` under `src/engine/**` and `src/loader.ts`. If lint
  fights you here, the file is in the wrong directory.
- **Acceptance:** `npm run gate` green; `npm run dev` loads test-cave and
  renders the start location's name; a deliberately corrupted module file shows
  the error boundary, not a blank page. `useGame` stays thin enough to leave
  untested (design plan §9).
- **Commit:** `feat(app): add app shell, adventure loading, and game hook`
- **Deps:** T23

---

**T25 — Game panels** · `sonnet`

- **Files:** `src/app/ScenePanel.tsx`, `TranscriptPanel.tsx`,
  `CommandInput.tsx`, `ActionBar.tsx`, `InventoryPanel.tsx`, `StatusBar.tsx`,
  `src/app/App.tsx` (compose), `src/app/app.css`
- **Does:** design plan §6. `ScenePanel` renders the placeholder SVG for the
  scene's `artId` with **alt text = the location's brief** (NFR-5);
  `TranscriptPanel` scrolls, styling command echoes distinctly from narration;
  `CommandInput` submits on Enter with ↑/↓ history; `ActionBar` and
  `InventoryPanel` render buttons **from `availableActions()`** and on click
  call `submit(action.command)` — the same path typing takes, echoing the
  command into the transcript (FR-2.7); `StatusBar` shows location, score, turn,
  lamp gauge.
- **Acceptance:** `npm run gate` green. Manual: test-cave is walkable **both** by
  typing and by clicking; clicks appear in the transcript as commands. Design
  plan exit criterion #3, first half.
- **Commit:** `feat(app): add scene, transcript, input, action, and status panels`
- **Deps:** T24

---

**T26 — Save dialog and keyboard shortcuts** · `sonnet`

- **Files:** `src/app/SaveDialog.tsx`, `src/app/useKeyboard.ts`,
  `src/app/App.tsx` (wire)
- **Does:** 5 named slots + the autosave list — save/load/delete, each row
  showing timestamp, location name, and score (FR-5.1; **no thumbnail** — art is
  placeholder here, that's Phase 3). Shortcuts limited to design plan §6's list:
  `i` inventory focus, `l` look, `Ctrl+S` save dialog. Shortcuts must not fire
  while the command input has focus.
- **Acceptance:** `npm run gate` green. Manual: save to a slot, **reload the
  page**, load the slot, keep playing — design plan exit criterion #3, second
  half. Loading a save written before a `SAVE_VERSION` bump shows T21's typed
  error, not a crash.
- **Commit:** `feat(app): add save dialog and keyboard shortcuts`
- **Deps:** T25

---

### Phase 6 — Documentation & closeout

---

**T27 — Authoring guide, docs refresh, and closeout** · `opus`

- **Files:** `docs/module-format.md` (new), `CLAUDE.md`,
  `docs/foundation-plan.md` (status), `docs/SCOPE.md` (deliverables checklist),
  `README.md` (new)
- **Does:**
  - `docs/module-format.md` — the engine↔content contract: every document, every
    field, every `Condition`/`Effect` variant, the version handshake, worked
    examples drawn from test-cave. **FR-6.3's bar is "a second adventure can be
    authored from the docs alone"** — write to that bar, not to a field dump.
  - `CLAUDE.md` — replace "Project Status: Planning Phase — No Code Yet" and the
    "update this file with the real commands once the Vite scaffold lands" note
    with the real commands and layout.
  - Mark `docs/foundation-plan.md` **IMPLEMENTED**; tick Phase 0/1 items in
    `docs/SCOPE.md` §6.
  - `README.md` — what this is, how to run it, how to run the gate.
- **Acceptance:** `npm run gate` green; all four design-plan exit criteria
  demonstrably met and stated in the closeout report; every Progress Tracker box
  ticked.
- **Commit:** `docs: add module authoring guide and refresh project docs`
- **Deps:** T26

---

## Progress Tracker

- [x] T1 — Initialize git repository and docs baseline (`haiku`) — `a6d6237` (pre-satisfied by the existing docs baseline; `feat/foundation` branched from it)
- [x] T2 — Scaffold Vite + React + TypeScript (`sonnet`) — `3ee784a`
- [x] T3 — ESLint flat config with engine-purity guards (`sonnet`) — `533ff4a` (also retired `--passWithNoTests`; see note 1)
- [x] T4 — Adventure module schemas (zod, v1) (`opus`) — `2564b25` (Effect is a discriminated union; Verb takes `patterns[]`; milestones declarative via `when`; added `common.ts`, `manifest.carryLimit`, `manifest.lamp`. `stealAfterTurns` is in — T19 need not add it.)
- [x] T5 — Module consistency checks (`sonnet`) — `b900c9d` (35 stable error `code`s for T8 to assert on; added unwritten-flag-read + revealExit-not-hidden checks)
- [x] T6 — Adventure loader with injected reader (`sonnet`) — `36f8f9c` (exports `ENGINE_VERSION` + `checkSemverRange`; `ModuleLoadError` carries a `LoadError[]` for T7 to group)
- [x] T7 — `validate-module` CLI (`sonnet`) — `5c7133f` (globs `adventures/*` per the playbook; both T2 bootstrap placeholders now retired — the gate is honest end to end)
- [x] T8 — Validator golden tests (`sonnet`) — `c3634e4` (run serially *before* T9, not in parallel: the gate globs `adventures/*`, so a half-authored test-cave in the tree would turn `validate` red and block this commit)
- [x] T9 — Author the test-cave module (`opus`) — `5a4ef1e` (11 locations; 100 pts = 20+25 ×2 treasures + 10 grate. Surfaced 5 schema gaps + a trigger-target hole in T5 — see execution notes. Ships placeholder art ahead of T10 so the gate stays green.)
- [x] T10 — Placeholder art for test-cave (`haiku`) — `431caad` (generator reads artIds from the module, never hardcoded; idempotency + delete/regenerate verified)
- [x] T11 — Game state, RNG, and createGame (`opus`) — `601edbf` (state.ts holds the safe accessors — downstream tasks must use them, not `!`. Added CreatureState.activatedTurn/hasStolen, the scoring ledgers, lampWarned, lastCommand, verbose.)
- [x] T12 — Effect application choke point (`opus`) — `00e3d7f` (**trigger guards evaluate against a snapshot** — sequential guards broke 3 of test-cave's 6 trigger-sharing event pairs; `setFlag` cascades into `flagSet` triggers, transition-only, depth-bounded. See execution notes.)
- [ ] T13 — Parser (`opus`)
- [ ] T14 — Engine facade and turn pipeline (`opus`)
- [ ] T15 — Actions: movement, senses, meta (`sonnet`)
- [ ] T16 — Actions: handling and containers (`sonnet`)
- [ ] T17 — Actions: lamp and combat (`sonnet`)
- [ ] T18 — Light and darkness system (`sonnet`)
- [ ] T19 — Creature system (`sonnet`)
- [ ] T20 — Scoring and achievements (`sonnet`)
- [ ] T21 — Save, load, and migrations (`opus`)
- [ ] T22 — Scene view, UI actions, and suggestions (`opus`)
- [ ] T23 — Scripted walkthrough test (`opus`)
- [ ] T24 — App shell, adventure loading, and game hook (`sonnet`)
- [ ] T25 — Game panels (`sonnet`)
- [ ] T26 — Save dialog and keyboard shortcuts (`sonnet`)
- [ ] T27 — Authoring guide, docs refresh, and closeout (`opus`)

**Done when:** every box above is ticked with its commit SHA, `npm run gate` is
green on `feat/foundation`, and all four design-plan exit criteria hold —
(1) gate passes, (2) test-cave completes to max score via the seeded walkthrough
test, (3) test-cave is playable in the browser by typing *and* clicking with
save → reload → load → continue working, (4) engine source has zero React/DOM
imports, lint-enforced. Opening a PR / merging is the human's call.

---

## Notes for the orchestrator

Cross-task consequences worth holding in mind:

1. **The gate is not green until it exists.** T2 ships placeholder `validate`
   and `--passWithNoTests` deliberately. Both are replaced (T7, T4's first
   tests). If either survives past its task, the gate is lying.
   *Update (T3):* `--passWithNoTests` is already gone — T3's `lint-guards.test.ts`
   turned out to be the first test file, earlier than this note assumed, so the
   flag was retired there. The `validate` placeholder still stands until T7.
2. **`noUncheckedIndexedAccess` will bite every engine task.** `GameState` is
   `Record`-heavy (`itemLocations`, `itemState`, `flags`, `creatures`) and every
   lookup is `T | undefined` under this flag. Expect subagents to reach for `!`
   or `as`. Push back — the strictness is the point, and `state.ts` (T11) is
   where the safe accessors belong.
3. **T9 is the first real exercise of T4–T7.** Budget for the validator and
   schemas to be wrong in ways only real content reveals. Fixing them during T9
   is a mechanical consequence, not scope creep — note it in the commit.
4. **RNG consumption order is a public contract** the moment T18's tests pick
   seeds. T19 documents it; after that, reordering a draw silently breaks seeded
   tests in unrelated files. Treat a change to it as a design decision.
5. **T23 is where the plan's assumptions meet reality.** It is placed on `opus`
   and late for that reason. If the walkthrough can't close at 100/100, prefer
   fixing content over loosening assertions, and stop rather than guess.
6. **T21's `createdAt` cannot use `Date.now()`** — T3's determinism lint blocks
   it in engine code. The timestamp is a parameter. This is the first place the
   purity rule costs ergonomics; it will not be the last.

## Open questions

Both are **T9's call** — decide in-task, state the choice in the commit, and
don't stop for them. Neither blocks `/run-plan`.

1. ~~**The design plan is DRAFT.**~~ **RESOLVED 2026-07-15** — reviewed and
   marked READY. No action needed.

2. ~~**Seed-independent walkthrough vs. a thieving creature.**~~ **RESOLVED
   2026-07-15 — deterministic thief.** The theft now fires on a trigger with a
   fixed `stealAfterTurns` delay and consumes no RNG; the walkthrough always
   detours to `twisty-2`. This mirrors Woods' pirate, where only the *timing*
   was random and completability never depended on luck. Design plan §4.1, §8,
   and §9 were amended; T9, T19, and T23 carry the spec. No action needed.

3. **test-cave location count.** Design plan §8 says "10 locations" and then
   tables 11 (`road`, `shed`, `hollow-tree`, `cave-mouth`, `entry-hall`,
   `low-passage`, `twisty-1`, `twisty-2`, `ledge`, `grotto`, `deep-vault`).
   FR-6.5 says 5–10 rooms.
   **Default: build all 11 from the table** — the prose count is stale, and each
   room in the table is carrying a distinct engine feature, so dropping one to
   satisfy an approximate range would cost coverage. Fix §8's prose to "11" in
   passing. test-cave stays this size permanently: it is a fixture, not a small
   Hollowdeep, and it gets *worse* at both its jobs (fast fixture, readable
   format reference) as it grows.

4. **`maxScore: 100` must be constructible.** T5 enforces `maxScore` = sum of
   attainable points. With 2 treasures (carry + deposit) plus the grate
   milestone, the split is unspecified.
   **Default: 20 carry + 25 deposit per treasure (= 90), grate milestone 10,
   total 100.** Achievements award no points, and the death penalty is a
   *deduction* that must not count toward `maxScore`.
   **Corollary the orchestrator must not miss:** §8 gives test-cave a `no-deaths`
   achievement awarded at victory *and* a lethal `jump` at `ledge`. These are
   only compatible if **the walkthrough never dies** — it is the clean happy
   path, scoring 100/100 and earning both achievements. The `ledge` death,
   reincarnation, and score penalty are therefore exercised by **unit tests
   (T15/T20), never by `walkthrough.json`**. Adding a death to the walkthrough
   would silently cost the `no-deaths` achievement and break T23's assertion.
