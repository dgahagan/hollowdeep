import type { AdventureModule, Direction, Scenery } from '../schema';
import type { GameState } from '../types';
import { canSee, currentLocation, getItemState, isCarrying, itemLocation } from '../state';
import { dropNoise, tokenize } from './tokenize';
import {
  buildVocabulary,
  directionOf,
  isDirectionWord,
  PREPOSITIONS,
  PRONOUNS,
  type Vocabulary,
} from './vocab';

// The parser (design plan §5.4). Tokenize → drop noise → resolve → grammar.
//
// The design plan flags scope resolution as the risk here, and it is the part
// worth reading: what a bare noun means depends on where the player is, what
// they carry, which containers are open, and whether they can see. Everything
// else is bookkeeping.

/** What a noun resolved to. Plain data — scenery has no id, so it is located. */
export type Target =
  | { kind: 'item'; id: string }
  | { kind: 'creature'; id: string }
  | { kind: 'scenery'; locationId: string; index: number };

export type Command =
  | { kind: 'go'; direction: Direction }
  | { kind: 'verb'; verb: string }
  | { kind: 'verb-noun'; verb: string; target: Target; noun: string }
  | {
      kind: 'verb-noun-prep-noun';
      verb: string;
      target: Target;
      noun: string;
      prep: string;
      secondTarget: Target;
      secondNoun: string;
    }
  | { kind: 'magic-word'; word: string; eventId: string }
  | { kind: 'again' };

export interface ParseFailure {
  kind: 'error';
  message: string;
  /** A concrete, valid thing to try instead — never jargon (FR-2.4). */
  suggestion?: string;
}

export interface Disambiguation {
  kind: 'disambiguation';
  question: string;
  /** Distinguishing phrases, e.g. ["tin cup", "silver chalice"]. */
  options: string[];
  originalCommand: string;
  /**
   * The ambiguous phrase itself, e.g. "cup".
   *
   * The pipeline needs it to rewrite the command once answered: "take cup" +
   * "tin cup" → "take tin cup". Without it there is no way to know WHICH word
   * of the original the answer replaces.
   */
  phrase: string;
}

export type ParseResult = Command | ParseFailure | Disambiguation;

// ─── scope ───────────────────────────────────────────────────────────────────

interface Candidate {
  target: Target;
  /** Each name as a token list, so multi-word names ("cave rat") work. */
  names: string[][];
  adjectives: string[];
  /** How to name it back to the player in a disambiguation question. */
  label: string;
}

function candidateFromScenery(locationId: string, index: number, scenery: Scenery): Candidate {
  const first = scenery.names[0] ?? 'it';
  return {
    target: { kind: 'scenery', locationId, index },
    names: scenery.names.map((n) => tokenize(n)),
    adjectives: [],
    label: first,
  };
}

/**
 * Everything the player can refer to right now (design plan §5.4).
 *
 * Scope is inventory + what is at this location + the contents of OPEN
 * containers in either. Two rules worth stating:
 *
 *   - **A closed container hides its contents.** The idol in the shut box is
 *     not referrable — that is the puzzle, and leaking it into scope would
 *     let `take idol` work through a locked lid.
 *   - **In the dark, only inventory is in scope.** You cannot examine what you
 *     cannot see. Your own pockets still work, which is what keeps `light
 *     lamp` possible in a dark room — the one command that has to work there.
 */
export function resolveScope(module: AdventureModule, state: GameState): Candidate[] {
  const candidates: Candidate[] = [];
  const visible = canSee(module, state);

  const addItem = (id: string): void => {
    const item = module.items.find((i) => i.id === id);
    if (item === undefined) return;
    candidates.push({
      target: { kind: 'item', id: item.id },
      names: item.names.map((n) => tokenize(n)),
      adjectives: (item.adjectives ?? []).map((a) => a.toLowerCase()),
      label: [item.adjectives?.[0], item.names[0]].filter(Boolean).join(' '),
    });
  };

  /** Contents of a container, if it is open. Recurses for nested containers. */
  const addContents = (containerId: string): void => {
    const container = module.items.find((i) => i.id === containerId);
    if (container?.container === undefined) return;
    if (getItemState(state, containerId).open !== true) return;
    for (const item of module.items) {
      if (itemLocation(state, item.id) === containerId) {
        addItem(item.id);
        addContents(item.id);
      }
    }
  };

  for (const item of module.items) {
    if (isCarrying(state, item.id)) {
      addItem(item.id);
      addContents(item.id);
    }
  }

  if (!visible) return candidates;

  for (const item of module.items) {
    if (itemLocation(state, item.id) === state.locationId) {
      addItem(item.id);
      addContents(item.id);
    }
  }

  for (const creature of module.creatures) {
    const cs = state.creatures[creature.id];
    if (cs === undefined || !cs.active || cs.locationId !== state.locationId) continue;
    candidates.push({
      target: { kind: 'creature', id: creature.id },
      names: creature.names.map((n) => tokenize(n)),
      adjectives: [],
      label: creature.names[0] ?? creature.id,
    });
  }

  const location = currentLocation(module, state);
  (location.scenery ?? []).forEach((scenery, index) => {
    candidates.push(candidateFromScenery(location.id, index, scenery));
  });

  return candidates;
}

