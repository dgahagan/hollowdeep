# Playing

A player's guide to the game engine — how to talk to it, and what it expects of
you. Everything here was transcribed from the running game, not from the source.

The shipping adventure is **Hollowdeep** — `npm run dev` opens on the coach
road above Weir's Landing. The **test-cave** fixture is still playable at
`?adventure=test-cave`.

```bash
npm install
npm run dev        # then open the URL it prints
```

## The idea

You type what you want to do. The cave tells you what happens. It is not on your
side, but it is fair.

You can also click. Every button is a command — clicking **West** types `w` for
you, and the command appears in the transcript exactly as if you had. There is no
second set of rules for clicking: if a button offers it, typing it does the same
thing.

## Talking to the cave

Commands come in three shapes:

| Shape | Example |
|---|---|
| A verb | `look`, `inventory`, `wait` |
| A verb and a noun | `take lamp`, `open grate`, `search tree` |
| A verb, a noun, a preposition, a noun | `unlock grate with key`, `put idol in box` |

A bare direction means "go that way" — `e` is `go east`. Directions are `n`, `s`,
`e`, `w`, `ne`, `nw`, `se`, `sw`, `up`, `down`, `in`, `out`.

Filler words are ignored, so `take the brass lamp` and `take lamp` are the same
command. Adjectives narrow things down when it matters: if there are two cups,
`take tin cup` says which.

## Verbs

Every verb below works in every adventure — they ship with the engine. An
adventure can add its own verbs and add synonyms to these, but it cannot remove
one, so what you learn here transfers.

**Moving:** `go` (`walk`, `head`, `move`) · `enter` · `exit` (`leave`) · `back`
(`retreat`, returns the way you came)

**Looking:** `look` (`l`) · `examine` (`x`, `inspect`, `describe`) · `read` ·
`search`

**Handling:** `take` (`get`, `grab`, `pick`) · `drop` (`discard`) · `put`
(`place`, `insert`) · `open` · `close` (`shut`) · `lock` · `unlock`

**The lamp:** `light` (`ignite`) · `extinguish` (`douse`, `snuff`) · `refuel`
(`refill`)

**Trouble:** `attack` (`kill`, `hit`, `fight`) · `throw` (`toss`) · `give`
(`offer`) · `use`

**Bookkeeping:** `inventory` (`i`, `inv`) · `score` · `wait` (`z`) · `again`
(`g`, repeats your last real command) · `verbose` · `brief` · `help` · `hint`
(`hints`)

`verbose` gives you the full description of a room every time; `brief` goes back
to the short one for places you have already been. `help` prints a short version
of this section.

## What the cave does when you get it wrong

It tries to help, and it never charges you a turn for a mistake:

```
> tkae lamp
You can't "tkae".
Did you mean `take`?

> frobnicate
"frobnicate" isn't a word the cave knows.
Try `e`.
```

The suggestion is always something you could actually do right now. The cave will
not answer a mistake with jargon, and it will never hint at a secret you have not
found — if a word completes or a suggestion appears, it is one you have earned.

When two things answer to the same noun, it asks:

```
> take cup
Which cup do you mean, the silver chalice or tin cup?

> tin
Taken.
```

Answer however you like — `tin`, `tin cup`, or the number. A completely different
command cancels the question instead of being eaten by it, so you are never
trapped in one.

## Turns

A turn passes only when something actually happens. Walking, taking, and looking
cost a turn. A typo, a refusal, a question, checking your `inventory` or
`score`, and asking for a `hint` cost nothing. This matters because your lamp
burns fuel per turn — the cave never bills you for a mistake, and it never bills
you for being stuck.

## Light

Underground you need the lamp lit, and it does not have infinite oil.

Dark rooms are not "hard to see in" — you see nothing, and the game will not
list what is there, draw it, or offer you anything in it. What you can still do
is rummage in your own pockets and `light lamp`, which is what the dark is asking
you to think of.

Staying in the dark is dangerous. The cave will warn you as the oil runs low, and
again when it runs out.

