import type { AdventureModule, Direction, Exit, Location } from '../engine/schema';
import { DIRECTIONS } from '../engine/schema';
import type { GameState } from '../engine/types';
import { evalConditions, isExitRevealed } from '../engine/systems/events';

// The auto-map's layout engine (T4, ui-plan §4) — pure and headless: given
// the module and a GameState, produce node positions, edges, and stubs. No
// DOM, no React, no randomness, no physics; the same inputs always yield the
// same layout, so the map never wiggles between renders (ui-plan §4's
// "deterministic, no physics simulation").
//
// **What the map is allowed to know** is the whole design problem, so the
// rules are stated once, here, and the code below only implements them:
//
//   1. Only VISITED locations produce structure. Unvisited rooms do not
//      exist on the map — not as nodes, not as edge endpoints.
//   2. An exit the prose has never admitted to does not exist here either: a
//      `hidden` exit draws nothing (no edge, no stub) until a `revealExit`
//      effect has fired — even if the player guessed it and walked through
//      it. That mirrors view.ts's `exitKnown` exactly: walking and knowing
//      are different rights, and the map only gets the second one.
//   3. Stubs (exits from a visited room toward an unvisited one) also
//      require the exit to be currently passable, mirroring view.ts's
//      `visibleExits`: a known-but-blocked exit is usually blocked BY a
//      puzzle, and a stub would announce the passage the prose is
//      deliberately not listing. Edges between two visited rooms skip the
//      passability check on purpose — the player has stood on both ends, and
//      a door that has since swung shut should not erase a corridor from
//      memory.
//   4. **The maze cloud rule** (ui-plan §4, FR-3.4): visited locations whose
//      `(full, brief, artId)` triple is identical to another visited
//      location's collapse into one cloud node. A member renders as its own
//      distinct node ONLY while it currently contains a portable item — the
//      player has marked it, the classic way. Live-derived and stateless:
//      picking the marker back up re-collapses the cloud on the next call.
//      Hollowdeep's twisty-5 carries an extra draught sentence in its
//      `full`, so its triple differs and it maps as itself once visited —
//      the map remembers what the prose already distinguished, and nothing
//      more. (test-cave's two twisties BOTH have distinct fulls — its
//      draught room is twisty-2 — so they never cloud at all.)
//
// Layout: a breadth-first walk of the visited exit graph from the module's
// start location, placing each node on an integer grid one step from its
// parent in the exit's compass direction (n is up, ne up-right, …). A cell
// already taken triggers deterministic collision nudging: the nearest free
// cell in a fixed spiral order. Determinism holds because BFS order (queue +
// DIRECTIONS iteration order) and the nudge search order are both fixed.

/** Grid step per compass direction: screen-style y (north is NEGATIVE y). */
const DIRECTION_VECTORS: Record<Direction, readonly [number, number]> = {
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
  ne: [1, -1],
  nw: [-1, -1],
  se: [1, 1],
  sw: [-1, 1],
  // The non-compass four have no true bearing; they borrow a plausible one
  // (up trends north, in trends east) and let collision nudging sort out any
  // pile-ups. Arbitrary but FIXED — determinism is the requirement, not
  // cartographic truth.
  up: [0, -1],
  down: [0, 1],
  in: [1, 0],
  out: [-1, 0],
};

export interface MapNode {
  /** Render identity: the location id, or `cloud:<smallest member id>`. */
  id: string;
  kind: 'room' | 'cloud';
  /** Grid coordinates (integer; the SVG layer scales them). */
  x: number;
  y: number;
  /** Display label — the location's `name`, or the shared name of a cloud's members. */
  label: string;
  /** The visited location ids this node stands for (exactly one for `room`). */
  memberIds: string[];
  /** Cloud badge: total exits leading out of the collapsed members ("how tangled"). */
  exitCount?: number;
}

/** An edge between two placed nodes (deduplicated; reciprocal exits draw once). */
export interface MapEdge {
  from: string;
  to: string;
}

/** A known, passable exit from a placed node toward somewhere unvisited. */
export interface MapStub {
  from: string;
  dir: Direction;
}

