import { z } from 'zod';
import { zId } from './common';
import { zCondition } from './conditions';

// ─────────────────────────────────────────────────────────────────────────────
// `hints.json` — the eleventh module document (hints-timers plan §5.1).
//
// FR-7.2's gradual hint system: condition-gated ladders of rungs, nudge →
// hint → solution. The engine's `hint` verb scans `hints` in DOCUMENT ORDER
// and reveals the next rung of the first entry whose `when` holds and whose
// ladder still has unrevealed rungs — so document order is priority order,
// author-controlled, with no extra syntax.
//
// A hint is *available* while `when` holds; authors retire a hint the same
// way they open one (the pump hint closes itself on `notFlag pump-drained`).
// There is deliberately no `until` field — conditions already express it.
//
// The document is REQUIRED but may be empty: `{"noHintMessageId": "...",
// "hints": []}` is a complete, legal hints document. An adventure is allowed
// to offer no hints; it is not allowed to be *silent* about it —
// `noHintMessageId` is what the `hint` verb says when nothing is available,
// and all player-facing prose belongs to the adventure (strings.json's rule).
//
// AUTHORING RULE the schema cannot enforce (FR-1.9): a ladder rung must never
// print a magic word. A word-secret's solution rung points at where the word
// is LEARNED ("the foreman kept notes"), never at the word itself.
// ─────────────────────────────────────────────────────────────────────────────

/** One puzzle's ladder. Rungs are revealed in order, each costing `scoring.hintPenalty`. */
export const zHintEntry = z.strictObject({
  id: zId,
  /** Available while this holds. A list ORs; retire a hint with `notFlag`. */
  when: z.array(zCondition).min(1),
  /** The rungs, mildest first. Three (nudge → hint → solution) is the convention, not a rule. */
  ladder: z.array(z.string().min(1)).min(1),
});
export type HintEntry = z.infer<typeof zHintEntry>;

export const zHints = z.strictObject({
  /** strings.json id printed by `hint` when no ladder is available. */
  noHintMessageId: zId,
  /** Document order is selection priority. */
  hints: z.array(zHintEntry),
});
export type Hints = z.infer<typeof zHints>;