/**
 * Does a candidate answer to this noun phrase?
 *
 * The rule: one of its names must be a **suffix** of the phrase, and every
 * token left over in front must be one of its adjectives.
 *
 *   "key"        → name ['key'] is a suffix, nothing left over        ✓
 *   "iron key"   → name ['key'] suffix, 'iron' is an adjective        ✓
 *   "tin cup"    → tin-cup: 'cup' suffix, 'tin' its adjective         ✓
 *                → chalice: 'cup' suffix, but 'tin' is not one of ITS
 *                  adjectives                                          ✗
 *   "cave rat"   → name ['cave','rat'] is a suffix, nothing left over ✓
 *
 * Suffix rather than equality is what makes adjectives narrow (FR-2.4) instead
 * of merely decorate: "tin cup" resolves to exactly one thing while "cup"
 * matches both and asks.
 */
function matchesPhrase(candidate: Candidate, phrase: string[]): boolean {
  for (const name of candidate.names) {
    if (name.length === 0 || name.length > phrase.length) continue;
    const start = phrase.length - name.length;
    const isSuffix = name.every((token, i) => phrase[start + i] === token);
    if (!isSuffix) continue;
    const modifiers = phrase.slice(0, start);
    if (modifiers.every((token) => candidate.adjectives.includes(token))) return true;
  }
  return false;
}

function sameTarget(a: Target, b: Target): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'scenery' && b.kind === 'scenery') {
    return a.locationId === b.locationId && a.index === b.index;
  }
  if ((a.kind === 'item' || a.kind === 'creature') && (b.kind === 'item' || b.kind === 'creature')) {
    return a.id === b.id;
  }
  return false;
}

type Resolution =
  | { kind: 'ok'; target: Target }
  | { kind: 'none' }
  | { kind: 'ambiguous'; options: string[] };

function resolveNoun(
  module: AdventureModule,
  state: GameState,
  phrase: string[],
  scope: Candidate[],
): Resolution {
  if (phrase.length === 0) return { kind: 'none' };

  // `it` (FR-2.5). Only meaningful if the referent is still in scope — a
  // pronoun pointing at something you dropped two rooms ago is worse than
  // admitting you don't know what it means.
  if (phrase.length === 1 && phrase[0] !== undefined && PRONOUNS.has(phrase[0])) {
    const referent = state.itRefers;
    if (referent === undefined) return { kind: 'none' };
    const inScope = scope.some((c) => c.target.kind === 'item' && c.target.id === referent);
    return inScope ? { kind: 'ok', target: { kind: 'item', id: referent } } : { kind: 'none' };
  }

  const matches = scope.filter((c) => matchesPhrase(c, phrase));
  if (matches.length === 0) return { kind: 'none' };

  // Deduplicate: an item both carried and matched twice is still one thing.
  const unique: Candidate[] = [];
  for (const match of matches) {
    if (!unique.some((u) => sameTarget(u.target, match.target))) unique.push(match);
  }

  const first = unique[0];
  if (first === undefined) return { kind: 'none' };
  if (unique.length === 1) return { kind: 'ok', target: first.target };

  return { kind: 'ambiguous', options: unique.map((c) => c.label) };
}

// ─── suggestions for failures (FR-2.4) ───────────────────────────────────────

/**
 * Damerau-Levenshtein (optimal string alignment) — only used to spot a
 * near-miss typo.
 *
 * Damerau rather than plain Levenshtein because it counts a TRANSPOSITION as
 * one edit, and transposition is the typo people actually make: `tkae` is one
 * slip from `take` but two Levenshtein edits, which puts it outside any
 * threshold tight enough to be useful.
 */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        (d[i - 1]?.[j] ?? 0) + 1, // deletion
        (d[i]?.[j - 1] ?? 0) + 1, // insertion
        (d[i - 1]?.[j - 1] ?? 0) + cost, // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, (d[i - 2]?.[j - 2] ?? 0) + 1); // transposition
      }
      const row = d[i];
      if (row !== undefined) row[j] = best;
    }
  }

  return d[a.length]?.[b.length] ?? Math.max(a.length, b.length);
}

