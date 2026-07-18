import type { AdventureModule, Direction, Exit, Location } from './schema';
import type { GameState, SceneCreature, SceneExit, SceneItem, SceneView, UIAction } from './types';
import {
  canSee,
  carriedCount,
  creaturesHere,
  currentLocation,
  findItem,
  findLocation,
  hasVisited,
  isCarrying,
  itemsAt,
  visibleContents,
} from './state';
import { evalConditions, isExitRevealed } from './systems/events';
import { buildVocabulary } from './parser/vocab';
import { resolveScope } from './parser/parse';
import { DIRECTIONS } from './schema/common';

// ─────────────────────────────────────────────────────────────────────────────
// The read side: what the UI may know, and what it may offer (design plan
// §5.1, §6; FR-2.6, FR-2.7; T22).
//
// Two rules run through the whole file.
//
// **1. Visibility is a spoiler boundary, not a cosmetic filter.** An unrevealed
// hidden exit and a dark room's contents are things the PLAYER has not earned.
// A `SceneView` that leaks them hands the puzzle away, and it does so
// irreversibly — a player cannot un-see the passage they had not found yet.
// So the filtering here is a rule about knowledge, and it belongs in the engine
// where every UI inherits it, rather than in a component that a later redesign
// (Phase 3 replaces this UI wholesale) could quietly forget.
//
// **2. Clicking IS typing (FR-2.7).** Every `UIAction` carries the command
// string it echoes, and that string goes through `step` like anything the
// player typed. There is no click-only code path, so there is no second
// implementation to drift. Tests hold this by round-tripping every advertised
// command through the real turn loop — if a button offers it, the engine must
// honour it.
//
// The two rules interact, and the interaction is the subtle part: **describing
// an exit and offering an exit are different questions.** See `visibleExits`.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every defined exit, typed by direction.
 *
 * Same shape as movement.ts's private helper, and duplicated for the same
 * reason creatures.ts re-implements warding rather than importing from
 * actions/: `view.ts` sits beside `actions/`, not above it, and what must
 * agree here is the *meaning*, not the code. `DIRECTIONS` (schema/common.ts) is
 * the shared source of truth that keeps them honest.
 */
function exitEntries(location: Location): Array<[Direction, Exit]> {
  const entries: Array<[Direction, Exit]> = [];
  for (const dir of DIRECTIONS) {
    const exit = location.exits[dir];
    if (exit !== undefined) entries.push([dir, exit]);
  }
  return entries;
}

/**
 * Is this exit's guard currently satisfied? No guard means always.
 *
 * **The discarded state is the whole point.** `evalConditions` returns
 * `[boolean, GameState]` because a `chance` condition DRAWS FROM THE RNG, and
 * everything in this file is a read-side query a UI calls freely — on every
 * render, possibly several times a turn, and for no reason at all when React
 * decides to re-render. If a draw made by *looking at the screen* escaped into
 * the game, the seeded sequence would depend on how often the view was
 * repainted, and every seeded test in the suite (and T23's walkthrough) would
 * be at the mercy of the renderer. Rendering must never be a move.
 *
 * So the advanced state is dropped here, deliberately and permanently. Nothing
 * in this file returns a `GameState`, which is what makes that safe rather than
 * merely tidy: there is no path for the draw to reach the game.
 *
 * The residue: an exit guarded by `chance` answers differently on each call, so
 * such an exit would flicker in the UI. No content does this today and the note
 * in docs/foundation-execution-notes.md records it for Hollowdeep. It is a
 * property of asking a random question about a static screen, not something
 * this function can fix.
 */
function exitPassable(module: AdventureModule, state: GameState, exit: Exit): boolean {
  if (exit.if === undefined) return true;
  const [passable] = evalConditions(module, state, exit.if);
  return passable;
}

/**
 * Is this exit's existence known to the player?
 *
 * `hidden` exits stay unknown until a `revealExit` effect fires. Note the
 * asymmetry with movement.ts, which is deliberate on both sides: **the engine
 * will happily walk a hidden exit that has never been revealed** — a guessed
 * secret passage works, which is the classic behaviour this engine reproduces
 * on purpose — but nothing here will ever mention it. Knowing and walking are
 * different rights.
 */
function exitKnown(state: GameState, location: Location, dir: Direction, exit: Exit): boolean {
  return !exit.hidden || isExitRevealed(state, location.id, dir);
}

