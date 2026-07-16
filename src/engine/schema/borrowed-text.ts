// A backstop against shipping someone else's prose (PROJECT-BRIEF §9, the
// project's FIRST locked decision):
//
//   "Original adventure, not a port — no text or map from the 1977 game
//    (homages like a wry `xyzzy` response are fine)."
//
// WHY THIS EXISTS. test-cave shipped with five near-verbatim 1977 lines —
// "You are at the end of a road before a small brick building.", "You are in a
// maze of twisty little passages, all alike." — and nothing caught them. Not
// the schema, not 40 consistency rules, not 681 tests, through the authoring
// task, a walkthrough rewrite, and a docs pass with those files read many
// times. Prose has no type. They were finally spotted because a generated
// painting showed a *tin* shed beside a caption claiming a *brick* building:
// the borrowed sentence described somebody else's building and had never
// matched the cave it was dropped into.
//
// WHAT THIS IS NOT. It cannot prove originality — that needs a person who has
// read the source. It catches the specific failure that actually happened:
// famous lines are famous precisely because they are memorable, so they are
// the ones that surface unbidden while writing in the genre, and they are a
// short finite list. A backstop for the likely case, not a proof.
//
// CURATION RULE, and the reason the list is short: only phrases that are
// **distinctive enough to be quotation**. "It is pitch dark" is NOT here and
// must not be — it is the plain English for the situation, and test-cave's own
// "It is pitch dark. You are likely to put a foot somewhere you cannot take it
// back from." is original where it counts. A list that flags ordinary English
// gets suppressed, and a suppressed check is worse than none. If a phrase is
// something anyone would independently write, leave it out.

/** A borrowed phrase and where it came from, for an error message that teaches. */
export interface BorrowedPhrase {
  /** Lowercase; matched against prose with whitespace collapsed. */
  phrase: string;
  source: string;
}

export const BORROWED_PHRASES: readonly BorrowedPhrase[] = [
  // Colossal Cave Adventure (Crowther & Woods, 1977) — the game this one is in
  // the spirit of, which is exactly why its lines are the ones at risk.
  { phrase: 'end of a road before a small brick building', source: 'Colossal Cave Adventure (1977)' },
  { phrase: 'maze of twisty little passages, all alike', source: 'Colossal Cave Adventure (1977)' },
  { phrase: 'maze of twisting little passages, all different', source: 'Colossal Cave Adventure (1977)' },
  { phrase: 'little maze of twisty passages', source: 'Colossal Cave Adventure (1977)' },
  { phrase: 'you are likely to fall into a pit', source: 'Colossal Cave Adventure (1977)' },
  { phrase: 'if you proceed you will likely fall', source: 'Colossal Cave Adventure (1977)' },
  { phrase: 'a hollow voice says', source: 'Colossal Cave Adventure (1977)' },
  { phrase: 'welcome to adventure', source: 'Colossal Cave Adventure (1977)' },
  { phrase: 'somewhere nearby is colossal cave', source: 'Colossal Cave Adventure (1977)' },
  { phrase: 'there is a threatening little dwarf', source: 'Colossal Cave Adventure (1977)' },
  { phrase: 'you are in a splendid chamber thirty feet high', source: 'Colossal Cave Adventure (1977)' },
  { phrase: 'the dwarf dodges out of the way', source: 'Colossal Cave Adventure (1977)' },

  // Zork (Infocom, 1977–81). A different game, borrowed just as easily, and
  // just as much someone else's.
  { phrase: 'you are likely to be eaten by a grue', source: 'Zork (Infocom)' },
  { phrase: 'west of house', source: 'Zork (Infocom)' },
  { phrase: 'this is an open field west of a white house', source: 'Zork (Infocom)' },
  { phrase: 'a lurking grue', source: 'Zork (Infocom)' },
];

/**
 * Find borrowed phrases in a piece of prose.
 *
 * Whitespace is collapsed so a line broken across a JSON string still matches;
 * comparison is lowercase so capitalisation cannot hide a quotation.
 *
 * Deliberately substring, not fuzzy. A near-miss ("twisty little passages, all
 * the same") slips through, and that is the right trade: a fuzzy matcher on
 * genre prose fires on innocent sentences, and a check that cries wolf gets
 * turned off. This is a backstop, and it should only ever speak when it is
 * certainly right.
 */
export function findBorrowedPhrases(text: string): BorrowedPhrase[] {
  const haystack = text.toLowerCase().replace(/\s+/g, ' ');
  return BORROWED_PHRASES.filter((entry) => haystack.includes(entry.phrase));
}
