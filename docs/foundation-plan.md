# Foundation Design Plan — Engine Core, Module Format, Minimal UI

**Status:** **IMPLEMENTED (2026-07-16)** — executed via
[`foundation-implementation-plan.md`](foundation-implementation-plan.md); all 27
tasks committed on `feat/foundation` and all four exit criteria met. Decisions and
deviations made along the way are recorded in
[`foundation-execution-notes.md`](foundation-execution-notes.md); where this plan
and the code disagree, **the code is authoritative** and the notes explain why.
**Covers:** SCOPE.md Phase 0 + Phase 1
**Execution:** [foundation-implementation-plan.md](foundation-implementation-plan.md) — run it with `/run-plan`
**Related:** [PROJECT-BRIEF.md](PROJECT-BRIEF.md) · [REQUIREMENTS.md](REQUIREMENTS.md) · [SCOPE.md](SCOPE.md) · [orchestration-playbook.md](orchestration-playbook.md)

**Amendments since draft:** the thief was made deterministic (§4.1 `stealAfterTurns`,
§8, §9) to resolve a contradiction between §8's RNG-driven theft and §9's
seed-independent walkthrough requirement — see the rationale note in §8.

---

## 1. Objective

Build the playable foundation: repo scaffold, adventure **module format v1**
with validation, the **headless TypeScript engine core**, the **test-cave**
reference adventure, and a **minimal browser UI** — so that test-cave is fully
playable in the browser (typing *and* clicking) with placeholder art, and fully
playable headless in the automated test suite.

**Exit criteria** (SCOPE.md Phases 0–1):

1. `npm run gate` (typecheck, lint, test, validate, build) passes.
2. test-cave is completable start-to-finish via the scripted walkthrough test
   (deterministic, seeded), reaching max score.
3. In the browser: walk test-cave by typing commands and by clicking exits/
   items; save to a slot, reload the page, load the slot, continue playing.
4. Engine source has zero React/DOM imports (lint-enforced).

**Requirements covered:** FR-1.1–1.12, FR-2.1–2.8, FR-5.1–5.3, FR-6.1–6.3,
FR-6.5, NFR-1, NFR-2, NFR-4 (partial: full-adventure walkthrough runs against
test-cave until Hollowdeep exists), NFR-8.

## 2. Deferred / out of scope (later plans)

| Item | Where it lands |
|---|---|
| Auto-map, journal, hints UI, settings panel, onboarding, adventure-select screen | Phase 3 UI plan |
| Achievements **UI** (engine tracks + transcript notice only for now) | Phase 3 UI plan |
| Save export/import to file (FR-5.4) | Phase 3 UI plan |
| Hollowdeep adventure content | Phase 2 content plan (needs the separate adventure design doc first) |
| Art pipeline, real illustrations (placeholder art only here) | Phase B art plan |
| Undo (FR-1.11), consistency **linter** beyond reachability (FR-6.6), PWA, phone layout | Post-v1 / stretch |

## 3. Repo scaffold & tooling

Single npm package (no workspaces), Vite + React + TypeScript strict.
The repo is **not yet a git repository** — setup includes `git init` and an
initial commit of the existing docs.

```
package.json            # scripts below
vite.config.ts          # react plugin; vitest config inline
tsconfig.json           # strict, noUncheckedIndexedAccess
eslint.config.js        # flat config: ts-eslint, react; engine restrictions (see below)
.prettierrc
index.html
public/adventures/      # symlink-free copy target — see §7 loader note
src/
  engine/               # HEADLESS core — no react/DOM (lint-enforced)
  app/                  # React UI
  loader.ts             # adventure loading abstraction (fetch | fs)
adventures/
  test-cave/            # reference module + fixture (§8)
tools/
  validate-module.ts    # CLI: schema + consistency checks
tests/
  engine/               # unit tests (parser, actions, systems, save)
  walkthrough.test.ts   # scripted full playthrough of test-cave
```

**Scripts:** `dev` (vite), `build`, `preview`, `typecheck` (`tsc --noEmit`),
`lint`, `test` (`vitest run`), `validate` (`tsx tools/validate-module.ts adventures/test-cave`),
`gate` (typecheck && lint && test && validate && build).