/**
 * Exits the player may be told about.
 *
 * Both filters are required, for different reasons, and it is worth being
 * precise about why a *blocked* exit is excluded rather than shown greyed out:
 * an exit whose `if` fails is usually blocked BY the puzzle. test-cave's
 * `grotto → deep-vault` opens only once the door is oiled; listing it as a
 * known-but-blocked exit announces that a passage exists there and reduces the
 * puzzle to "find the verb". The adventure gets to decide when the player
 * learns that, via `revealExit` or its own prose.
 *
 * The cost is real and accepted: a player cannot see "you could go down if
 * only…". `blockedMessage` is how content offers that hint, at a moment of the
 * author's choosing — the player types the direction and is told why. That is
 * the adventure's voice, not a UI affordance.
 */
function visibleExits(module: AdventureModule, state: GameState, location: Location): Array<[Direction, Exit]> {
  return exitEntries(location).filter(
    ([dir, exit]) => exitKnown(state, location, dir, exit) && exitPassable(module, state, exit),
  );
}

/**
 * What the player can see right now.
 *
 * In the dark, `items`, `creatures`, and `exits` are ALL empty and
 * `description` is the adventure's darkness warning — the same boundary
 * `lookHandler` (senses.ts) enforces for typed `look`. Exits included: a scene
 * that hid the lamp but drew the doorways would still be handing out the map,
 * and the map is most of what a dark room is keeping from you.
 */
export function describeScene(module: AdventureModule, state: GameState): SceneView {
  const location = currentLocation(module, state);
  const dark = !canSee(module, state);

  if (dark) {
    // `artId` is OMITTED, not blanked. The first version of this returned it,
    // and the panel dutifully drew the room's illustration — over a caption
    // saying it was pitch dark. The engine had carefully emptied `items`,
    // `creatures`, and `exits` and then handed over a picture of the place.
    //
    // Today's placeholder art only has the room's name on it, so the leak is
    // small; Phase B ships a painterly illustration of every location, at which
    // point drawing one for a room the player cannot see is simply showing them
    // the room. And per this file's own header, the boundary belongs here
    // rather than in a component — Phase 3 replaces the UI wholesale, and a
    // rule that lives only in `ScenePanel.tsx` is a rule the rewrite can forget.
    //
    // `name` deliberately stays: the player walked here and knows which room
    // this is. What they cannot do is look at it.
    return {
      locationId: location.id,
      name: location.name,
      description: module.strings[module.manifest.darkness.warningMessageId] ?? '',
      dark: true,
      items: [],
      creatures: [],
      exits: [],
    };
  }

  // `brief`, unless the player asked for `verbose`.
  //
  // This looked like it should mirror movement.ts's "full on first sight, brief
  // on a revisit" rule, and an earlier version did — but that rule cannot be
  // expressed here. movement.ts captures `wasVisited` BEFORE moving; by the
  // time anyone calls `describeScene`, the turn is over and the `teleport`
  // effect has already run `markVisited` (systems/events.ts), so
  // `hasVisited(state, state.locationId)` is **always true** for the room you
  // are standing in. `createGame` marks the start location too. A
  // `!hasVisited` branch here is unreachable by construction, and it was only
  // ever "covered" by a test that built a state — standing somewhere never
  // visited — that no game can produce.
  //
  // Which leaves the honest behaviour, and it is also the right one: the full
  // text is NARRATION, and movement.ts already put it in the transcript on
  // arrival. The scene panel is a caption for where you are now, so it gets the
  // brief — and `verbose` still means what it says everywhere else.
  const description = state.verbose ? location.full : location.brief;

  // Room items, each followed by the visible contents of any open container
  // among them — same rule as `look` (senses.ts) and parser scope, so the
  // panel never hides something the transcript just announced.
  const items: SceneItem[] = itemsAt(module, state, state.locationId)
    .flatMap((item) => [item, ...visibleContents(module, state, item.id)])
    .map((item) => ({
      id: item.id,
      brief: item.brief,
    }));

  const creatures: SceneCreature[] = creaturesHere(module, state).map((creature) => ({
    id: creature.id,
    description: creature.description,
  }));

  const exits: SceneExit[] = visibleExits(module, state, location).map(([dir, exit]) => {
    // The destination's name is itself a spoiler until it has been earned:
    // "east → Shining Grotto" tells a first-time player what is through a door
    // they have not opened. Once visited, naming it is just a courtesy.
    const toName = hasVisited(state, exit.to) ? findLocation(module, exit.to)?.name : undefined;
    return { dir, ...(toName !== undefined ? { toName } : {}) };
  });

  return { locationId: location.id, name: location.name, artId: location.artId, description, dark, items, creatures, exits };
}