export interface MapLayout {
  nodes: MapNode[];
  edges: MapEdge[];
  stubs: MapStub[];
  /** The node representing the player's current location. */
  currentNodeId: string;
  visitedCount: number;
  totalCount: number;
}

/** Iterate a location's exits in the fixed DIRECTIONS order (determinism). */
function exitsInOrder(location: Location): Array<[Direction, Exit]> {
  const result: Array<[Direction, Exit]> = [];
  for (const dir of DIRECTIONS) {
    const exit = location.exits[dir];
    if (exit !== undefined) result.push([dir, exit]);
  }
  return result;
}

/** Rule 2: the map may draw this exit only if the prose could mention it. */
function exitKnown(state: GameState, location: Location, dir: Direction, exit: Exit): boolean {
  return !exit.hidden || isExitRevealed(state, location.id, dir);
}

/** Rule 3's extra requirement for stubs. */
function exitPassable(module: AdventureModule, state: GameState, exit: Exit): boolean {
  if (exit.if === undefined) return true;
  const [passable] = evalConditions(module, state, exit.if);
  return passable;
}

/**
 * Deterministic collision nudging: the desired cell if free, else the
 * nearest free cell in expanding Chebyshev rings, each ring scanned in a
 * fixed row-major order. Bounded only by map size, which is bounded by the
 * module's location count — this cannot fail to terminate on real content.
 */
function findFreeCell(occupied: Set<string>, x: number, y: number): [number, number] {
  if (!occupied.has(`${x},${y}`)) return [x, y];
  for (let radius = 1; ; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const cx = x + dx;
        const cy = y + dy;
        if (!occupied.has(`${cx},${cy}`)) return [cx, cy];
      }
    }
  }
}

/** Rule 4's grouping key. JSON-encoded so no content string can forge a collision via a separator. */
function tripleKey(location: Location): string {
  return JSON.stringify([location.full, location.brief, location.artId]);
}