**Engine purity enforcement:** ESLint override for `src/engine/**` and
`src/loader.ts`: `no-restricted-imports` (react, react-dom, anything in
`src/app`) and `no-restricted-globals` (`window`, `document`, `localStorage`,
`fetch`). The loader receives a `readFile`-style function from the caller
instead of fetching itself.

**Determinism:** engine code never calls `Date.now()` or `Math.random()`
(lint-restricted in `src/engine/**`); all randomness flows through the seeded
RNG in game state (§6.5).

## 4. Module format v1

An adventure is a directory of JSON documents (split per category — mirrors
the proven Thornmere layout, diff-friendly, lazy-extensible):

```
adventures/<id>/
  manifest.json       # id, title, version, engineVersion (semver range),
                      # startLocation, repositoryLocation, maxScore,
                      # lamp config (startFuel, warnAt: number[]),
                      # darkness config (deathChance, message ids)
  locations.json      # Location[]
  items.json          # Item[]
  creatures.json      # Creature[]
  vocabulary.json     # extra verbs, noise words, magic words
  events.json         # Event[]
  scoring.json        # milestones, deathPenalty, ranks
  achievements.json   # Achievement[]
  strings.json        # named message strings (deaths, darkness, thief taunts…)
  walkthrough.json    # scripted solution: [{cmd, expect?}], expectedScore
  art/                # images (placeholders in this plan) named <artId>.webp|png|svg
```

### 4.1 Schemas (zod, in `src/engine/schema/`)

Zod is the single source of truth: runtime validation + inferred TS types
(`z.infer`). One file per document type plus `conditions.ts`/`effects.ts`
shared vocabulary. Key shapes (abridged — the schema files are authoritative):

```ts
// conditions.ts — all optional fields AND together; arrays OR
Condition = { flag?, notFlag?, hasItem?, itemAt?: {item, location},
              creatureAt?, visited?, chance? /* 0..1, uses seeded RNG */ }

// locations.json
Location = { id, name, brief, full, artId,
             light: 'lit' | 'dark',
             exits: Partial<Record<Direction, Exit>>,   // n s e w ne nw se sw up down in out
             scenery?: [{ names: string[], description, readText? }] }
Exit = { to, if?: Condition[], blockedMessage?, hidden?, oneWay? }

// items.json
Item = { id, names: string[], adjectives?: string[], brief, description, artId,
         portable, initialLocation,           // locationId | 'inventory' | containerId | 'nowhere'
         treasure?: { carryPoints, depositPoints },
         container?: { open, locked?, keyId?, capacity },
         lightSource?: boolean,               // fuel lives in manifest lamp config
         readText? }

// creatures.json — data-parameterized engine behaviors, not scripts
Creature = { id, names, description, artId,
             behavior: 'stalker' | 'thief' | 'static',
             spawn: { locations: string[], afterTurn?, if?: Condition[] },
             moveEvery?, aggression?,          // stalker: attack chance per encounter turn
             wardOff?: { itemIds?, verbIds? }, // e.g. throw pebble, carry lit lamp
             stealsTreasure?, stashLocation?,  // thief
             stealAfterTurns?,                 // thief: turns after spawn until the theft.
                                               // DETERMINISTIC — the thief consumes no RNG.
                                               // See §8 note on the Woods pirate.
             deathMessageId? }

// events.json — the general trigger system (FR-1.8)
Event = { id, once?,
          on: { type: 'enter'|'take'|'drop'|'use'|'read'|'open'|'turnStart'|'flagSet'|'word',
                target?, turn?, word? },
          if?: Condition[],
          do: Effect[] }
Effect = { printId? | print?, setFlag?, clearFlag?, moveItem?: {item, to},
           revealExit?: {location, dir}, addScore?, teleport?, die?,
           award?, endGame?: {victory}, activateCreature? }

// vocabulary.json
Verb = { id, words: string[], pattern: 'V' | 'VN' | 'VNPN' }   // core verbs ship in-engine;
                                                               // module adds/extends
MagicWord = { word, eventId }    // never surfaced in UI (FR-1.9)
```