// ── UI actions ──────────────────────────────────────────────────────────────

const DIRECTION_LABELS: Record<Direction, string> = {
  n: 'North',
  s: 'South',
  e: 'East',
  w: 'West',
  ne: 'Northeast',
  nw: 'Northwest',
  se: 'Southeast',
  sw: 'Southwest',
  up: 'Up',
  down: 'Down',
  in: 'In',
  out: 'Out',
};

/**
 * The noun phrase to put in a generated command — one that names THIS item and
 * no other, in the scope the parser will actually resolve against.
 *
 * Built from `names[0]`, the canonical name (schema/item.ts), and never from
 * `brief`, which is the adventure's prose for an item lying in a room ("A brass
 * lamp sits on the shelf"): not a name, and not parseable as one. That mistake
 * has already shipped twice (T15's `look` and `inventory`).
 *
 * **The qualifier is the interesting part.** test-cave has a `tin-cup` named
 * "cup" and a `silver-chalice` that also answers to "cup". With both in scope,
 * a bare `examine cup` is ambiguous, so the engine asks which one — and a click
 * that produces "which cup did you mean?" is asking the player to identify the
 * thing they just pointed at. The click already carried the identity; emitting
 * a command that throws it away and asks for it back is FR-2.7 failing at
 * exactly the point it exists to serve. So an adjective is added when, and only
 * when, the bare name would collide.
 *
 * Scope comes from the parser's own `resolveScope` rather than from the items
 * this file happens to be listing. They are not the same set — `resolveScope`
 * also reaches into open containers — and the ambiguity that matters is the one
 * the PARSER will see, not the one the panel can.
 */
function nounFor(module: AdventureModule, state: GameState, itemId: string): string | undefined {
  const item = findItem(module, itemId);
  const bare = item?.names[0];
  if (item === undefined || bare === undefined) return undefined;

  const others = resolveScope(module, state).filter(
    (candidate) => candidate.target.kind === 'item' && candidate.target.id !== itemId,
  );
  const collides = others.some((candidate) =>
    candidate.names.some((name) => name.length === 1 && name[0] === bare.toLowerCase()),
  );
  if (!collides) return bare;

  const adjective = item.adjectives?.[0];
  return adjective === undefined ? bare : `${adjective} ${bare}`;
}

/**
 * Context verbs offered for an item, as `[verb, label prefix]`.
 *
 * Deliberately conservative: every entry here must be an action the engine
 * will actually perform on this item in this state, because a button that
 * refuses is worse than no button — the player reads an offer, and the game
 * says no. So `open`/`close`/`lock`/`unlock` are gated on the item really being
 * a container in the matching state, `read` on it really having `readText`, and
 * `light`/`extinguish` on it really being the configured lamp.
 */
function itemVerbs(module: AdventureModule, state: GameState, itemId: string, carried: boolean): Array<[string, string]> {
  const item = findItem(module, itemId);
  if (item === undefined) return [];

  const verbs: Array<[string, string]> = [['examine', 'Examine']];

  if (carried) {
    verbs.push(['drop', 'Drop']);
  } else if (item.portable && carriedCount(module, state) < module.manifest.carryLimit) {
    // The carry limit is checked here for the same reason `open` checks
    // `locked`: with hands full, `take` refuses (FR-1.2), and a button that
    // refuses is worse than no button. Found by the round-trip test, at the
    // point in the walkthrough where the player is carrying all five things.
    verbs.push(['take', 'Take']);
  }

  if (item.readText !== undefined) verbs.push(['read', 'Read']);

  const container = item.container;
  if (container !== undefined) {
    const itemState = state.itemState[itemId];
    const isOpen = itemState?.open === true;
    const isLocked = itemState?.locked === true;
    // A locked container's `open` would refuse, so it is not offered — the
    // player is shown `unlock` instead, which is the move that actually helps.
    if (!isOpen && !isLocked) verbs.push(['open', 'Open']);
    if (isOpen) verbs.push(['close', 'Close']);
  }

  if (module.manifest.lamp.itemId === itemId && carried) {
    const lit = state.itemState[itemId]?.lit === true;
    // `light` on an empty lamp refuses, so only offer what will work.
    if (!lit && state.lampFuel > 0) verbs.push(['light', 'Light']);
    if (lit) verbs.push(['extinguish', 'Extinguish']);
  }

  return verbs;
}