function nearestVerb(word: string, vocab: Vocabulary): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of vocab.allVerbWords) {
    // Single letters are shortcuts, not typo targets: everything is within 1
    // of `x`, and "did you mean x?" is a useless thing to say.
    if (candidate.length < 3) continue;
    const distance = editDistance(word, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance <= (word.length <= 4 ? 1 : 2) ? best : undefined;
}

/**
 * A concrete thing the player could actually do right now.
 *
 * FR-2.4's bar is "a helpful nudge, never a stack of jargon" — so this points
 * at something real in the room rather than reciting a verb list.
 */
function nearbyAction(module: AdventureModule, state: GameState): string | undefined {
  if (!canSee(module, state)) return undefined;

  const scope = resolveScope(module, state);
  const thing = scope.find((c) => c.target.kind === 'item' || c.target.kind === 'creature');
  if (thing !== undefined) return `examine ${thing.label}`;

  const location = currentLocation(module, state);
  for (const dir of Object.keys(location.exits)) {
    const exit = location.exits[dir as Direction];
    if (exit !== undefined && !exit.hidden) return dir;
  }
  return undefined;
}

function unknownWord(
  module: AdventureModule,
  state: GameState,
  word: string,
  vocab: Vocabulary,
): ParseFailure {
  const near = nearestVerb(word, vocab);
  if (near !== undefined) {
    return { kind: 'error', message: `You can't "${word}".`, suggestion: `Did you mean \`${near}\`?` };
  }
  const action = nearbyAction(module, state);
  const failure: ParseFailure = { kind: 'error', message: `"${word}" isn't a word the cave knows.` };
  if (action !== undefined) failure.suggestion = `Try \`${action}\`.`;
  return failure;
}

// ─── parse ───────────────────────────────────────────────────────────────────

/**
 * Parse raw input against the module and current state (design plan §5.4).
 *
 * Pure: it reads state for scope but never writes. Resolution failures are
 * `ParseFailure`; genuine ambiguity is a `Disambiguation` for the caller to
 * hold in `state.pending`.
 */
export function parse(module: AdventureModule, state: GameState, input: string): ParseResult {
  const vocab = buildVocabulary(module);
  const raw = tokenize(input);

  if (raw.length === 0) {
    return { kind: 'error', message: 'Say something.' };
  }

  const tokens = dropNoise(raw, vocab.noiseWords);
  const head = tokens[0];
  if (head === undefined) return { kind: 'error', message: 'Say something.' };

  // A bare direction is `go <dir>` (FR-2.3). Checked first, so `in`/`out` are
  // directions at the head of a command and prepositions anywhere else.
  if (tokens.length === 1 && isDirectionWord(head)) {
    const direction = directionOf(head);
    if (direction !== undefined) return { kind: 'go', direction };
  }

  const verbId = vocab.verbWords.get(head);

  // Magic words beat the unknown-word nudge (FR-1.9) — but not a real verb,
  // so an adventure cannot accidentally shadow `look` with a magic word.
  if (verbId === undefined) {
    const eventId = vocab.magicWords.get(head);
    if (eventId !== undefined) return { kind: 'magic-word', word: head, eventId };
    return unknownWord(module, state, head, vocab);
  }

  if (verbId === 'again') return { kind: 'again' };

  const rest = tokens.slice(1);
  const patterns = vocab.verbPatterns.get(verbId) ?? [];
  const scope = resolveScope(module, state);

  // V
  if (rest.length === 0) {
    if (patterns.includes('V')) return { kind: 'verb', verb: verbId };
    return {
      kind: 'error',
      message: `${head} what?`,
      ...(nearbyAction(module, state) !== undefined
        ? { suggestion: `Try \`${head} ${nearbyAction(module, state) ?? ''}\`.`.replace('examine ', '') }
        : {}),
    };
  }

  // `go north` → the same command as a bare `north`.
  if (verbId === 'go') {
    const word = rest[rest.length - 1];
    const direction = word !== undefined ? directionOf(word) : undefined;
    if (direction !== undefined) return { kind: 'go', direction };
    return {
      kind: 'error',
      message: `"${rest.join(' ')}" isn't a direction.`,
      suggestion: 'Try `n`, `s`, `e`, `w`, `up`, `down`, `in`, or `out`.',
    };
  }

  const prepIndex = rest.findIndex((token) => PREPOSITIONS.has(token));

  // `look at carving` / `read from book` — a preposition sitting straight after
  // the verb is a VN command wearing one. Dropping it here rather than making
  // `at` a noise word keeps `throw pebble at rat` parsing as VNPN.
  if (prepIndex === 0) {
    return parseVerbNoun(module, state, verbId, head, rest.slice(1), scope, input, patterns);
  }

  if (prepIndex > 0) {
    const prep = rest[prepIndex];
    const firstPhrase = rest.slice(0, prepIndex);
    const secondPhrase = rest.slice(prepIndex + 1);

    if (prep === undefined || secondPhrase.length === 0) {
      return { kind: 'error', message: `${head} ${firstPhrase.join(' ')} ${prep ?? ''} what?`.trim() };
    }

    if (!patterns.includes('VNPN')) {
      // The verb exists but not in this shape — say so plainly rather than
      // pretending the noun is at fault.
      return {
        kind: 'error',
        message: `You can't ${head} something ${prep} something else.`,
        suggestion: `Try \`${head} ${firstPhrase.join(' ')}\`.`,
      };
    }

    const first = resolveNoun(module, state, firstPhrase, scope);
    if (first.kind === 'none') return cannotSee(module, state, firstPhrase);
    if (first.kind === 'ambiguous') {
      return disambiguate(firstPhrase, first.options, input);
    }

    const second = resolveNoun(module, state, secondPhrase, scope);
    if (second.kind === 'none') return cannotSee(module, state, secondPhrase);
    if (second.kind === 'ambiguous') {
      return disambiguate(secondPhrase, second.options, input);
    }

    return {
      kind: 'verb-noun-prep-noun',
      verb: verbId,
      target: first.target,
      noun: firstPhrase.join(' '),
      prep,
      secondTarget: second.target,
      secondNoun: secondPhrase.join(' '),
    };
  }

  return parseVerbNoun(module, state, verbId, head, rest, scope, input, patterns);
}

function parseVerbNoun(
  module: AdventureModule,
  state: GameState,
  verbId: string,
  head: string,
  phrase: string[],
  scope: Candidate[],
  input: string,
  patterns: string[],
): ParseResult {
  if (phrase.length === 0) return { kind: 'error', message: `${head} what?` };

  if (!patterns.includes('VN')) {
    return { kind: 'error', message: `You can't ${head} something.`, suggestion: `Try \`${head}\`.` };
  }

  const resolved = resolveNoun(module, state, phrase, scope);
  if (resolved.kind === 'none') return cannotSee(module, state, phrase);
  if (resolved.kind === 'ambiguous') return disambiguate(phrase, resolved.options, input);

  return { kind: 'verb-noun', verb: verbId, target: resolved.target, noun: phrase.join(' ') };
}

function disambiguate(phrase: string[], options: string[], input: string): Disambiguation {
  const list =
    options.length === 2
      ? `${options[0] ?? ''} or ${options[1] ?? ''}`
      : `${options.slice(0, -1).join(', ')}, or ${options[options.length - 1] ?? ''}`;
  return {
    kind: 'disambiguation',
    question: `Which ${phrase.join(' ')} do you mean, the ${list}?`,
    options,
    originalCommand: input,
    phrase: phrase.join(' '),
  };
}

function cannotSee(module: AdventureModule, state: GameState, phrase: string[]): ParseFailure {
  const noun = phrase.join(' ');
  if (!canSee(module, state)) {
    return {
      kind: 'error',
      message: `It is too dark to see any ${noun}.`,
      suggestion: 'Try `light lamp`.',
    };
  }
  const failure: ParseFailure = { kind: 'error', message: `You see no ${noun} here.` };
  const action = nearbyAction(module, state);
  if (action !== undefined) failure.suggestion = `Try \`${action}\`.`;
  return failure;
}

/**
 * A state-free syntax check for `walkthrough.json` (resolves T5's TODO(T13)).
 *
 * Deliberately only checks the HEAD of the command — that the first word is a
 * verb, direction, magic word, or `again`. Noun resolution is state-dependent
 * (`take key` is unparseable until the key exists), so a validator with no game
 * state cannot judge it without being wrong about correct content. Semantic
 * failures are T23's to catch, by actually playing the walkthrough.
 *
 * Returns an error message, or undefined if the command is plausible.
 */
export function commandSyntaxError(module: AdventureModule, command: string): string | undefined {
  const vocab = buildVocabulary(module);
  const raw = tokenize(command);
  if (raw.length === 0) return 'command is empty';

  const tokens = dropNoise(raw, vocab.noiseWords);
  const head = tokens[0];
  if (head === undefined) return 'command is empty';

  if (isDirectionWord(head)) return undefined;
  if (vocab.verbWords.has(head)) return undefined;
  if (vocab.magicWords.has(head)) return undefined;

  return `"${head}" is not a known verb, direction, or magic word`;
}