### 4.2 Validator (`tools/validate-module.ts`)

Two layers, both also run in-engine at load time (FR-6.2):

1. **Schema:** every document zod-parses.
2. **Consistency:** every exit `to`/`moveItem.to`/`initialLocation`/`teleport`
   target exists; every `artId` has a file; every event/creature/condition id
   reference resolves; every location reachable from `startLocation` (BFS
   ignoring conditions — conditional-only reachability is fine, orphans are
   errors); `maxScore` equals the sum of attainable points; walkthrough
   commands parse. Errors name the document, id, and field.

## 5. Engine architecture (`src/engine/`)

Pure functional core over one serializable state object. No classes holding
hidden state; no globals.

```
engine.ts        # public API facade (the ONLY import for src/app)
types.ts         # GameState, OutputEvent, SceneView, UIAction
schema/          # zod module schemas (§4)
parser/
  tokenize.ts    # lowercase, split, strip noise words
  vocab.ts       # runtime lookup built from core verbs + module vocabulary + entity names
  parse.ts       # Command | ParseError{suggestion} | Disambiguation{question, options}
actions/         # one handler per core verb group
  movement.ts    # go/n/s/…/enter/exit/back
  handling.ts    # take/drop/put-in/open/close/lock/unlock
  senses.ts      # look/examine/read/search
  lamp.ts        # light/extinguish/refuel
  combat.ts      # attack/throw/give
  meta.ts        # inventory/score/wait/again/verbose-brief
systems/
  events.ts      # trigger matching + effect application (single choke point)
  creatures.ts   # stalker/thief/static behavior ticks
  light.ts       # fuel burn, warnings, darkness danger
  scoring.ts     # treasure carry/deposit detection, milestones, ranks
  achievements.ts
rng.ts           # mulberry32; state lives in GameState
save.ts          # SAVE_VERSION, toSave/fromSave, migrations registry
```

### 5.1 Public API (`engine.ts`)

```ts
createGame(module: AdventureModule, seed: number): GameState
step(module, state, rawInput: string): StepResult   // pure: returns new state
  // StepResult = { state, events: OutputEvent[] }
  // OutputEvent = { kind: 'text'|'command-echo'|'death'|'score'|'achievement'|'question'|'game-over', text, … }
describeScene(module, state): SceneView             // location, artId, items, creatures, exits (visible only)
availableActions(module, state): UIAction[]         // → clickable UI; each carries the command string it echoes
saveGame(state): SaveBlob                           // versioned plain JSON
loadGame(module, blob): GameState                   // migrates or throws typed error
```

`UIAction` is how FR-2.7 works: the UI renders buttons from
`availableActions` (exits; per-visible-item and per-inventory-item verbs), and
clicking one calls `step` with the action's command string — clicks and typing
share one code path, and the echo teaches the parser.

### 5.2 GameState (all plain JSON)

```ts
{ rng: number, turn: number, locationId, previousLocationId,
  itemLocations: Record<itemId, string>,       // locId | 'inventory' | 'nowhere' | containerId
  itemState: Record<itemId, { open?, locked?, lit? }>,
  lampFuel: number,
  flags: Record<string, boolean | number>,
  visited: string[], firedEvents: string[],
  creatures: Record<id, { locationId, active, encounterTurns }>,
  score, deaths, achievements: string[],
  itRefers?: itemId,                            // pronoun support (FR-2.5)
  pending?: { kind: 'disambiguation'|'confirm', options, originalCommand },
  ended?: { victory, rank } }
```

### 5.3 Turn pipeline (`step`)

1. If `state.pending`, try to resolve it with this input (an option pick or a
   fresh command — fresh commands cancel the question).
2. Parse (§5.4). Parse errors return a helpful nudge (FR-2.4) and **consume no
   turn** (no fuel burn, no creature tick).
3. Execute the action handler → effects + text.
4. World tick (only if a turn was consumed): `events` (turnStart triggers) →
   `creatures` → `light` (burn fuel, warnings, darkness danger) → `scoring`.