export function computeMapLayout(module: AdventureModule, state: GameState): MapLayout {
  const locationById = new Map(module.locations.map((location) => [location.id, location]));
  const visited = new Set(state.visited);

  // ── Rule 4: cloud membership ─────────────────────────────────────────────
  // Group visited locations by triple; find which rooms are "marked" (hold a
  // portable item right now — directly, not inside a container: a marker the
  // player cannot see on the floor is not marking anything).
  const marked = new Set<string>();
  for (const item of module.items) {
    if (!item.portable) continue;
    const at = state.itemLocations[item.id];
    if (at !== undefined && visited.has(at)) marked.add(at);
  }

  const groups = new Map<string, string[]>();
  for (const id of state.visited) {
    const location = locationById.get(id);
    if (location === undefined) continue;
    const key = tripleKey(location);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [id]);
    else group.push(id);
  }

  // location id → render-node id. A member of a multi-room group renders as
  // itself only while marked; every unmarked member shares the cloud node.
  // (Even a lone unmarked member stays in the cloud: the PROSE still cannot
  // tell it from its marked siblings, and the map knows only what the prose
  // knows.)
  const renderIdOf = new Map<string, string>();
  const cloudMembers = new Map<string, string[]>(); // cloud render id → member ids
  for (const group of groups.values()) {
    if (group.length < 2) {
      const only = group[0];
      if (only !== undefined) renderIdOf.set(only, only);
      continue;
    }
    const cloudId = `cloud:${[...group].sort()[0] ?? ''}`;
    for (const id of group) {
      if (marked.has(id)) {
        renderIdOf.set(id, id);
      } else {
        renderIdOf.set(id, cloudId);
        const members = cloudMembers.get(cloudId);
        if (members === undefined) cloudMembers.set(cloudId, [id]);
        else members.push(id);
      }
    }
  }

  // ── BFS placement over VISITED locations ─────────────────────────────────
  const positions = new Map<string, [number, number]>(); // render id → cell
  const occupied = new Set<string>();

  function place(renderId: string, x: number, y: number): void {
    if (positions.has(renderId)) return;
    const [fx, fy] = findFreeCell(occupied, x, y);
    positions.set(renderId, [fx, fy]);
    occupied.add(`${fx},${fy}`);
  }

  const edges: MapEdge[] = [];
  const edgeSeen = new Set<string>();
  const stubs: MapStub[] = [];
  const stubSeen = new Set<string>();

  // BFS from the start location (always visited — createGame seeds it), with
  // a sweep over `state.visited` afterward so structure reached by any
  // non-walking means (an event teleport, say) still lands on the map in a
  // deterministic spot instead of silently vanishing.
  const queue: string[] = [];
  const enqueued = new Set<string>();
  const startCandidates = [module.manifest.startLocation, ...state.visited];
  for (const id of startCandidates) {
    if (visited.has(id) && !enqueued.has(id)) {
      queue.push(id);
      enqueued.add(id);
    }
  }

  let head = 0;
  let fallbackRow = 0;
  while (head < queue.length) {
    const id = queue[head++];
    if (id === undefined) continue;
    const location = locationById.get(id);
    if (location === undefined) continue;
    const renderId = renderIdOf.get(id) ?? id;

    // A BFS root (start location or a disconnected sweep entry) with no
    // position yet gets one: the true start at the origin, later roots on a
    // row beneath everything placed so far.
    if (!positions.has(renderId)) {
      if (positions.size === 0) {
        place(renderId, 0, 0);
      } else {
        let maxY = 0;
        for (const [, py] of positions.values()) maxY = Math.max(maxY, py);
        place(renderId, fallbackRow++, maxY + 2);
      }
    }

    const [x, y] = positions.get(renderId) ?? [0, 0];

    for (const [dir, exit] of exitsInOrder(location)) {
      if (!exitKnown(state, location, dir, exit)) continue; // rule 2

      if (visited.has(exit.to)) {
        const destRenderId = renderIdOf.get(exit.to) ?? exit.to;
        if (destRenderId !== renderId) {
          // Deduplicate both directions: one corridor, one line.
          const key = [renderId, destRenderId].sort().join(' ');
          if (!edgeSeen.has(key)) {
            edgeSeen.add(key);
            edges.push({ from: renderId, to: destRenderId });
          }
        }
        if (!positions.has(destRenderId)) {
          const [dx, dy] = DIRECTION_VECTORS[dir];
          place(destRenderId, x + dx, y + dy);
        }
        if (!enqueued.has(exit.to)) {
          enqueued.add(exit.to);
          queue.push(exit.to);
        }
      } else if (exitPassable(module, state, exit)) {
        // rule 3: a stub only for exits the prose would list right now.
        const key = `${renderId} ${dir}`;
        if (!stubSeen.has(key)) {
          stubSeen.add(key);
          stubs.push({ from: renderId, dir });
        }
      }
    }
  }

  // ── Materialize nodes ────────────────────────────────────────────────────
  const nodes: MapNode[] = [];
  for (const [renderId, [x, y]] of positions) {
    const members = cloudMembers.get(renderId);
    if (members !== undefined) {
      // The label: cloud members share full/brief/artId but the schema does
      // not force a shared `name`; use it when they agree, else fall back to
      // something honest.
      const names = new Set(members.map((m) => locationById.get(m)?.name ?? m));
      const label = names.size === 1 ? [...names][0] ?? 'Twisting passages' : 'Twisting passages';
      let exitCount = 0;
      for (const m of members) {
        const memberLocation = locationById.get(m);
        if (memberLocation !== undefined) exitCount += exitsInOrder(memberLocation).length;
      }
      nodes.push({ id: renderId, kind: 'cloud', x, y, label, memberIds: [...members], exitCount });
    } else {
      const location = locationById.get(renderId);
      nodes.push({
        id: renderId,
        kind: 'room',
        x,
        y,
        label: location?.name ?? renderId,
        memberIds: [renderId],
      });
    }
  }

  return {
    nodes,
    edges,
    stubs,
    currentNodeId: renderIdOf.get(state.locationId) ?? state.locationId,
    visitedCount: state.visited.length,
    totalCount: module.locations.length,
  };
}
