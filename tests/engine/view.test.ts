import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAdventure } from '../../src/loader';
import type { AdventureModule } from '../../src/engine/schema';
import type { GameState } from '../../src/engine/types';
import { createGame, setFlag, setItemLocation, setItemState } from '../../src/engine/state';
import { revealedExitFlag } from '../../src/engine/systems/events';
import { step } from '../../src/engine/engine';
import { availableActions, describeScene, suggestions } from '../../src/engine/view';

const MODULE_DIR = path.resolve(import.meta.dirname, '../../adventures/test-cave');

let module_: AdventureModule;
let start: GameState;

beforeAll(async () => {
  module_ = await loadAdventure(
    (p) => readFile(p, 'utf8'),
    MODULE_DIR,
    (dir) => readdir(dir),
  );
  start = createGame(module_, 12345);
});

function at(locationId: string, extra: Partial<GameState> = {}): GameState {
  return { ...start, locationId, ...extra };
}

/** Carrying a lit lamp — the ordinary state for anywhere underground. */
function lit(locationId: string, extra: Partial<GameState> = {}): GameState {
  let state = at(locationId, extra);
  state = setItemLocation(state, 'brass-lamp', 'inventory');
  state = setItemState(state, 'brass-lamp', { lit: true });
  return state;
}

describe('describeScene — visibility is a spoiler boundary', () => {
  it('describes the room, its items, and its exits', () => {
    const scene = describeScene(module_, at('road'));
    expect(scene.locationId).toBe('road');
    expect(scene.name).toBeTruthy();
    expect(scene.artId).toBeTruthy();
    expect(scene.dark).toBe(false);
    expect(scene.exits.map((e) => e.dir).sort()).toEqual(['e', 'n', 'w']);
  });

  it('captions the scene with the brief, and the full text only in verbose mode', () => {
    // The panel is a caption, not narration: movement.ts already put the full
    // text in the transcript on arrival.
    const location = module_.locations.find((l) => l.id === 'shed');
    expect(describeScene(module_, at('shed')).description).toBe(location?.brief);
    expect(describeScene(module_, at('shed', { verbose: true })).description).toBe(location?.full);
  });

  it('does not depend on whether the room has been visited — it always has been', () => {
    // Pins WHY there is no "full on first sight" branch here. The `teleport`
    // effect marks the room visited before the turn ends and `createGame` marks
    // the start location, so `hasVisited(state, state.locationId)` is true for
    // every state a real game can reach. A test asserting the unvisited case
    // would be asserting behaviour no player can ever see.
    const unvisited = describeScene(module_, at('shed'));
    const visited = describeScene(module_, at('shed', { visited: [...start.visited, 'shed'] }));
    expect(unvisited.description).toBe(visited.description);
  });

  it('names an exit destination only once it has been visited', () => {
    const unvisited = describeScene(module_, at('road')).exits.find((e) => e.dir === 'e');
    expect(unvisited?.toName).toBeUndefined();

    const visited = describeScene(module_, at('road', { visited: [...start.visited, 'shed'] })).exits.find(
      (e) => e.dir === 'e',
    );
    expect(visited?.toName).toBe(module_.locations.find((l) => l.id === 'shed')?.name);
  });

  it('a dark room leaks nothing at all — no items, no creatures, no exits, no picture', () => {
    // low-passage is `light: "dark"`; this state carries no lit lamp.
    const scene = describeScene(module_, at('low-passage'));
    expect(scene.dark).toBe(true);
    expect(scene.items).toEqual([]);
    expect(scene.creatures).toEqual([]);
    expect(scene.exits).toEqual([]);
    expect(scene.description).toBe(module_.strings[module_.manifest.darkness.warningMessageId]);

    // The illustration is the most literal thing you cannot see in the dark.
    // Omitted, not blanked — a UI cannot draw what it was not given.
    expect(scene.artId).toBeUndefined();
    expect('artId' in scene).toBe(false);
  });

  it('the same dark room shows everything once lit — so the emptiness was the dark, not the room', () => {
    const scene = describeScene(module_, lit('low-passage'));
    expect(scene.dark).toBe(false);
    expect(scene.exits.length).toBeGreaterThan(0);
    expect(scene.artId).toBe(module_.locations.find((l) => l.id === 'low-passage')?.artId);
    expect(scene.description).not.toBe(module_.strings[module_.manifest.darkness.warningMessageId]);
  });
});