5. Death handling: apply penalty, scatter carried items at death location,
   offer classic reincarnation text; the **UI** additionally offers
   resume-from-autosave (hardcore mode hides it — a UI concern, not engine).
6. Return new state + ordered output events.

All state mutation happens through effect application in `systems/events.ts` —
action handlers and triggers emit the same `Effect` vocabulary, so there is one
tested choke point.

### 5.4 Parser

- Tokenize → drop noise words → synonym-normalize via vocab lookup.
- Grammar: `V`, `V N`, `V N prep N` (FR-2.1). Direction words alone = `go X`.
- Noun resolution scope: inventory + current location's items/creatures/scenery
  (+ open container contents). Adjectives narrow matches; ambiguity returns a
  `Disambiguation` question (FR-2.4); `it` resolves via `itRefers` (FR-2.5).
- Magic words match **before** the unknown-word nudge and fire their event
  (FR-1.9); unknown input suggests a valid nearby action, never jargon.
- `again`/`g` replays the last consumed command.
- Autocomplete (FR-2.6): `engine.ts` exposes `suggestions(module, state, prefix)`
  over currently-valid vocabulary; UI wires it later — the function ships now
  with tests.

### 5.5 Save/versioning (FR-5.3)

`save.ts` owns `SAVE_VERSION` and a `migrations: Record<number, (old) => new>`
registry (Thornmere pattern). `SaveBlob = { saveVersion, engineVersion,
adventureId, adventureVersion, createdAt, state }`. Mismatched `adventureId`
or unmigratable version → typed errors the UI can present. Round-trip property
test: `loadGame(saveGame(s))` deep-equals `s` across a played walkthrough.

## 6. Minimal browser UI (`src/app/`)

Deliberately plain — Phase 3 replaces the layout; what must survive is the
engine wiring pattern.

```
main.tsx, App.tsx      # adventure load (loader + fetch adapter), error boundary
useGame.ts             # hook: state, submit(input), actions, scene; autosave per turn
ScenePanel.tsx         # placeholder art (adventure's art/ files), location name
TranscriptPanel.tsx    # scrolling output; command echoes styled distinctly
CommandInput.tsx       # text input, Enter submits, ↑/↓ history
ActionBar.tsx          # exit buttons + context verb buttons from availableActions()
InventoryPanel.tsx     # inventory items with their UIActions
StatusBar.tsx          # location, score, turn, lamp gauge
SaveDialog.tsx         # 5 named slots + autosave list: save/load/delete (FR-5.1)
storage.ts             # localStorage adapter: keys `cave.<adventureId>.slot.<n>`,
                       # autosave ring `cave.<adventureId>.auto.<0..4>`
```

Keyboard shortcuts in this plan: `i` inventory focus, `l` look, `Ctrl+S` save
dialog (rest of FR-2.8 arrives with Phase 3 panels). Placeholder art = simple
generated SVGs (one per artId, room name overlaid) committed under
`adventures/test-cave/art/` so the art-loading path is real end to end.

## 7. Loader (`src/loader.ts`)

`loadAdventure(read: (path) => Promise<string>, baseDir): Promise<AdventureModule>`
— parses + zod-validates + cross-checks (same code as the CLI validator).
Browser passes a `fetch` adapter (adventure files copied into `public/adventures/`
by a small vite plugin or `npm run` copy step); tests pass an `fs` adapter.
Same pattern as Thornmere's `db.js` loader indirection (proven headless-testable).

## 8. test-cave — reference module & fixture (FR-6.5)

Tiny but exercises **every** engine feature; it is the unit-test fixture and
the module-format documentation-by-example. 10 locations:

| id | Notes |
|---|---|
| `road` | Start. Lit. Magic word `zeeble` (learned in `grotto`) teleports road↔`entry-hall` |
| `shed` | Repository: trophy shelf (deposit treasures here). Brass lamp + oil flask here |
| `hollow-tree` | `search tree` event reveals iron key (hidden-item event) |
| `cave-mouth` | Locked grate (needs iron key) — gated exit + lock/unlock |
| `entry-hall` | Dim but lit; carving hints at `zeeble` (readText) |
| `low-passage` | **Dark** — lamp required; darkness danger if wandered unlit |
| `twisty-1`, `twisty-2` | Mini-maze: identical briefs; drop-item disambiguation works |
| `ledge` | Hazard: `jump` → death (event `die`). Tests death/reincarnation/penalty |
| `grotto` | Treasure #1 silver chalice; **stalker** cave rat (ward off: lit lamp); carving teaches `zeeble` |
| `deep-vault` | Behind rusted door: oil it with flask (VNPN: `oil door with flask`). Treasure #2 jade idol in a **locked box** (iron key) — container + lock reuse |

