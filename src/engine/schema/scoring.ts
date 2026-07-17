import { z } from 'zod';
import { zId } from './common';
import { zCondition } from './conditions';

/**
 * A one-off scoring award for reaching a state (FR-1.5) — "you got the grate
 * open", "you reached the bottom".
 *
 * `when` is declarative rather than an event effect, and that is the point:
 * the scoring system evaluates it and awards the points once, so milestone
 * points are *derivable from data*. That is what lets T5 reconcile
 * `maxScore` against the sum of attainable points. Award milestones with
 * `addScore` from an event instead and the total silently stops adding up.
 */
export const zMilestone = z.strictObject({
  id: zId,
  points: z.number().int().nonnegative(),
  /** Author-facing note; not shown to the player. */
  description: z.string().min(1).optional(),
  /** Awarded the first turn this passes. A list ORs together. */
  when: z.array(zCondition).min(1),
});
export type Milestone = z.infer<typeof zMilestone>;

/**
 * An end-of-game title (FR-1.5, classic style). The player's rank is the
 * highest `minScore` they reached or exceeded.
 */
export const zRank = z.strictObject({
  minScore: z.number().int(),
  title: z.string().min(1),
});
export type Rank = z.infer<typeof zRank>;

export const zScoring = z
  .strictObject({
    milestones: z.array(zMilestone).default([]),
    /** Subtracted per death. A deduction — it never counts toward `maxScore`. */
    deathPenalty: z.number().int().nonnegative(),
    /**
     * Subtracted per hint rung revealed (FR-7.2: "each step costing points",
     * FR-1.5). A deduction, exactly like `deathPenalty` — it never counts
     * toward `maxScore`, and the score floors at 0.
     */
    hintPenalty: z.number().int().nonnegative(),
    ranks: z.array(zRank).min(1),
  })
  // A rank table with no floor leaves a low scorer rankless at the one moment
  // the game owes them a verdict.
  .refine((s) => s.ranks.some((r) => r.minScore <= 0), {
    message: 'ranks need an entry with minScore <= 0, or a zero score has no rank',
    path: ['ranks'],
  })
  // Duplicate thresholds make the winning rank depend on array order, which is
  // exactly the kind of thing that is fine until someone sorts the file.
  .refine((s) => new Set(s.ranks.map((r) => r.minScore)).size === s.ranks.length, {
    message: 'two ranks share a minScore; which one wins would depend on array order',
    path: ['ranks'],
  });
export type Scoring = z.infer<typeof zScoring>;
