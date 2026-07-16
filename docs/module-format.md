# The adventure module format

The contract between the engine and an adventure. **Adding an adventure means
adding a folder under `adventures/` and changing no engine code** (FR-6.1) — if
you find yourself wanting to edit `src/engine/`, either you have found a gap in
this format or you are solving it in the wrong place. Both are worth raising.

The schemas in `src/engine/schema/` are the source of truth: they generate both
the runtime validation and the TypeScript types, so they cannot drift from each
other. This document explains them. Where the two disagree, the schema is right
and this file is stale.

Read [`adventures/test-cave/`](../adventures/test-cave) alongside this. It is
small, complete, and deliberately exercises every feature the engine has.

**Validate constantly.** It catches far more than typos:

```bash
npm run validate -- adventures/my-cave
```

---

## The shape of a module

Ten JSON documents plus an art folder. All ten are required.

```
adventures/my-cave/
  manifest.json      the adventure's identity and rules
  locations.json     rooms and how they connect
  items.json         everything you can take, open, read, or trip over
  creatures.json     things that move, steal, or watch
  events.json        the puzzle language: when X, if Y, do Z
  strings.json       named prose, referenced by id
  vocabulary.json    your own verbs, noise words, magic words
  scoring.json       what points are for, and the rank table
  achievements.json  achievements
  walkthrough.json   a scripted winning run — the test suite plays it
  art/               one image per artId
```

Every object is **strict**: an unknown key is an error, not a silent no-op. A
typo'd field name fails the build rather than quietly doing nothing at midnight
three months from now.

Every id is lower-kebab-case (`iron-key`, `deep-vault`). Ids are the wiring: they
are how documents point at each other, and the validator checks every one.

---

## `manifest.json`

The adventure's identity and its global rules.

```json
{
  "id": "test-cave",
  "title": "The Test Cave",
  "version": "1.0.0",
  "engineVersion": "^1.0.0",
  "startLocation": "road",
  "repositoryLocation": "shed",
  "carryLimit": 5,
  "maxScore": 100,
  "lamp": {
    "itemId": "brass-lamp",
    "startFuel": 200,
    "warnAt": [40, 15, 5],
    "warnMessageId": "lamp-low",
    "exhaustMessageId": "lamp-dead",
    "refuel": { "itemId": "oil-flask", "amount": 120, "consumesItem": true }
  },
  "darkness": {
    "deathChance": 0.3,
    "warningMessageId": "dark-warning",
    "deathMessageId": "dark-death"
  }
}
```

- **`engineVersion`** is a semver range checked against the engine at load. A
  module that needs a feature this engine lacks refuses to load rather than
  half-working. The check **fails closed**: a range the engine cannot parse is a
  refusal, not a shrug.
