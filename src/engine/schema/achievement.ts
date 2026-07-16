import { z } from 'zod';
import { zId } from './common';

/**
 * An adventure-defined achievement (FR-1.12).
 *
 * Achievements **complement, never replace** classic point scoring — they
 * award no points and cannot affect rank. Content awards them with the `award`
 * effect or at victory; the engine appends to `state.achievements` and emits
 * an `achievement` OutputEvent.
 *
 * In this plan that transcript notice is the whole presentation: the
 * achievements UI belongs to Phase 3 (design plan §2).
 */
export const zAchievement = z.strictObject({
  id: zId,
  /** Player-facing title, e.g. "First Blood". */
  name: z.string().min(1),
  description: z.string().min(1),
  /** Hide the description until earned, so it doesn't spoil the secret it marks. */
  hidden: z.boolean().default(false),
});
export type Achievement = z.infer<typeof zAchievement>;

export const zAchievements = z.array(zAchievement);
