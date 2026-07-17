import { useMemo } from 'react';
import type { AdventureModule, Direction } from '../engine/schema';
import type { GameState } from '../engine/types';
import { Overlay } from './Overlays';
import { computeMapLayout, type MapLayout, type MapNode } from './mapLayout';

// The auto-map overlay (T4, ui-plan §4): a pure SVG rendering of
// mapLayout.ts's output. Everything worth testing lives in that module; this
// file only draws — nodes as rounded rects (clouds dashed, with their
// edge-count badge), edges as lines, unexplored exits as short stubs ending
// in a dot, the current position ringed in the accent color, and the visited
// count in the corner (the same number the stats screen will call "map
// coverage").
//
// SVG rather than canvas (ui-plan §4): crisp at any zoom, themeable for free
// because every fill/stroke below is a token var() that follows data-theme
// like the rest of the page. Styles are inline attributes, not app.css
// classes, to keep this task's files disjoint from T5's css edits — and
// because nothing outside this component will ever address them.

/** Grid-to-SVG scale. Cells are wider than tall — room names are horizontal. */
const CELL_W = 150;
const CELL_H = 96;
const NODE_W = 118;
const NODE_H = 44;
/** How far a stub pokes out of its node toward the unexplored. */
const STUB_LEN = 30;

/** Unit-ish vectors for drawing stubs, matching mapLayout's DIRECTION_VECTORS bearings. */
const STUB_VECTORS: Record<Direction, readonly [number, number]> = {
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
  ne: [0.75, -0.75],
  nw: [-0.75, -0.75],
  se: [0.75, 0.75],
  sw: [-0.75, 0.75],
  up: [0.35, -1],
  down: [-0.35, 1],
  in: [1, 0.5],
  out: [-1, 0.5],
};

/** Where a stub leaves its node's border, for a given bearing. */
function stubStart(node: MapNode, dir: Direction): [number, number] {
  const [vx, vy] = STUB_VECTORS[dir];
  const cx = node.x * CELL_W;
  const cy = node.y * CELL_H;
  return [cx + (vx * NODE_W) / 2, cy + (vy * NODE_H) / 2];
}

export interface MapOverlayProps {
  module: AdventureModule;
  state: GameState;
}

export function MapOverlay({ module, state }: MapOverlayProps) {
  // Memoized on the exact inputs the layout reads. `state` is replaced
  // wholesale each turn (the engine is immutable-update), so identity is a
  // sound cache key and the layout recomputes exactly when a turn happens.
  const layout: MapLayout = useMemo(() => computeMapLayout(module, state), [module, state]);

  const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));

  // viewBox from extents, padded a full cell so stubs and strokes never clip.
  const xs = layout.nodes.map((n) => n.x * CELL_W);
  const ys = layout.nodes.map((n) => n.y * CELL_H);
  const minX = Math.min(...xs, 0) - CELL_W;
  const maxX = Math.max(...xs, 0) + CELL_W;
  const minY = Math.min(...ys, 0) - CELL_H;
  const maxY = Math.max(...ys, 0) + CELL_H;

  return (
    <Overlay id="map" title="Map">
      <svg
        viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label={`Map of the explored cave: ${layout.visitedCount} rooms visited`}
      >
        {/* Edges first, so nodes paint over their endpoints. */}
        {layout.edges.map((edge) => {
          const from = nodeById.get(edge.from);
          const to = nodeById.get(edge.to);
          if (from === undefined || to === undefined) return null;
          return (
            <line
              key={`${edge.from}->${edge.to}`}
              x1={from.x * CELL_W}
              y1={from.y * CELL_H}
              x2={to.x * CELL_W}
              y2={to.y * CELL_H}
              stroke="var(--border-strong)"
              strokeWidth={2}
            />
          );
        })}

        {/* Stubs: a dashed reach toward somewhere not yet walked, ending in a dot. */}
        {layout.stubs.map((stub) => {
          const from = nodeById.get(stub.from);
          if (from === undefined) return null;
          const [sx, sy] = stubStart(from, stub.dir);
          const [vx, vy] = STUB_VECTORS[stub.dir];
          const ex = sx + vx * STUB_LEN;
          const ey = sy + vy * STUB_LEN;
          return (
            <g key={`${stub.from}:${stub.dir}`}>
              <line
                x1={sx}
                y1={sy}
                x2={ex}
                y2={ey}
                stroke="var(--ink-muted)"
                strokeWidth={1.5}
                strokeDasharray="3 3"
              />
              <circle cx={ex} cy={ey} r={3} fill="var(--ink-muted)" />
            </g>
          );
        })}

        {/* Nodes. */}
        {layout.nodes.map((node) => {
          const cx = node.x * CELL_W;
          const cy = node.y * CELL_H;
          const isCurrent = node.id === layout.currentNodeId;
          return (
            <g key={node.id}>
              <rect
                x={cx - NODE_W / 2}
                y={cy - NODE_H / 2}
                width={NODE_W}
                height={NODE_H}
                rx={node.kind === 'cloud' ? NODE_H / 2 : 6}
                fill="var(--surface-2)"
                stroke={isCurrent ? 'var(--accent)' : 'var(--border-strong)'}
                strokeWidth={isCurrent ? 3 : 1.5}
                strokeDasharray={node.kind === 'cloud' ? '5 4' : undefined}
              />
              <text
                x={cx}
                y={node.kind === 'cloud' ? cy - 2 : cy}
                textAnchor="middle"
                dominantBaseline="central"
                fill="var(--ink)"
                style={{ font: '12px var(--font-mono)' }}
              >
                {node.label}
              </text>
              {node.kind === 'cloud' && (
                <text
                  x={cx}
                  y={cy + 13}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="var(--ink-muted)"
                  style={{ font: '10px var(--font-mono)' }}
                >
                  {node.exitCount ?? 0} passages, all confused
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p
        style={{
          margin: '0.5rem 0 0',
          textAlign: 'right',
          color: 'var(--ink-muted)',
          font: '0.78rem var(--font-mono)',
        }}
      >
        {layout.visitedCount} of {layout.totalCount} rooms visited
      </p>
    </Overlay>
  );
}
