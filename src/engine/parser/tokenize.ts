/**
 * Split raw input into lowercase word tokens (design plan §5.4).
 *
 * Punctuation becomes whitespace rather than being stripped: `take lamp.` and
 * `take lamp` must be the same command, but `well-lit` should not silently
 * become `welllit`. Apostrophes are kept inside words so `don't` survives as
 * one token — nothing in the vocabulary needs it yet, but splitting it into
 * `don` and `t` would produce a baffling nudge.
 */
export function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]+/g, ' ')
    .split(/[\s-]+/)
    .map((token) => token.replace(/^'+|'+$/g, ''))
    .filter((token) => token.length > 0);
}

/** Drop noise words — but never all of them: `take the` should not become `take`. */
export function dropNoise(tokens: string[], noise: ReadonlySet<string>): string[] {
  const kept = tokens.filter((token) => !noise.has(token));
  // If a player typed nothing but noise, keep the original so the nudge can
  // quote it back instead of complaining about an empty command.
  return kept.length > 0 ? kept : tokens;
}