Plus: **thief** "shadow packrat" — activates when the player first carries a
treasure (`spawn.if`), then **deterministically** steals *all* carried treasure
`stealAfterTurns` later and stashes it in `twisty-2`, once per game. Scoring (carry + deposit points,
milestone for opening the grate, death penalty, 3 ranks, maxScore 100), two
achievements (`first-treasure`, `no-deaths` awarded at victory), walkthrough
reaching 100/100. Victory = both treasures deposited.

**Why the thief is deterministic** (decided 2026-07-15). This mirrors Woods'
pirate rather than diverging from it. In the 1977 game the theft is *guaranteed*
— the pirate's chest only materializes once he robs you, and the chest is itself
a treasure, so a perfect score is impossible without being robbed. Only his
*timing* was random; the theft, the stash location, and recoverability were all
fixed. Random timing buys tension; it must never gate completability. Making
the steal deterministic keeps the fixture's walkthrough valid at every seed
(§9) and leaves the cave rat's `aggression` roll as the only RNG the
walkthrough must survive. The thief consumes **no** RNG — see the documented
draw order in `systems/creatures.ts`.

*Ordering trap, for Hollowdeep later:* visiting the stash before the theft finds
it empty. Harmless for a human who wanders back; fatal for a fixed command list.
Determinism sidesteps it here; Hollowdeep's maze design must face it.

## 9. Testing strategy (NFR-4)

- **Unit** (`tests/engine/`): tokenizer/parser (synonyms, VNPN, disambiguation,
  pronouns, magic words, nudges), each action group, each system (light warnings
  and dark-death via forced RNG seed, stalker/thief behavior, scoring, container
  nesting), save round-trip + a fabricated v0 blob exercising one real migration.
- **Walkthrough** (`tests/walkthrough.test.ts`): drives
  `adventures/test-cave/walkthrough.json` through `step()`, asserts per-step
  `expect` substrings, final score, rank, achievements. Deterministic via fixed
  seed. The same run at ≥2 further seeds must also reach 100/100 — completability
  is seed-independent (the walkthrough must not depend on luck). This holds
  because the thief is deterministic (§8) and the cave rat's `aggression` roll
  is wardable; if a seed ever fails, that is a **content or engine bug**, not a
  reason to weaken the assertion.
- **Validator**: golden tests — a set of deliberately-broken module fragments
  each producing its specific consistency error.
- No component/browser tests in this plan (Phase 3 owns UI testing); `useGame`
  logic stays thin enough to leave untested until then.

## 10. Implementation notes & risks

- **Build order that keeps the gate green:** scaffold → schemas+loader+validator
  → test-cave data (validator green) → rng/state/engine skeleton → parser →
  actions → systems → save → walkthrough green → UI → save UI → docs.
- **Core-verb vocabulary lives in-engine** (`parser/vocab.ts` seeds it);
  modules extend but cannot remove core verbs. Keeps every adventure speaking
  the same base language (FR-2.2/2.3).
- **`chance` conditions and creature rolls** consume RNG in a fixed order
  within the tick; document the order in `systems/creatures.ts` so tests can
  force outcomes by seed choice.
- **Engine/adventure version handshake:** `manifest.engineVersion` is a semver
  range checked at load; engine exports `ENGINE_VERSION` from `engine.ts`.
- Risk: parser scope-resolution subtleties (containers, scenery, adjectives) —
  design-sensitive; assign to `opus` per the playbook model policy.
- Risk: over-general effect vocabulary. Freeze the Effect list in §4.1 for v1;
  new effects require a schema version bump, not ad-hoc additions.