describe('describeScene — hidden and blocked exits do not leak', () => {
  // grotto's `down` to deep-vault is the real hidden/blocked exit in test-cave.
  const grottoDown = () => describeScene(module_, lit('grotto')).exits.find((e) => e.dir === 'down');

  it('the fixture is both hidden AND guarded, or the two tests below prove nothing', () => {
    // Asserted rather than assumed: each test below isolates ONE of the two
    // filters by satisfying the other, so both properties have to hold here or
    // those tests silently stop distinguishing anything.
    const exit = module_.locations.find((l) => l.id === 'grotto')?.exits.down;
    expect(exit?.hidden).toBe(true);
    expect(exit?.if).toBeDefined();
  });

  it('omits the exit before it has been earned', () => {
    expect(grottoDown()).toBeUndefined();
  });

  it('omits a hidden exit even when its guard passes', () => {
    // Isolates the `hidden` filter: guard satisfied, never revealed.
    const scene = describeScene(module_, setFlag(lit('grotto'), 'door-oiled', true));
    expect(scene.exits.find((e) => e.dir === 'down')).toBeUndefined();
  });

  it('omits a revealed exit whose guard still fails', () => {
    // Isolates the guard: revealed, but the door is not oiled yet.
    const state = setFlag(lit('grotto'), revealedExitFlag('grotto', 'down'), true);
    expect(describeScene(module_, state).exits.find((e) => e.dir === 'down')).toBeUndefined();
  });

  it('shows it once revealed and unblocked', () => {
    let state = setFlag(lit('grotto'), 'door-oiled', true);
    state = setFlag(state, revealedExitFlag('grotto', 'down'), true);
    expect(describeScene(module_, state).exits.find((e) => e.dir === 'down')).toBeDefined();
  });
});

describe('describeScene — never a move', () => {
  it('does not mutate the state it is given', () => {
    const state = lit('grotto');
    const before = structuredClone(state);
    describeScene(module_, state);
    availableActions(module_, state);
    suggestions(module_, state, 'ta');
    expect(state).toEqual(before);
  });

  it('is stable across repeated calls — rendering twice cannot change the answer', () => {
    // The hazard this pins: evalConditions DRAWS RNG for a `chance` condition,
    // so a view that let that draw escape would make the seeded sequence depend
    // on how often the screen repainted.
    const state = lit('grotto');
    expect(describeScene(module_, state)).toEqual(describeScene(module_, state));
    expect(availableActions(module_, state)).toEqual(availableActions(module_, state));
  });
});

