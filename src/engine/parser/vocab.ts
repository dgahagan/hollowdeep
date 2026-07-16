import type { AdventureModule, Direction, Verb, VerbPattern } from '../schema';

// ─────────────────────────────────────────────────────────────────────────────
// CORE VERBS SHIP IN-ENGINE (design plan §10, FR-2.2/2.3).
//
// Modules **extend** this list — they add verbs, and add synonyms to existing
// ones — but they cannot remove or redefine a core verb. That is structural
// rather than a rule anyone has to remember: the merge below starts from
// CORE_VERBS and only ever unions into it, so there is no expressible way for
// content to take `take` away.
//
// The point is that every adventure speaks the same base language. A player who
// learns `x` for examine in one adventure must not find it missing in the next,
// and an adventure that redefined `drop` would make the parser a per-adventure
// dialect — which is exactly the thing a shared engine exists to prevent.
// ─────────────────────────────────────────────────────────────────────────────

export const CORE_VERBS: readonly Verb[] = [
  // movement
  { id: 'go', words: ['go', 'walk', 'head', 'move'], patterns: ['VN'] },
  { id: 'enter', words: ['enter'], patterns: ['V', 'VN'] },
  { id: 'exit', words: ['exit', 'leave'], patterns: ['V', 'VN'] },
  { id: 'back', words: ['back', 'retreat'], patterns: ['V'] },

  // senses
  { id: 'look', words: ['look', 'l'], patterns: ['V', 'VN'] },
  { id: 'examine', words: ['examine', 'x', 'inspect', 'describe'], patterns: ['VN'] },
  { id: 'read', words: ['read'], patterns: ['VN'] },
  { id: 'search', words: ['search'], patterns: ['VN'] },

  // handling
  { id: 'take', words: ['take', 'get', 'grab', 'pick'], patterns: ['VN'] },
  { id: 'drop', words: ['drop', 'discard'], patterns: ['VN'] },
  { id: 'put', words: ['put', 'place', 'insert'], patterns: ['VNPN'] },
  { id: 'open', words: ['open'], patterns: ['VN'] },
  { id: 'close', words: ['close', 'shut'], patterns: ['VN'] },
  { id: 'lock', words: ['lock'], patterns: ['VNPN'] },
  { id: 'unlock', words: ['unlock'], patterns: ['VNPN'] },

  // lamp
  { id: 'light', words: ['light', 'ignite'], patterns: ['VN'] },
  { id: 'extinguish', words: ['extinguish', 'douse', 'snuff'], patterns: ['VN'] },
  { id: 'refuel', words: ['refuel', 'refill'], patterns: ['V', 'VN'] },

  // combat
  { id: 'attack', words: ['attack', 'kill', 'hit', 'fight'], patterns: ['VN', 'VNPN'] },
  { id: 'throw', words: ['throw', 'toss'], patterns: ['VN', 'VNPN'] },
  { id: 'give', words: ['give', 'offer'], patterns: ['VNPN'] },

  // general interaction — the hook adventure verbs hang off (test-cave's `oil`)
  { id: 'use', words: ['use'], patterns: ['VN', 'VNPN'] },

  // meta
  { id: 'inventory', words: ['inventory', 'i', 'inv'], patterns: ['V'] },
  { id: 'score', words: ['score'], patterns: ['V'] },
  { id: 'wait', words: ['wait', 'z'], patterns: ['V'] },
  { id: 'again', words: ['again', 'g'], patterns: ['V'] },
  { id: 'verbose', words: ['verbose'], patterns: ['V'] },
  { id: 'brief', words: ['brief'], patterns: ['V'] },
  { id: 'help', words: ['help'], patterns: ['V'] },
];

/** Compass and vertical shortcuts (FR-2.3). A bare direction means `go <dir>`. */
export const DIRECTION_WORDS: Readonly<Record<string, Direction>> = {
  n: 'n',
  north: 'n',
  s: 's',
  south: 's',
  e: 'e',
  east: 'e',
  w: 'w',
  west: 'w',
  ne: 'ne',
  northeast: 'ne',
  nw: 'nw',
  northwest: 'nw',
  se: 'se',
  southeast: 'se',
  sw: 'sw',
  southwest: 'sw',
  u: 'up',
  up: 'up',
  upward: 'up',
  d: 'down',
  down: 'down',
  downward: 'down',
  in: 'in',
  inside: 'in',
  out: 'out',
  outside: 'out',
};

/**
 * Words that split `V N prep N`.
 *
 * `in`/`out` are also direction words. There is no conflict, because position
 * decides: a first token is a direction (`go in`), a later one is a preposition
 * (`put key in box`).
 */
export const PREPOSITIONS: ReadonlySet<string> = new Set([
  'with',
  'in',
  'into',
  'on',
  'onto',
  'at',
  'to',
  'from',
  'under',
  'using',
  'through',
  'over',
  'against',
]);

/**
 * Noise the tokenizer drops regardless of adventure. Modules add more.
 *
 * Prepositions are deliberately NOT here — they carry the VNPN grammar. `at`
 * and `to` are the awkward pair: they are prepositions, but `look at carving`
 * is a VN command wearing a preposition. `parse` handles that case explicitly
 * rather than making them noise, which would break `throw pebble at rat`.
 */
export const CORE_NOISE_WORDS: readonly string[] = ['the', 'a', 'an', 'my', 'some', 'please'];

/** The pronoun that resolves via `state.itRefers` (FR-2.5). */
export const PRONOUNS: ReadonlySet<string> = new Set(['it', 'them', 'that']);

export interface Vocabulary {
  /** word → verb id. Includes every synonym. */
  verbWords: Map<string, string>;
  /** verb id → its patterns. */
  verbPatterns: Map<string, VerbPattern[]>;
  /** Every known verb word, for suggestions and autocomplete. */
  allVerbWords: string[];
  noiseWords: Set<string>;
  /** magic word → event id (FR-1.9). Never surfaced in the UI. */
  magicWords: Map<string, string>;
}

/**
 * Build the runtime vocabulary: core verbs, then the module's, merged.
 *
 * Merging a module verb that shares a core id unions the synonyms and patterns
 * rather than replacing them — so test-cave's `use`/`oil` keeps `use` working.
 */
export function buildVocabulary(module: AdventureModule): Vocabulary {
  const verbWords = new Map<string, string>();
  const verbPatterns = new Map<string, VerbPattern[]>();

  const add = (verb: Verb): void => {
    const patterns = verbPatterns.get(verb.id) ?? [];
    for (const pattern of verb.patterns) {
      if (!patterns.includes(pattern)) patterns.push(pattern);
    }
    verbPatterns.set(verb.id, patterns);
    for (const word of verb.words) {
      verbWords.set(word.toLowerCase(), verb.id);
    }
  };

  for (const verb of CORE_VERBS) add(verb);
  for (const verb of module.vocabulary.verbs) add(verb);

  const magicWords = new Map<string, string>();
  for (const magic of module.vocabulary.magicWords) {
    magicWords.set(magic.word.toLowerCase(), magic.eventId);
  }

  return {
    verbWords,
    verbPatterns,
    allVerbWords: [...verbWords.keys()].sort(),
    noiseWords: new Set([...CORE_NOISE_WORDS, ...module.vocabulary.noiseWords.map((w) => w.toLowerCase())]),
    magicWords,
  };
}

export function isDirectionWord(word: string): boolean {
  return word in DIRECTION_WORDS;
}

export function directionOf(word: string): Direction | undefined {
  return DIRECTION_WORDS[word];
}