- **`repositoryLocation`** is where treasure counts as deposited.
- **`maxScore`** must equal the points your content actually awards. The
  validator does that arithmetic (see [Scoring](#scoringjson)); it is the single
  most common reason a new module fails to validate, and the error tells you the
  difference.
- **`lamp`** is manifest-level because the engine tracks one fuel number.
  An adventure with two fuel-burning lamps would need a state-shape change — i.e.
  a save migration — which should not be reachable by editing a content file.
  **Nothing requires your light source to be called a lamp**: name it a torch, a
  candle, or a phosphorescent mushroom. All the prose comes from your strings.

---

## `locations.json`

```json
{
  "id": "low-passage",
  "name": "Low Passage",
  "brief": "You are crawling along a low passage.",
  "full": "The ceiling comes down to meet you and keeps coming. This is a passage in the sense that a keyhole is a door.",
  "artId": "low-passage",
  "light": "dark",
  "exits": {
    "s": { "to": "entry-hall" },
    "n": { "to": "twisty-1" }
  }
}
```

**`name` never appears in the transcript** — it is a label for the scene panel.
The transcript gets `full` on first sight and `brief` on a revisit (or `full`
every time in `verbose` mode). Write `brief` as a complete sentence in the
narrator's voice: it is what the player reads most often.

**`light: "dark"`** means the room is unlit. Without a light source the player
sees nothing at all — no items, no creatures, no exits, no picture — and may die
there.

### Exits

```json
"down": {
  "to": "deep-vault",
  "if": [{ "flag": "door-oiled" }],
  "blockedMessage": "The door does not budge. Rust has made it part of the floor.",
  "hidden": true,
  "oneWay": false
}
```

- **`if`** guards passage. When it fails, the player gets `blockedMessage` — this
  is your chance to say *why*, in your voice, at a moment you chose.
- **`hidden`** controls whether the exit is ever **described**. It does not
  control whether it can be **walked**: a player who guesses a secret passage
  gets through, which is deliberate and classic. Reveal it with the `revealExit`
  effect.
- **`oneWay`** stops `back` from returning through it.
- Every location must be reachable from `startLocation`. The validator does a BFS
  **ignoring conditions** — a conditional-only path is fine, an orphan is not.

Avoid `chance` in an exit guard. It is legal but the UI asks the guard on every
render, so the exit would flicker; model a random passage as an event instead.

---

## `items.json`

```json
{
  "id": "brass-lamp",
  "names": ["lamp", "lantern"],
  "adjectives": ["brass"],
  "brief": "A brass lamp sits on the shelf, waiting to be useful.",
  "description": "Heavier than it looks, and honest about its business.",
  "artId": "brass-lamp",
  "portable": true,
  "initialLocation": "shed",
  "lightSource": true,
  "readText": "...",
  "treasure": { "carryPoints": 20, "depositPoints": 25 },
  "container": { "open": false, "locked": true, "keyId": "iron-key", "capacity": 2 }
}
```

**The three text fields are not interchangeable, and confusing them is the most
common authoring mistake:**

| Field | Is | Used |
|---|---|---|
| `names[0]` | the canonical **name** | anywhere the engine must *name* the item |
| `brief` | a sentence about it **lying in a room** | when listing the room |
| `description` | what you see on **`examine`** | `examine` |

`brief` is prose, not a label. "A brass lamp sits on the shelf" is right for a
room listing and wrong everywhere else — read out of an inventory it claims your
lamp is on a shelf.

- **`names`** are the nouns that match it. **`adjectives`** narrow an ambiguous
  one (`tin cup` vs `silver chalice`). Give two items the same noun on purpose:
  the engine asks which, and the UI qualifies its buttons automatically.
- **`initialLocation`** is a location id, a container's item id, `inventory`, or
  `nowhere` (not yet in play).
- **`container`** turns an item into something that opens. A **door** is just a
  container with `capacity: 0` — that is how the grate works.
- **`treasure`** scores twice: `carryPoints` on first pickup, `depositPoints` on
  reaching `repositoryLocation`. Each awards once, ever.

---

## `creatures.json`

Three behaviours, all **parameterized, never scripted** (FR-1.7).

```json
{
  "id": "cave-rat",
  "names": ["rat", "cave rat"],
  "description": "A rat the size of a well-fed terrier.",
  "artId": "cave-rat",
  "behavior": "stalker",
  "spawn": { "locations": ["twisty-1", "twisty-2", "grotto"], "afterTurn": 30 },
  "moveEvery": 3,
  "aggression": 0.35,
  "wardOff": { "itemIds": ["brass-lamp"] },
  "deathMessageId": "rat-death"
}
```

- **`stalker`** — wakes per `spawn` (`afterTurn` and/or `if`), moves every
  `moveEvery` turns, and rolls `aggression` each turn it shares your room. The
  **only** creature that consumes RNG.
- **`thief`** — wakes per `spawn`, then steals **all** carried treasure exactly
  `stealAfterTurns` later and stashes it at `stashLocation`. Once per game, and
  **fully deterministic**: the schema *refuses* `aggression` on a thief. Random
  timing buys tension but must never gate completability — the walkthrough has to
  win at every seed.
- **`static`** — stays put. For things to examine, or to gate an exit.

**`wardOff`** is what makes a creature harmless: carrying one of `itemIds` (a
light source counts only when **lit**), or acting on it with one of `verbIds`.
It means *wards off* and nothing else — it is not a "wants a gift" list.

**`deathMessageId` is overloaded**: for a stalker it is the message when it kills
you; for a thief it is the message when it robs you (a thief can never kill, so
there is no ambiguity in practice). Worth knowing before you name yours.

---

## `events.json` — the puzzle language

Everything that makes an adventure an adventure. **When** X happens, **if** Y is
true, **do** Z.

```json
{
  "id": "oil-the-door",
  "once": true,
  "on": { "type": "use", "target": "rusted-door" },
  "if": [{ "hasItem": "oil-flask" }],
  "do": [
    { "kind": "print", "text": "The rust gives up its grudge." },
    { "kind": "setFlag", "flag": "door-oiled" },
    { "kind": "revealExit", "location": "grotto", "dir": "down" }
  ]
}
```

`once: true` fires it at most once per game.

### Triggers (`on`)

| `type` | Fires when | `target` |
|---|---|---|
| `enter` | the player arrives | location id |
| `take` / `drop` | an item is taken/dropped | item id |
| `use` / `read` / `open` / `search` | the verb is used on it | item id |
| `verb` | any verb runs | verb id (**required**) |
| `turnStart` | a given turn begins | — (needs `turn`) |
| `flagSet` | a flag becomes set | flag id |
| `word` | a magic word is said | — (needs `word`) |

`verb` is how an intransitive adventure verb works (test-cave's `jump`). A verb
with no engine handler and no matching event is a nudge that costs no turn.

### Conditions (`if`)

**Fields within one condition AND together. The array ORs.**

```json
"if": [{ "flag": "a", "hasItem": "b" }]   // a AND b
"if": [{ "flag": "a" }, { "flag": "b" }]  // a OR b
```

| Field | True when |
|---|---|
| `flag` / `notFlag` | a flag is / is not set |
| `hasItem` | the player carries it |
| `atLocation` | the player is there |
| `visited` | the player has ever been there |
| `itemAt` | `{item, location}` — an item is somewhere |
| `creatureAt` | `{creature, location}` — a creature is somewhere |
| `deathsAtMost` | the player has died at most N times |
| `chance` | a seeded roll, 0..1 — **the only field that consumes RNG** |

> **Known limit:** each field appears once per condition, so **"flag A *and* flag
> B" is inexpressible**. `[{flag:'a'},{flag:'b'}]` ORs. Route around it with a
> trigger that supplies half the test, or an intermediate flag. This is the
> format's sharpest edge; it is on the list to fix with a schema bump.

**Guards see a snapshot.** Every event sharing a trigger is judged against the
state as it was when the trigger fired, then the survivors apply in order. So
"do X, else say why not" as two events with opposite guards works, and you never
have to reason about the order of events sharing a trigger.

### Effects (`do`)

**Frozen at twelve.** Adding one is a schema version bump, not a convenience —
an open-ended effect vocabulary is how a data format quietly becomes a
programming language.

| Effect | Does |
|---|---|
| `print` | inline text |
| `printId` | a `strings.json` line |
| `setFlag` / `clearFlag` | set / clear a flag (`setFlag` can cascade into `flagSet` triggers) |
| `moveItem` | move an item to a location, container, `inventory`, or `nowhere` |
| `revealExit` | make a `hidden` exit describable |
| `addScore` | adjust the score directly |
| `teleport` | move the player |
| `die` | kill the player |
| `award` | grant an achievement |
| `endGame` | end it, win or lose |
| `activateCreature` | wake a creature |

`do` is **ordered**, and the order is observable.

> **`addScore` is a trap for treasure.** Treasure and milestone points must not
> also flow through it, or `maxScore` cannot reconcile and the validator will
> reject your module. Use it only for scoring outside that model.

---

## `strings.json`

```json
{
  "dark-death": "You take one more confident step into the dark. The dark, which has been doing this for a very long time, does not step aside."
}
```

Flat id → text. **All player-facing prose belongs to the adventure.** If the
engine ever seems to be speaking in its own voice about your content, that is a
bug — report it. There is no interpolation: strings are literal, so a message
cannot embed a number.

---

## `vocabulary.json`

```json
{
  "verbs": [{ "id": "use", "words": ["use", "oil", "apply"], "patterns": ["VN", "VNPN"] }],
  "noiseWords": ["the", "a"],
  "magicWords": [{ "word": "zeeble", "eventId": "zeeble-descend" }]
}
```

**Core verbs ship in the engine and cannot be removed** — every adventure gets
`take`, `look`, `go`, and the rest, so what a player learns transfers. Declaring
a verb that shares a core id **adds** synonyms and patterns rather than replacing
them.

Patterns: `V`, `VN`, `VNPN`. **Magic words are never surfaced** — not in
suggestions, not in help, not in any button (FR-1.9). A word the player has not
been given is one they have to find.

---

## `scoring.json`

```json
{
  "deathPenalty": 10,
  "milestones": [{ "id": "grate", "points": 10, "when": [{ "flag": "grate-open" }] }],
  "ranks": [
    { "minScore": 0, "title": "Tourist" },
    { "minScore": 45, "title": "Spelunker" },
    { "minScore": 100, "title": "Master of the Test Cave" }
  ]
}
```

**Milestones are declarative** — `when: Condition[]`, not an `addScore` effect.
That is what makes the points derivable from data, which is the only reason
`maxScore` can be checked at all.

The arithmetic that must close:

```
maxScore == Σ treasures (carryPoints + depositPoints) + Σ milestones.points
```

Achievements award no points. `deathPenalty` is a deduction and does not count
toward `maxScore`. The rank table needs a floor (`minScore <= 0`) and no
duplicate thresholds; order does not matter.

---

## `achievements.json`

```json
{ "id": "no-deaths", "name": "Unhurried", "description": "Finish without dying once.", "hidden": false }
```

Granted by the `award` effect from an ordinary event — there is no separate
achievement engine, and `Achievement` deliberately has no `when:`. Use the same
Condition/Effect vocabulary as everything else. They are engine + transcript
notice only in this phase; the UI is Phase 3.

---

## `walkthrough.json`

A scripted winning run. **The test suite plays it**, so it is executable
documentation and the strongest guarantee your adventure is completable.

```json
{
  "steps": [
    { "cmd": "e", "expect": "trophy shelf" },
    { "cmd": "take lamp" }
  ],
  "expectedScore": 100,
  "expectedRank": "Master of the Test Cave",
  "expectedAchievements": ["first-treasure", "no-deaths"]
}
```

- `expect` is a substring of that turn's output; a list requires **all** of them.
- **It must reach `expectedScore` at every seed, not a lucky one.** That is only
  possible because the thief is deterministic and the stalker is wardable. If it
  passes at one seed and not another, something on your winning path is rolling a
  die that it must not.
- Assert on prose you actually print. Room **names** never appear in the
  transcript — assert on the description text instead.
- The rank is a structured field on the game-over event, not transcript prose.

---

## `art/`

One file per `artId`, at `adventures/<id>/art/<artId>.svg`. Every `artId` in
every document — locations, items, creatures — needs one, and `npm run validate`
checks it. Alt text comes from the location's `brief`, so write it as a real
sentence.

---

## What the validator checks

Beyond schema conformance, ~40 consistency rules. The useful ones to know:

- every exit `to`, `initialLocation`, `moveItem.to`, `teleport`,
  `stashLocation`, and `spawn.locations` resolves;
- every event, creature, item, string, and flag id reference resolves — including
  **trigger targets**, so a typo'd `on.target` fails loudly instead of never
  firing;
- every `artId` has a file;
- every location is reachable from `startLocation`;
- `maxScore` reconciles;
- every `walkthrough.json` command parses.

Errors name the document, the id, and the field. Trust them: a module that
validates is one the engine can actually run.
