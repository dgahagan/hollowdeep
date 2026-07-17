import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAdventure } from '../../src/loader';
import type { AdventureModule } from '../../src/engine/schema';
import type { GameState } from '../../src/engine/types';
import { createGame } from '../../src/engine/state';
import { computeMapLayout } from '../../src/app/mapLayout';

// T4 (ui-plan §4): the auto-map's layout rules, driven against the REAL
// modules — the acceptance criterion names both, because each exercises the
// cloud rule from a different side: hollowdeep's twisty-1..4/6 share an
// identical (full, brief, artId) triple and MUST collapse, while test-cave's
// two twisties have distinct fulls (its draught room is twisty-2) and must
// NOT — the map remembers exactly what the prose distinguished.
//
// States are built from `createGame` plus surgical edits to `visited` /
// `itemLocations` / `locationId` rather than replaying walks through
// `step()`: `computeMapLayout` is a pure function of (module, state), so the
// rule is tested precisely at its inputs, and the walkthrough suites already
// prove those states are reachable by play.

let hollowdeep: AdventureModule;
let testCave: AdventureModule;

async function load(dir: string): Promise<AdventureModule> {
  return loadAdventure(
    (p) => readFile(p, 'utf8'),
    path.resolve(import.meta.dirname, '../../adventures', dir),
    (d) => readdir(d),
  );
}

beforeAll(async () => {
  hollowdeep = await load('hollowdeep');
  testCave = await load('test-cave');
});

/** A game state with the given rooms visited and the player in the last of them. */
function stateVisiting(module: AdventureModule, visited: string[]): GameState {
  const base = createGame(module, 12345);
  return {
    ...base,
    visited: [...new Set([...base.visited, ...visited])],
    locationId: visited[visited.length - 1] ?? base.locationId,
  };
}

/** All maze rooms sharing the identical triple in hollowdeep (twisty-5 differs by its draught sentence). */
const CLOUDY_TWISTIES = ['twisty-1', 'twisty-2', 'twisty-3', 'twisty-4'];

describe('the maze cloud rule (hollowdeep)', () => {
  it('collapses identical-triple rooms into one cloud after entering the maze bare', () => {
    const state = stateVisiting(hollowdeep, ['cathedral', ...CLOUDY_TWISTIES]);
    const layout = computeMapLayout(hollowdeep, state);

    const clouds = layout.nodes.filter((n) => n.kind === 'cloud');
    expect(clouds).toHaveLength(1);
    expect(clouds[0]?.memberIds.sort()).toEqual(CLOUDY_TWISTIES);
    // No twisty renders as its own room node.
    for (const id of CLOUDY_TWISTIES) {
      expect(layout.nodes.find((n) => n.id === id)).toBeUndefined();
    }
    // The player stands somewhere in the confusion; the marker sits on the cloud.
    expect(layout.currentNodeId).toBe(clouds[0]?.id);
    // The badge counts the members' exits, not the members.
    expect(clouds[0]?.exitCount).toBeGreaterThan(CLOUDY_TWISTIES.length);
  });

  it('splits a room out of the cloud while a portable item lies in it', () => {
    const state = stateVisiting(hollowdeep, ['cathedral', ...CLOUDY_TWISTIES]);
    // Drop the payroll tin in twisty-3 — the classic move.
    const dropped: GameState = {
      ...state,
      itemLocations: { ...state.itemLocations, 'payroll-tin': 'twisty-3' },
    };
    const layout = computeMapLayout(hollowdeep, dropped);

    const split = layout.nodes.find((n) => n.id === 'twisty-3');
    expect(split?.kind).toBe('room');
    const cloud = layout.nodes.find((n) => n.kind === 'cloud');
    expect(cloud?.memberIds.sort()).toEqual(['twisty-1', 'twisty-2', 'twisty-4']);
  });

  it('re-collapses when the item is picked back up', () => {
    const state = stateVisiting(hollowdeep, ['cathedral', ...CLOUDY_TWISTIES]);
    const dropped: GameState = {
      ...state,
      itemLocations: { ...state.itemLocations, 'payroll-tin': 'twisty-3' },
    };
    const retrieved: GameState = {
      ...dropped,
      itemLocations: { ...dropped.itemLocations, 'payroll-tin': 'inventory' },
    };
    const layout = computeMapLayout(hollowdeep, retrieved);

    expect(layout.nodes.find((n) => n.id === 'twisty-3')).toBeUndefined();
    const cloud = layout.nodes.find((n) => n.kind === 'cloud');
    expect(cloud?.memberIds.sort()).toEqual(CLOUDY_TWISTIES);
  });

  it('maps twisty-5 as its own room — its draught sentence makes its triple distinct', () => {
    const state = stateVisiting(hollowdeep, ['cathedral', ...CLOUDY_TWISTIES, 'twisty-5']);
    const layout = computeMapLayout(hollowdeep, state);

    const draughtRoom = layout.nodes.find((n) => n.id === 'twisty-5');
    expect(draughtRoom?.kind).toBe('room');
    const cloud = layout.nodes.find((n) => n.kind === 'cloud');
    expect(cloud?.memberIds).not.toContain('twisty-5');
  });

  it('a non-portable item does not mark a room', () => {
    const fixed = hollowdeep.items.find((i) => !i.portable);
    expect(fixed).toBeDefined(); // the rule needs a real fixture to mean anything
    const state = stateVisiting(hollowdeep, ['cathedral', ...CLOUDY_TWISTIES]);
    const planted: GameState = {
      ...state,
      itemLocations: { ...state.itemLocations, [fixed?.id ?? '']: 'twisty-2' },
    };
    const layout = computeMapLayout(hollowdeep, planted);
    expect(layout.nodes.find((n) => n.id === 'twisty-2')).toBeUndefined();
  });
});

