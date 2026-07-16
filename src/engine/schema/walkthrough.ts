import { z } from 'zod';
import { zId } from './common';

/** One scripted command plus what the transcript must contain afterward. */
export const zWalkthroughStep = z.strictObject({
  /** A command exactly as a player would type it. T13 checks every one parses. */
  cmd: z.string().min(1),
  /**
   * Substring(s) the turn's output must contain. A list requires ALL of them
   * (unlike conditions, which OR — a walkthrough assertion that passed on
   * "any of these" would be a weaker check than it looks).
   */
  expect: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
});
export type WalkthroughStep = z.infer<typeof zWalkthroughStep>;

/**
 * The scripted solution (design plan §9). This is a test asset that happens to
 * live in the module: T23 drives it through `step()` and asserts the ending.
 *
 * It must reach `expectedScore` at **every** seed, not just the fixed one.
 * That is only achievable because the thief is deterministic (§8) and the
 * stalker is wardable — so if a seed fails, that is a content or engine bug to
 * debug, never a reason to weaken the assertion.
 */
export const zWalkthrough = z.strictObject({
  steps: z.array(zWalkthroughStep).min(1),
  expectedScore: z.number().int(),
  expectedRank: z.string().min(1).optional(),
  expectedAchievements: z.array(zId).default([]),
});
export type Walkthrough = z.infer<typeof zWalkthrough>;
