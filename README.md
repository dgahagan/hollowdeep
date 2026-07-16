# Hollowdeep

An original browser-based text adventure in the spirit of *Colossal Cave
Adventure* — a cave, a lamp, some treasure, and a narrator who is not on your
side. Not a port: no text or map from the 1977 game, only its manners.

Vite + React + TypeScript, static-only, no backend, no runtime AI.

---

## Status: the engine works; the game is not playable yet

The game engine is complete and tested. **The browser UI is not built**, so
`npm run dev` currently serves a placeholder title card, not a game. The panels,
input box, and save dialog are the next tasks (T24–T26 of
[`docs/foundation-implementation-plan.md`](docs/foundation-implementation-plan.md)),
and this README gains a "How to play" section when they land.

What exists and works today:

| | |
|---|---|
| **Engine** | Parser, turn loop, movement, item handling, containers, lamp and fuel, darkness, creatures, combat, scoring, ranks, achievements, save/load with migrations, scene view |
| **`test-cave`** | A small complete adventure — 11 locations, 11 items, 3 creatures — used as the format reference and test fixture |
| **Validator** | `npm run validate` checks any adventure against the schema and 40 consistency rules |
| **Tests** | 667 across 22 files |
| **UI** | A title card |

## Requirements

Node **>= 22.12** (`.nvmrc`-free; `node -v` to check). npm comes with it.

```bash
npm install
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server. **Today: a placeholder title card.** |
| `npm run gate` | **The one that matters.** typecheck → lint → test → validate → build. Everything must be green before a commit. |
| `npm test` | Vitest, once |
| `npm run validate` | Validate every adventure in `adventures/` |
| `npm run validate -- adventures/test-cave` | Validate one, by path |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the built `dist/` |

`npm run gate` is the project's definition of "not broken". If it is green, the
engine holds; if it is red, nothing else matters yet.

## Layout

```
src/engine/        the game core — no React, no DOM, no clock, no Math.random
  schema/          zod schemas: the adventure format, and its only definition
  parser/          tokenizer, vocabulary, command parsing
  actions/         one file per verb family
  systems/         events, light, creatures, scoring — the world's own turn
  engine.ts        step(module, state, input) — the public API
  view.ts          describeScene / availableActions / suggestions — the read side
  save.ts          versioned saves and migrations
src/loader.ts      load + validate an adventure module
src/app/           the browser UI (T24–T26)
adventures/        adventure data modules
tools/             the validator CLI, art helpers
tests/             unit tests
docs/              plans, requirements, execution notes
```

Two boundaries hold the whole design up, and both are enforced rather than
promised:

**The engine never imports React or the DOM** — lint blocks it, so the game can
be tested and played without a browser. React is presentation only.

**The engine never mentions an adventure.** Adding an adventure means adding a
folder under `adventures/`, and nothing else. The engine has no idea what a
grate is. It also may not read the clock or call `Math.random()` (lint blocks
both): the turn loop is deterministic given a seed, which is what makes a
scripted full-walkthrough test possible.

## Adventures

An adventure is a folder of JSON validated against the schemas in
`src/engine/schema/`. [`adventures/test-cave/`](adventures/test-cave) is the
reference — small, complete, and exercising every feature the engine has.

```
manifest.json      title, version, start location, carry limit, lamp, darkness, scoring
locations.json     rooms, exits, light
items.json         items, containers, treasures
creatures.json     stalkers, thieves, static creatures
events.json        triggers → conditions → effects: the whole puzzle language
strings.json       named message strings — all player-facing prose lives here
vocabulary.json    the adventure's own verbs, nouns, magic words
scoring.json       treasure values, milestones, rank table
achievements.json  achievements
art/               one image per location, item, and creature
walkthrough.json   a scripted winning run, checked by the test suite
```

Validate as you author — it catches far more than malformed JSON. Every exit
resolves to a real room, every string id exists, every art file is present,
`maxScore` reconciles against the points content actually awards, and no room is
unreachable:

```bash
npm run validate -- adventures/my-cave
```

A full authoring guide is planned for T27. Until then, `test-cave` plus the
schema files are the documentation — the schemas carry the reasoning in their
comments, and they are the source of truth for both validation and types.

## Documentation

| | |
|---|---|
| [`docs/PROJECT-BRIEF.md`](docs/PROJECT-BRIEF.md) | Vision, goals, and the settled decisions |
| [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) | Numbered requirements, MoSCoW-tagged |
| [`docs/SCOPE.md`](docs/SCOPE.md) | Phase plan and deliverables |
| [`docs/foundation-plan.md`](docs/foundation-plan.md) | The design plan for the engine |
| [`docs/foundation-implementation-plan.md`](docs/foundation-implementation-plan.md) | Task graph and progress tracker |
| [`docs/foundation-execution-notes.md`](docs/foundation-execution-notes.md) | Decisions, deviations, and the bugs worth remembering |

The execution notes are the most useful of these if you are picking the project
up: they record what was learned while building it, including several bugs whose
causes are not obvious from the code.

## License

Not yet chosen.