## Things worth knowing

- You can only carry so much. "Your hands are full" means exactly that — drop
  something.
- Treasure scores twice: once for picking it up, once for getting it somewhere
  safe.
- Dying is not the end. It costs you points and leaves your possessions where you
  fell, so it costs you the walk back.
- Something in the cave steals. If your hands feel lighter, your treasure has
  gone somewhere, and it is still in the cave.

## The map

Press **`m`**, or click **Map**. It draws itself as you go: every room you have
stood in, the corridors between them, and short dashes toward exits you have seen
but not yet walked. North is up. A ring marks where you are, and the corner keeps
a count of how much of the cave you have seen.

The map will not solve the maze for you. Rooms that look and read identically
collapse into a single "twisting passages, all confused" cloud — until you do the
old trick and drop something in one. A room with your marker in it steps out of
the cloud and onto the map as itself; pick the marker back up and it dissolves
again. The map only ever remembers what the cave already let you tell apart.

## The journal and hints

Press **`j`**, or click **Journal**, for two tabs. *Log* is a running account the
game keeps for you — milestones, treasures carried and banked, achievements,
deaths, and every hint you have taken — rebuilt honestly from wherever you are,
so loading a save shows that save's history, not this session's. *Notes* is a
blank page that is yours; it persists per adventure.

Click **Hints** for the hint panel. It shows every hint you have already
uncovered, grouped by the puzzle it belongs to, and one button to take the next
one — the same `−5 points` the `hint` command costs, because it *is* the `hint`
command. It never lists a hint you have not earned.

## Saving

Press **Ctrl+S**, or click **Save / Load**. Five named slots, plus an autosave
that keeps the last five turns on its own — the game saves every turn you take,
so you can close the tab and come back.

Each row shows when it was saved, where you were, your score, and a thumbnail of
the scene. Load returns you exactly there. The transcript starts fresh after a
load — a save records the world, not the conversation you had about it.

**Export** downloads a slot as a file; **Import** reads one back into a slot — for
a backup, or to carry a game to another browser. An imported save is checked
before it lands: a file for a different adventure, or one the game cannot read, is
refused with a plain message and changes nothing. A save that cannot be loaded
says so plainly and leaves the game running. It will never load half of one.

## Undo

Typed a move you regret? Type **`undo`** to take back the last turn — one step, no
more. It is a courtesy the cave extends between turns, not a mechanic: it never
appears in the transcript as a command, and there is nothing to undo at the very
start, after the game is over, or in hardcore.

## Hardcore

Starting a new game, you can choose **hardcore**. It is set once, at the start,
and cannot be turned on or off mid-run. In hardcore there is no rescue: death is
reincarnation and nothing else, the autosaves are hidden while you play, and
`undo` is refused. Everything else is the same game — it just means it.

## Keyboard

| Key | Does |
|---|---|
| `Enter` | Submit the command |
| `↑` / `↓` | Walk back through commands you have typed (or through the autocomplete list when it is open) |
| `m` | Map |
| `j` | Journal |
| `i` | Jump to the inventory panel |
| `l` | Look |
| `?` | Help |
| `Ctrl+S` | Save / load |
| `Escape` | Close whatever overlay is open |

The bare letters (`m`, `j`, `i`, `l`, `?`) are for when you are not typing — while
the command box has focus they are just letters, so `light lamp` types the word it
looks like. `Ctrl+S` always works. The **Hints** and **Settings** panels open from
their header buttons — no letter is free for them without stealing it from a
command word.

## If you get stuck

`look` again. `examine` everything, including things that sound like scenery.
`search` what looks like it has an inside. Read what has writing on it. The cave
rewards paying attention to its prose — the descriptions are not decoration.

Still stuck? Type `hint`. Each hint starts as a nudge and gets more direct the
more you ask, and every one costs a few points — it costs points, never turns,
so asking mid-crisis will not make the crisis worse. Finishing without asking at
all is the kind of thing achievements are made of.