describe('availableActions — clicking IS typing (FR-2.7)', () => {
  /**
   * The load-bearing test of this file. Every advertised command is fed to the
   * REAL turn loop and must actually HAPPEN. A button that offers what the
   * engine refuses is the exact failure FR-2.7 exists to prevent, and trying
   * them all against `step` is the only way to know.
   *
   * "Happened" is measured as **the turn advanced**, not as the output text
   * looking encouraging. That is a real engine-wide invariant — a refusal, a
   * nudge, and a parse error all consume no turn (engine.ts §5.3.2), while
   * every genuine action does — so it separates the two exactly, with no
   * judgement about prose.
   *
   * The first draft of this helper instead grepped the output for refusal
   * phrases, and immediately produced a false failure: `twisty-1`'s `e` exit
   * works perfectly, but the room it leads to says "…there is nothing you
   * would care to meet at speed", which the regex read as the engine refusing.
   * Matching prose cannot tell the engine's voice from the adventure's — the
   * same mistake that let a real bug through T15 behind a `/lamp/i` assertion.
   */
  function expectAllCommandsWork(state: GameState): number {
    const actions = availableActions(module_, state);
    for (const action of actions) {
      const result = step(module_, state, action.command);
      expect(result.state.turn, `"${action.command}" (${action.label}) consumed no turn — it was refused`).toBe(
        state.turn + 1,
      );
    }
    return actions.length;
  }

  it('every action offered at the road performs its advertised command', () => {
    expect(expectAllCommandsWork(at('road'))).toBeGreaterThan(0);
  });

  it('every action offered at the shed, holding the lamp, performs its advertised command', () => {
    expect(expectAllCommandsWork(lit('shed'))).toBeGreaterThan(0);
  });

  it('every action offered in a room full of things performs its advertised command', () => {
    let state = lit('cave-mouth');
    state = setItemLocation(state, 'oil-flask', 'inventory');
    state = setItemLocation(state, 'iron-key', 'inventory');
    expect(expectAllCommandsWork(state)).toBeGreaterThan(3);
  });

  it('every action offered at every location the walkthrough reaches works there too', () => {
    // Broadest sweep available: walk the real route, and at each step assert
    // the whole action list is honest in that state.
    let state = createGame(module_, 12345);
    let checked = 0;
    for (const stepDef of module_.walkthrough.steps) {
      checked += expectAllCommandsWork(state);
      state = step(module_, state, stepDef.cmd).state;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('qualifies a noun that would otherwise be ambiguous, rather than asking which one', () => {
    // test-cave's tin-cup is named "cup"; silver-chalice also answers to "cup".
    // With both in scope a bare `examine cup` makes the engine ask which — i.e.
    // asks the player to identify the thing they just clicked on.
    const cup = module_.items.find((i) => i.id === 'tin-cup');
    const chalice = module_.items.find((i) => i.id === 'silver-chalice');
    expect(cup?.names).toContain('cup');
    expect(chalice?.names).toContain('cup'); // the collision is real, not hypothetical

    const both = setItemLocation(at('shed'), 'silver-chalice', 'inventory');
    const cupAction = availableActions(module_, both).find((a) => a.targetId === 'tin-cup');
    expect(cupAction?.command).toBe('examine tin cup');

    // And it really resolves — no question, turn consumed.
    const result = step(module_, both, cupAction?.command ?? '');
    expect(result.state.turn).toBe(both.turn + 1);
    expect(result.events.some((e) => e.kind === 'question')).toBe(false);
  });

  it('leaves the noun bare when nothing collides with it', () => {
    // The qualifier is added only when needed — "Take lamp", not "Take brass lamp".
    const lampAction = availableActions(module_, at('shed')).find((a) => a.targetId === 'brass-lamp');
    expect(lampAction?.command).toBe('examine lamp');
  });

  it('does not offer take when your hands are already full', () => {
    // FR-1.2: `take` refuses at the carry limit, so it must not be offered.
    let state = at('shed');
    const carryable = module_.items.filter((i) => i.portable).slice(0, module_.manifest.carryLimit);
    for (const item of carryable) state = setItemLocation(state, item.id, 'inventory');
    expect(carryable.length).toBe(module_.manifest.carryLimit);

    expect(availableActions(module_, state).some((a) => a.command.startsWith('take '))).toBe(false);
  });

  it('an exit action moves the player where it said it would', () => {
    const state = at('road');
    for (const action of availableActions(module_, state).filter((a) => a.group === 'exit')) {
      expect(step(module_, state, action.command).state.locationId).toBe(action.targetId);
    }
  });

  it('offers take for a portable item on the floor, and drop once it is carried', () => {
    const commands = (s: GameState) => availableActions(module_, s).map((a) => a.command);
    expect(commands(at('shed'))).toContain('take lamp');
    expect(commands(at('shed'))).not.toContain('drop lamp');

    const carrying = setItemLocation(at('shed'), 'brass-lamp', 'inventory');
    expect(commands(carrying)).toContain('drop lamp');
    expect(commands(carrying)).not.toContain('take lamp');
  });

  it('never offers take for a non-portable item', () => {
    const scene = describeScene(module_, at('hollow-tree'));
    const nonPortable = module_.items.filter((i) => !i.portable).map((i) => i.id);
    const offered = availableActions(module_, at('hollow-tree'));
    for (const action of offered) {
      if (action.command.startsWith('take ')) expect(nonPortable).not.toContain(action.targetId);
    }
    expect(scene.items.length).toBeGreaterThan(0); // the room really does hold something
  });

  it('offers light for a carried lamp with fuel, and extinguish once lit', () => {
    const commands = (s: GameState) => availableActions(module_, s).map((a) => a.command);
    const carried = setItemLocation(at('shed'), 'brass-lamp', 'inventory');
    expect(commands(carried)).toContain('light lamp');
    expect(commands(lit('shed'))).toContain('extinguish lamp');
    expect(commands(lit('shed'))).not.toContain('light lamp');
  });

  it('does not offer light for a lamp with no fuel — it would only refuse', () => {
    const dry = setItemLocation(at('shed', { lampFuel: 0 }), 'brass-lamp', 'inventory');
    expect(availableActions(module_, dry).map((a) => a.command)).not.toContain('light lamp');
  });

  it('does not offer open for a locked container — it offers nothing that refuses', () => {
    const commands = availableActions(module_, lit('cave-mouth')).map((a) => a.command);
    const grate = module_.items.find((i) => i.id === 'grate');
    expect(grate?.container?.locked).toBe(true); // the fixture is genuinely locked
    expect(commands).not.toContain('open grate');
  });

  it('offers nothing from the room in the dark, but still offers your own pockets', () => {
    // You cannot see the room; you can always rummage in your own things, which
    // is exactly what the dark is asking you to do.
    const state = setItemLocation(at('low-passage'), 'brass-lamp', 'inventory');
    const actions = availableActions(module_, state);
    expect(actions.some((a) => a.group === 'exit')).toBe(false);
    expect(actions.some((a) => a.group === 'item')).toBe(false);
    expect(actions.map((a) => a.command)).toContain('light lamp');
  });
});

describe('suggestions (FR-2.6)', () => {
  it('completes a verb by prefix', () => {
    expect(suggestions(module_, at('road'), 'ta')).toContain('take');
  });

  it('completes only the last word, leaving the rest alone', () => {
    const carried = setItemLocation(at('shed'), 'brass-lamp', 'inventory');
    expect(suggestions(module_, carried, 'take la')).toContain('lamp');
    expect(suggestions(module_, carried, 'take la')).not.toContain('take');
  });

  it('returns nothing for an empty prefix', () => {
    expect(suggestions(module_, at('road'), '')).toEqual([]);
    expect(suggestions(module_, at('road'), 'take ')).toEqual([]);
  });

  it('suggests only nouns in scope — never the whole item table', () => {
    // The spoiler boundary: a player standing on the road must not learn that a
    // jade idol exists by typing "j".
    expect(module_.items.some((i) => i.id === 'jade-idol')).toBe(true);
    expect(suggestions(module_, at('road'), 'id')).not.toContain('idol');
    expect(suggestions(module_, at('road'), 'ja')).not.toContain('jade');
  });

  it('suggests a noun once it is actually in front of you', () => {
    expect(suggestions(module_, at('shed'), 'la')).toContain('lamp');
    expect(suggestions(module_, at('road'), 'la')).not.toContain('lamp');
  });

  it('suggests what you carry even in the dark', () => {
    const state = setItemLocation(at('low-passage'), 'brass-lamp', 'inventory');
    expect(suggestions(module_, state, 'la')).toContain('lamp');
  });

  it('does not suggest a room noun you cannot see', () => {
    const state = at('shed'); // the lamp is here, but unlit and this room is dark? no — shed is lit
    expect(suggestions(module_, state, 'la')).toContain('lamp');
    // ...whereas in a dark room, the same item on the floor is invisible.
    const dark = at('low-passage');
    const moved = setItemLocation(dark, 'brass-lamp', 'low-passage');
    expect(suggestions(module_, moved, 'la')).not.toContain('lamp');
  });

  it('never suggests a magic word (FR-1.9)', () => {
    // A word that completes is a word you have been given.
    for (const word of module_.vocabulary.magicWords) {
      expect(suggestions(module_, at('road'), word.word.slice(0, 3))).not.toContain(word.word);
    }
  });

  it('suggests directions', () => {
    expect(suggestions(module_, at('road'), 'n')).toContain('n');
  });

  it('every suggestion is a real word the parser accepts', () => {
    const state = setItemLocation(lit('shed'), 'oil-flask', 'inventory');
    for (const word of suggestions(module_, state, 'l')) {
      expect(word).toMatch(/^[a-z-]+$/i);
    }
  });
});
