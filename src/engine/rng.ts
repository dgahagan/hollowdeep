// Seeded RNG (design plan §5, §6.5). mulberry32: small, fast, and — the only
// property that actually matters here — exactly reproducible.
//
// TWO RULES, both structural rather than conventional:
//
// 1. **The state lives in `GameState.rng`, not in a closure.** A generator
//    holding its own state would be hidden state the save system cannot see:
//    save, reload, and the sequence diverges. Keeping it in the state object
//    means a save round-trip restores the RNG exactly, so a reloaded game is
//    the same game.
//
// 2. **Every draw returns `[value, nextState]`.** Nothing here mutates. That
//    is why `evalCondition` (T12) returns new state — a `chance` condition is
//    a draw, and a draw is a state change. It is easy to read that as
//    ceremony; it is what makes "same seed ⇒ same game" true rather than
//    aspirational.
//
// The state is an int32, so it survives JSON round-trip as a plain number.
//
// NOTE FOR SEEDED TESTS: the ORDER of draws within a turn is a public
// contract (design plan §10) — tests force outcomes by choosing seeds, so
// reordering a draw silently breaks seeded tests in unrelated files. T19
// documents the order for the creature tick.

/**
 * One mulberry32 draw. Returns a float in [0, 1) and the next state.
 *
 * The int32 coercions (`| 0`, `>>> 0`) are load-bearing, not decoration:
 * they keep the arithmetic in exactly 32 bits so the sequence is identical on
 * every platform and after every save round-trip.
 */
export function nextRandom(rng: number): [value: number, next: number] {
  const a = (rng + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, a];
}

/** An integer in [0, maxExclusive). Returns 0 for a non-positive bound. */
export function nextInt(rng: number, maxExclusive: number): [value: number, next: number] {
  if (maxExclusive <= 0) return [0, rng];
  const [value, next] = nextRandom(rng);
  return [Math.floor(value * maxExclusive), next];
}

/**
 * Roll a probability in [0, 1].
 *
 * `chance: 0` and `chance: 1` short-circuit **without drawing**. This is
 * deliberate and worth knowing: a certainty is not a roll, and consuming RNG
 * for one would shift every later draw in the turn, which is precisely the
 * kind of thing that turns a seeded test flaky when content changes.
 */
export function rollChance(rng: number, probability: number): [hit: boolean, next: number] {
  if (probability <= 0) return [false, rng];
  if (probability >= 1) return [true, rng];
  const [value, next] = nextRandom(rng);
  return [value < probability, next];
}

/**
 * Pick one element uniformly. Returns `undefined` for an empty list rather
 * than throwing — callers under `noUncheckedIndexedAccess` have to narrow
 * anyway, so this makes the empty case explicit instead of a surprise.
 */
export function pick<T>(rng: number, items: readonly T[]): [value: T | undefined, next: number] {
  if (items.length === 0) return [undefined, rng];
  const [index, next] = nextInt(rng, items.length);
  return [items[index], next];
}
