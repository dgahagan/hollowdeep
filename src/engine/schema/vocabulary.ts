import { z } from 'zod';
import { zId } from './common';

/** The three grammars the parser accepts (FR-2.1, design plan §5.4). */
export const zVerbPattern = z.enum(['V', 'VN', 'VNPN']);
export type VerbPattern = z.infer<typeof zVerbPattern>;

/**
 * A verb and its synonyms.
 *
 * SHAPE NOTE: §4.1 sketches a single `pattern`; this is `patterns`, a list.
 * Real verbs take more than one grammar — `look` is both V ("look") and VN
 * ("look at carving"); `oil` is VN ("oil door") and VNPN ("oil door with
 * flask"). With a single pattern each of those needs two entries sharing one
 * word list, and the parser would have to reconcile duplicate verb ids.
 *
 * Core verbs ship in-engine (`parser/vocab.ts`, design plan §10) so every
 * adventure speaks the same base language. Modules **extend** this — they add
 * verbs and add synonyms to existing ones, but cannot remove a core verb.
 */
export const zVerb = z.strictObject({
  id: zId,
  /** Synonyms; all map to `id`. FR-2.2. */
  words: z.array(z.string().min(1)).min(1),
  patterns: z.array(zVerbPattern).min(1),
});
export type Verb = z.infer<typeof zVerb>;

/**
 * A magic word (FR-1.9). Never surfaced in the UI — not in `availableActions`,
 * not in autocomplete. Discoverable only by finding it in the world, in the
 * xyzzy tradition. It fires `eventId`, so what it *does* is ordinary event
 * data.
 */
export const zMagicWord = z.strictObject({
  word: z.string().min(1),
  eventId: zId,
});
export type MagicWord = z.infer<typeof zMagicWord>;

export const zVocabulary = z.strictObject({
  verbs: z.array(zVerb).default([]),
  /** Words the tokenizer drops: "the", "a", "at"… FR-2.1. */
  noiseWords: z.array(z.string().min(1)).default([]),
  magicWords: z.array(zMagicWord).default([]),
});
export type Vocabulary = z.infer<typeof zVocabulary>;
