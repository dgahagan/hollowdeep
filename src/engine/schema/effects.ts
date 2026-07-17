import { z } from 'zod';
import { zId, zDirection } from './common';

// ─────────────────────────────────────────────────────────────────────────────
// THE EFFECT VOCABULARY IS FROZEN AT v2 (design plan §4.1, §10 risk register).
//
// Version history — every entry here is a schema version bump that went
// through its own design plan, which is the discipline the freeze exists for:
//   v1 (2026-07-15) — the original twelve (foundation plan §4.1).
//   v2 (2026-07-17) — added `startTimer` (hints-timers plan §4.1), alongside
//     the `timerExpired` trigger and `GameState.timers`. ENGINE_VERSION 2.0.0.
//
// Every state mutation in the engine is one of the variants below — action
// handlers and event triggers emit the same vocabulary, and `applyEffects`
// (systems/events.ts) is the single choke point that interprets it. That is
// what makes mutation testable in one place instead of scattered across a
// dozen handlers.
//
// The risk this freeze exists to manage is an over-general effect vocabulary:
// once content can express arbitrary mutation, the engine stops being a set of
// rules and becomes an interpreter for a language nobody designed. So:
//
//   **Adding a variant is a schema version bump, not an ad-hoc addition.**
//
// If an adventure seems to need a new effect, the first question is whether an
// existing variant plus a condition expresses it. New adventures must be
// authorable with no engine change (FR-6.1); a new effect is by definition an
// engine change and needs the same scrutiny as any other contract break.
//
// SHAPE NOTE — why a discriminated union rather than §4.1's literal snippet.
// The design plan sketches Effect as one object with all-optional fields
// (`{printId?, setFlag?, moveItem?, …}`), and §4.1 says the schema files are
// authoritative over the abridged sketch. A bag-of-optionals is wrong here for
// two concrete reasons:
//   1. `do: Effect[]` is ORDERED and order is observable (it determines RNG
//      consumption and output-event sequence). A single object carrying both
//      `moveItem` and `die` has no defined order between them — the schema
//      would be admitting states the engine cannot describe.
//   2. A union gives `applyEffects` an exhaustive switch: adding a variant
//      without handling it becomes a type error rather than a silent no-op.
// Each element is therefore exactly one effect, tagged by `kind`.
// ─────────────────────────────────────────────────────────────────────────────

/** Print a literal string. Prefer `printId` for anything reused or localizable. */
const zPrint = z.strictObject({
  kind: z.literal('print'),
  text: z.string().min(1),
});

/** Print a named string from `strings.json`. */
const zPrintId = z.strictObject({
  kind: z.literal('printId'),
  id: zId,
});

/** Set a flag. Flags hold `boolean | number` (see GameState, design plan §5.2). */
const zSetFlag = z.strictObject({
  kind: z.literal('setFlag'),
  flag: zId,
  value: z.union([z.boolean(), z.number()]).default(true),
});

const zClearFlag = z.strictObject({
  kind: z.literal('clearFlag'),
  flag: zId,
});

/** Move an item. `to` is a location id, a container id, `inventory`, or `nowhere`. */
const zMoveItem = z.strictObject({
  kind: z.literal('moveItem'),
  item: zId,
  to: zId,
});

/** Reveal a `hidden: true` exit, e.g. after searching. */
const zRevealExit = z.strictObject({
  kind: z.literal('revealExit'),
  location: zId,
  dir: zDirection,
});

/**
 * Adjust score directly.
 *
 * Note for content authors: treasure points and milestones are declared as
 * data (`items[].treasure`, `scoring.milestones`) and awarded by the scoring
 * system — they must NOT also be awarded here, or they would be counted twice
 * and `maxScore` could not be reconciled (T5 checks that sum). Reach for this
 * variant only for scoring that is genuinely outside the treasure/milestone
 * model.
 */
const zAddScore = z.strictObject({
  kind: z.literal('addScore'),
  points: z.number().int(),
});

/** Move the player. */
const zTeleport = z.strictObject({
  kind: z.literal('teleport'),
  to: zId,
});

/** Kill the player; the turn pipeline handles penalty/scatter/reincarnation. */
const zDie = z.strictObject({
  kind: z.literal('die'),
  messageId: zId.optional(),
});

const zAward = z.strictObject({
  kind: z.literal('award'),
  achievement: zId,
});

const zEndGame = z.strictObject({
  kind: z.literal('endGame'),
  victory: z.boolean(),
});

/** Force a creature active regardless of its `spawn` gating. */
const zActivateCreature = z.strictObject({
  kind: z.literal('activateCreature'),
  creature: zId,
});

/**
 * Start (or restart) a named relative timer (hints-timers plan §4).
 *
 * `timer` is a content-chosen id in the same implicit namespace as flags —
 * declared nowhere, created by use. After `startTimer t n` the player has
 * exactly `n` further CONSUMED turns; the matching `timerExpired` events fire
 * during the world tick of the n-th, after that turn's action (so the n-th
 * move may be the one that gets you clear, and the guard sees you gone).
 *
 * Starting a timer that is already running RESETS it — the second pull of the
 * stull must not be silently weaker than the first. One-shot arming is a
 * guard flag on the arming event, expressible today.
 */
const zStartTimer = z.strictObject({
  kind: z.literal('startTimer'),
  timer: zId,
  turns: z.number().int().min(1),
});

/** The frozen v2 effect union — see the banner above before touching it. */
export const zEffect = z.discriminatedUnion('kind', [
  zPrint,
  zPrintId,
  zSetFlag,
  zClearFlag,
  zMoveItem,
  zRevealExit,
  zAddScore,
  zTeleport,
  zDie,
  zAward,
  zEndGame,
  zActivateCreature,
  zStartTimer,
]);

export type Effect = z.infer<typeof zEffect>;

/** Every `kind` in the frozen union — handy for exhaustiveness tests. */
export const EFFECT_KINDS = [
  'print',
  'printId',
  'setFlag',
  'clearFlag',
  'moveItem',
  'revealExit',
  'addScore',
  'teleport',
  'die',
  'award',
  'endGame',
  'activateCreature',
  'startTimer',
] as const satisfies readonly Effect['kind'][];
