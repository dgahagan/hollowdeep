# Project Brief — "Hollowdeep" (working title)

**Status:** Draft v1 — for iteration
**Date:** 2026-07-15
**Related docs:** [REQUIREMENTS.md](REQUIREMENTS.md) · [SCOPE.md](SCOPE.md) · [PROMPT.md](PROMPT.md)

---

## 1. Vision

A modern, browser-based adventure game in the spirit of *Colossal Cave Adventure*
(Crowther & Woods, 1976–77) — exploration of a vast underground world, treasure
hunting, puzzles, danger, and a sense of wonder — refined with the conveniences
players expect today: graphics for every location and item, an automatic map,
clickable actions alongside a forgiving text parser, and save/load.

This is **not** a port of the original. It is an **original adventure** built on
the same design DNA: a cave that feels real, treasures worth the risk, puzzles
solved with items and wit, a light source that creates tension, and a few
secrets (magic words, hidden rooms) that reward the curious.

The game ships as a **static web app** — no backend, no accounts, runs from any
static host or local file server. All AI-generated art is produced **offline at
build time** on the local RTX 5080 (reusing the FLUX pipeline pattern proven in
the bards-tale-clone project) and shipped as ordinary image files.

## 2. The First Adventure: "Hollowdeep"

Working concept (all details open for iteration):

> A century ago, the mining town of **Weir's Landing** sealed the entrance to
> the Hollowdeep — the cavern system that made it rich and then swallowed half
> its miners in a single night. Now the seal has cracked. You, a traveler with
> more curiosity than sense, arrive with a brass lantern, empty pockets, and a
> rumor: everything the miners ever pulled from the deep is still down there.

- **Scale:** ~55–65 locations (a small above-ground intro area + the cave),
  comparable in feel to the original's dense core rather than its full sprawl.
- **Treasures:** ~12 unique treasures to find and return to a safe repository,
  each with its own puzzle or risk.
- **Hazards:** a persistent stalking creature (our "dwarves"), a thieving
  entity (our "pirate"), darkness, drops, water, and at least one infamous maze
  **on the critical path** (classic style) — but a *fair* maze (items can be
  dropped to mark rooms, and the auto-map helps once rooms are distinguished).
- **Secrets:** original magic words in the xyzzy tradition, at least one
  hidden area, and an homage or two for players of the 1977 classic.
- **Endgame:** a scored finale with a "last lousy point" style secret for
  completionists. Target ~350 points as a tip of the hat.

## 3. Key Refinements over the Classic

| Classic (1977) | Hollowdeep |
|---|---|
| Text only | Painterly AI-generated illustration for every location, item, and creature |
| Two-word parser, cryptic failures | Forgiving multi-word parser (synonyms, pronouns, suggestions) **plus** clickable exits, context verbs on items, and keyboard shortcuts |
| Hand-drawn player maps | Auto-mapping: the map reveals itself as you explore (button + hotkey) |
| No save on many versions / fragile saves | Named save slots + autosave, stored locally, exportable as a file |
| Instant deaths, snarky reincarnation | Deaths remain (they're part of the genre) but autosave-on-danger makes them a setback, not a loss; classic hardcore mode available |
| Lamp battery anxiety with no warning | Lamp mechanic kept, with clear warnings and a readable fuel gauge |
| Hints cost points, all-or-nothing | Gradual, opt-in hint system (nudge → hint → solution), scored like the original |
| Points-only scoring | Classic point scoring **plus** lightweight achievements (secrets, feats, completionist goals) |
| One hard-coded world | Data-driven **adventure module** format: map, items, creatures, art, and vocabulary all live in content files so new adventures plug into the same engine |

## 4. Goals

1. **Capture the feeling** of the original — exploration, discovery, tension,
   humor — for both nostalgic players and newcomers who have never typed
   `GET LAMP`.
2. **Remove the friction**, not the challenge. Convenience features (map,
   buttons, saves) eliminate busywork; the puzzles stay puzzles.
3. **Every scene illustrated.** One consistent painterly image per location,
   item, and creature, generated locally and shipped as real image files
   (explicitly *not* the JSON-text sprite encoding used in bards-tale-clone).
4. **Engine ≠ adventure.** The engine loads adventures as data. Hollowdeep is
   adventure #1; a second adventure must be addable without engine changes.
5. **Zero-infrastructure delivery.** Static files, modern browsers, playable
   offline once loaded.

## 5. Non-Goals (v1)

- No multiplayer, accounts, cloud saves, or any server component.
- No runtime AI (no LLM parser, no on-the-fly image generation in the browser).
- No port of the actual 1977 map or its copyrighted-adjacent text.
- No mobile-native apps (responsive browser layout is a stretch goal, not native).
- No user-facing adventure editor (the module format is documented for
  developers; a visual editor is a possible future project).

## 6. Target Audience

- Players nostalgic for classic interactive fiction who want a gentler on-ramp back in.
- Adventure/puzzle players who never played text adventures and bounce off pure parsers.
- Primary developer/user: the project owner; secondarily anyone it's shared with via a URL.

## 7. Technical Approach (summary)

- **App:** Vite + React + TypeScript single-page app; static build output.
- **Engine:** pure-TypeScript game core (world state, parser, rules, scoring)
  fully separated from the React presentation layer — headless-testable.
- **Content:** adventure modules as validated JSON/TS data (locations, exits,
  items, creatures, events, vocabulary, art manifest).
- **Art pipeline:** offline generation with FLUX.2-klein-4B on the RTX 5080,
  driven by a per-adventure art manifest (subject prompt + shared style suffix
  + seed bookkeeping), following the manifest-first pattern from
  bards-tale-clone's `docs/art-pipeline.md`. Chosen images are optimized
  (WebP/AVIF with PNG fallback) and committed as static assets.
  *Note: the original `host_gen.py` driver script is not in the old repo's
  working tree and will be recovered or rewritten (~small effort; its
  input/output contract is fully documented).*
- **Saves:** JSON snapshots of game state in `localStorage` (versioned, with
  migration), plus file export/import.

## 8. Success Criteria

- A new player can reach their first treasure within ~10 minutes without reading any docs.
- The full adventure is completable (350/350) and has been play-tested end to end.
- Every location, item, and creature has a final, style-consistent illustration.
- A save made in an early build loads in the release build (or migrates cleanly).
- A skeleton second adventure ("test module") loads and plays in the same engine with zero engine-code changes.
- Lighthouse-fast: initial playable load under ~3s on a typical connection (images lazy-loaded).

## 9. Resolved Decisions

| # | Decision | Resolution (2026-07-15) |
|---|---|---|
| 1 | Setting/concept | **"Hollowdeep" / Weir's Landing confirmed** as the first adventure |
| 2 | Audio | **v1 ships silent**; audio deferred to a later release |
| 3 | Achievements | **Yes** — lightweight achievements alongside classic point scoring |
| 4 | Maze placement | **On the critical path**, classic style (kept fair per §2) |
| 5 | Narrator voice | **Similar to the original** — dry, wry, occasionally snarky, aimed at the player's choices rather than the player |