describe('what the map may know', () => {
  it('never renders un-visited structure', () => {
    const visitedRooms = ['main-street', 'chapel'];
    const state = stateVisiting(hollowdeep, visitedRooms);
    const layout = computeMapLayout(hollowdeep, state);

    const allVisited = new Set(state.visited);
    for (const node of layout.nodes) {
      for (const member of node.memberIds) expect(allVisited.has(member)).toBe(true);
    }
    for (const edge of layout.edges) {
      expect(layout.nodes.some((n) => n.id === edge.from)).toBe(true);
      expect(layout.nodes.some((n) => n.id === edge.to)).toBe(true);
    }
    expect(layout.visitedCount).toBe(state.visited.length);
    expect(layout.totalCount).toBe(hollowdeep.locations.length);
  });

  it('draws no edge or stub for an unrevealed hidden exit, even between visited rooms', () => {
    // tailings-path's nw exit to the-gunnis is hidden. Visit both ends
    // without the reveal: the map must stay silent about the connection —
    // walking and knowing are different rights (view.ts's own asymmetry).
    const state = stateVisiting(hollowdeep, ['tailings-path', 'the-gunnis']);
    const layout = computeMapLayout(hollowdeep, state);

    const edge = layout.edges.find(
      (e) =>
        (e.from === 'tailings-path' && e.to === 'the-gunnis') ||
        (e.from === 'the-gunnis' && e.to === 'tailings-path'),
    );
    expect(edge).toBeUndefined();
    expect(layout.stubs.find((s) => s.from === 'tailings-path' && s.dir === 'nw')).toBeUndefined();
  });

  it('stubs known passable exits toward unvisited rooms, and only those', () => {
    // main-street alone: n (chapel), s (general-store), ne (tailings-path)
    // are plain exits and must stub; e (assay-office) is `if`-guarded and
    // must not while the guard fails at game start.
    const state = stateVisiting(hollowdeep, ['main-street']);
    const layout = computeMapLayout(hollowdeep, state);

    const dirs = layout.stubs.filter((s) => s.from === 'main-street').map((s) => s.dir);
    expect(dirs).toContain('n');
    expect(dirs).toContain('s');
    expect(dirs).not.toContain('e');
  });
});

describe('layout mechanics', () => {
  it('is deterministic: identical inputs, identical output', () => {
    const state = stateVisiting(hollowdeep, ['main-street', 'chapel', 'general-store', ...CLOUDY_TWISTIES]);
    expect(computeMapLayout(hollowdeep, state)).toEqual(computeMapLayout(hollowdeep, state));
  });

  it('honors the compass: east means greater x, north means lesser y', () => {
    // coach-road → e → main-street → n → chapel (hollowdeep's opening legs).
    const state = stateVisiting(hollowdeep, ['main-street', 'chapel']);
    const layout = computeMapLayout(hollowdeep, state);

    const road = layout.nodes.find((n) => n.id === 'coach-road');
    const street = layout.nodes.find((n) => n.id === 'main-street');
    const chapel = layout.nodes.find((n) => n.id === 'chapel');
    expect(road).toBeDefined();
    expect(street).toBeDefined();
    expect(chapel).toBeDefined();
    if (road && street && chapel) {
      expect(street.x).toBeGreaterThan(road.x);
      expect(chapel.y).toBeLessThan(street.y);
    }
  });

  it('never places two nodes in the same cell', () => {
    const state = stateVisiting(hollowdeep, [
      'main-street',
      'chapel',
      'general-store',
      'tailings-path',
      ...CLOUDY_TWISTIES,
      'twisty-5',
    ]);
    const layout = computeMapLayout(hollowdeep, state);
    const cells = layout.nodes.map((n) => `${n.x},${n.y}`);
    expect(new Set(cells).size).toBe(cells.length);
  });
});

describe('test-cave: the prose already distinguishes its twisties', () => {
  it('renders twisty-1 and twisty-2 as distinct rooms — their fulls differ, so no cloud forms', () => {
    const state = stateVisiting(testCave, ['twisty-1', 'twisty-2']);
    const layout = computeMapLayout(testCave, state);

    expect(layout.nodes.find((n) => n.id === 'twisty-1')?.kind).toBe('room');
    expect(layout.nodes.find((n) => n.id === 'twisty-2')?.kind).toBe('room');
    expect(layout.nodes.filter((n) => n.kind === 'cloud')).toHaveLength(0);
  });

  it('hides the unrevealed grotto → deep-vault hidden exit', () => {
    const state = stateVisiting(testCave, ['grotto']);
    const layout = computeMapLayout(testCave, state);
    expect(layout.stubs.find((s) => s.from === 'grotto' && s.dir === 'down')).toBeUndefined();
  });
});
