import { z } from 'zod';
import { zId } from './common';
import { zCondition } from './conditions';
import { zEffect } from './effects';

/**
 * What fires an event (FR-1.8). `target` narrows the trigger to one entity;
 * without it the trigger matches any subject of that type.
 *
 * Which extra field applies depends on `type`:
 *   - `enter` → `target` is a location id
 *   - `take`/`drop`/`use`/`read`/`open` → `target` is an item id
 *   - `turnStart` → `turn` is the turn number
 *   - `flagSet` → `target` is a flag id
 *   - `word` → `word` is the magic word (FR-1.9)
 */
export const zTrigger = z
  .strictObject({
    type: z.enum(['enter', 'take', 'drop', 'use', 'read', 'open', 'turnStart', 'flagSet', 'word']),
    target: zId.optional(),
    turn: z.number().int().nonnegative().optional(),
    word: z.string().min(1).optional(),
  })
  .superRefine((t, ctx) => {
    if (t.type === 'turnStart' && t.turn === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['turn'],
        message: 'a turnStart trigger needs a turn number',
      });
    }
    if (t.type === 'word' && t.word === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['word'],
        message: 'a word trigger needs the word it fires on',
      });
    }
  });
export type Trigger = z.infer<typeof zTrigger>;

export const zEvent = z.strictObject({
  id: zId,
  /** Fire at most once per game; tracked via `state.firedEvents`. */
  once: z.boolean().default(false),
  on: zTrigger,
  /** Extra guard beyond the trigger; a list ORs together. */
  if: z.array(zCondition).optional(),
  /** Ordered — effects apply in sequence (see effects.ts). */
  do: z.array(zEffect).min(1),
});
export type GameEvent = z.infer<typeof zEvent>;

export const zEvents = z.array(zEvent);