/**
 * Everything the player can click, each carrying the command it types for them
 * (FR-2.7).
 *
 * In the dark this is exits-only-and-there-are-none plus your own inventory:
 * you can still rummage in your pockets and light your lamp, which is precisely
 * the situation the darkness is asking you to think of. Nothing in the room is
 * offered, because you cannot see the room.
 */
export function availableActions(module: AdventureModule, state: GameState): UIAction[] {
  const actions: UIAction[] = [];
  const location = currentLocation(module, state);
  const dark = !canSee(module, state);

  if (!dark) {
    for (const [dir, exit] of visibleExits(module, state, location)) {
      actions.push({
        label: DIRECTION_LABELS[dir],
        command: dir,
        group: 'exit',
        targetId: exit.to,
      });
    }

    const roomItems = itemsAt(module, state, state.locationId).flatMap((item) => [
      item,
      ...visibleContents(module, state, item.id),
    ]);
    for (const item of roomItems) {
      const noun = nounFor(module, state, item.id);
      if (noun === undefined) continue;
      for (const [verb, prefix] of itemVerbs(module, state, item.id, false)) {
        actions.push({ label: `${prefix} ${noun}`, command: `${verb} ${noun}`, group: 'item', targetId: item.id });
      }
    }
  }

  for (const item of module.items) {
    if (!isCarrying(state, item.id)) continue;
    const noun = nounFor(module, state, item.id);
    if (noun === undefined) continue;
    for (const [verb, prefix] of itemVerbs(module, state, item.id, true)) {
      actions.push({
        label: `${prefix} ${noun}`,
        command: `${verb} ${noun}`,
        group: 'inventory',
        targetId: item.id,
        verbLabel: prefix,
        noun,
      });
    }
  }

  return actions;
}

// ── suggestions ─────────────────────────────────────────────────────────────

/**
 * Completions for a partially-typed word (FR-2.6). Ships now with tests; the
 * UI wires it in Phase 3.
 *
 * Only the LAST word is completed, and the earlier words are left alone: a
 * player typing "take la" wants "lamp", not to be told about "take". Returns
 * whole words rather than whole commands — the caller substitutes the final
 * token, which is the only thing that keeps this useful for `put lamp in b…`
 * as well as `ta…`.
 *
 * **This is a spoiler boundary too**, and the easiest one in the codebase to
 * get wrong. It suggests only what is in scope RIGHT NOW: nouns for items the
 * player can actually see or carry, never the whole item table. A completion
 * list built from `module.items` would cheerfully tell a player at the road
 * that a jade idol exists. Magic words are never suggested at all (FR-1.9) —
 * a word that completes is a word you have been given.
 */
export function suggestions(module: AdventureModule, state: GameState, prefix: string): string[] {
  const words = prefix.split(/\s+/);
  const partial = (words[words.length - 1] ?? '').toLowerCase();
  if (partial === '') return [];

  const pool = new Set<string>();

  // Verbs are always in scope — they are how the game is played, not a secret.
  // Via `buildVocabulary`, NOT `module.vocabulary.verbs`: core verbs ship
  // in-engine (parser/vocab.ts) and the module only declares its own additions,
  // so the raw module list has no `take` in it. `allVerbWords` is the merged
  // set the parser itself matches against, which is the only list that can
  // agree with what the engine will actually accept.
  for (const word of buildVocabulary(module).allVerbWords) pool.add(word);
  for (const dir of DIRECTIONS) pool.add(dir);

  // Nouns ONLY for what is in scope. In the dark, that is what you carry.
  // Open-container contents ride along with their container, both on the
  // floor and in your pack — mirroring resolveScope, which is the list the
  // parser will actually accept these nouns against.
  const visible = canSee(module, state)
    ? itemsAt(module, state, state.locationId).flatMap((item) => [item, ...visibleContents(module, state, item.id)])
    : [];
  const carried = module.items
    .filter((i) => isCarrying(state, i.id))
    .flatMap((item) => [item, ...visibleContents(module, state, item.id)]);
  for (const item of [...visible, ...carried]) {
    for (const name of item.names) pool.add(name);
    for (const adjective of item.adjectives ?? []) pool.add(adjective);
  }
  if (canSee(module, state)) {
    for (const creature of creaturesHere(module, state)) {
      for (const name of creature.names) pool.add(name);
    }
  }

  return [...pool].filter((word) => word.toLowerCase().startsWith(partial)).sort();
}
