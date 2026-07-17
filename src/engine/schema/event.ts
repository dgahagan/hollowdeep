import { z } from 'zod';
import { zId } from './common';
import { zCondition } from './conditions';
import { zEffect } from './effects';

/**
 * What fires an event (FR-1.8). `target` narrows the trigger to one entity;
 * without it the trigger matches any subject of that type.
 *
 * `target` is deliberately polymorphic — what it names depends on `type`, as
 * §4.1's sketch already established (a location for `enter`, an item for
 * `take`, a flag for `flagSet`):
 *   - `enter` → `target` is a location id
 *   - `take`/`drop`/`use`/`read`/`open`/`search` → `target` is an item id
 *   - `verb` → `target` is a verb id
 *   - `turnStart` → `turn` is the turn number
 *   - `flagSet` → `target` is a flag id
 *   - `word` → `word` is the magic word (FR-1.9)
 *
 * Two types were added during T9 (2026-07-16), both forced by §8's own
 * content rather than invented:
 *   - **`search`** — §8 gives `hollow-tree` a `search tree` event revealing
 *     the iron key. It parallels take/drop/use/read/open exactly (target is
 *     the item searched).
 *   - **`verb`** — §8 gives `ledge` a `jump` hazard. `jump` is intransitive,
 *     so no noun-bearing trigger fits, and it is not a magic word (those are
 *     never surfaced in the UI, FR-1.9). `verb` fires on a verb id and is the
 *     general answer for any adventure-defined verb the engine has no core
 *     handler for. Engine contract for T13/T14: after dispatch, fire `verb`
 *     triggers; a verb with no handler and no matching event is a nudge.
 *
 * One type added with schema v2 (2026-07-17, hints-timers plan §4.2):
 *   - **`timerExpired`** — `target` is a timer id (the `startTimer` effect's
 *     namespace). Fires once, during the world tick of the turn the count
 *     runs out; the entry is removed before the events fire, so an expiry
 *     event may re-arm its own id (the periodic-timer idiom). All events
 *     sharing one expiry are judged against a snapshot, like every trigger.
 */
export const zTrigger = z
  .strictObject({
    type: z.enum([
      'enter',
      'take',
      'drop',
      'use',
      'read',
      'open',
      'search',
      'verb',
      'turnStart',
      'flagSet',
      'word',
      'timerExpired',
    ]),
    target: zId.optional(),
    turn: z.number().int().nonnegative().optional(),
    word: z.string().min(1).optional(),
  })
  .superRefine((t, ctx) => {
    if (t.type === 'verb' && t.target === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['target'],
        message: 'a verb trigger needs the verb id it fires on',
      });
    }
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
    if (t.type === 'timerExpired' && t.target === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['target'],
        message: 'a timerExpired trigger needs the timer id it fires on',
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
