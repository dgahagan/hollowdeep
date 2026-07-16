import { describe, expect, it } from 'vitest';
import { nextInt, nextRandom, pick, rollChance } from '../../src/engine/rng';

// The RNG's entire job is reproducibility, so these tests pin the actual
// sequence rather than merely checking that numbers come out in range.

describe('nextRandom', () => {
  it('reproduces a known sequence for a known seed', () => {
    // A golden sequence. If this changes, every seeded test in the suite
    // changes with it — which is the point of pinning it here, where the
    // breakage is obvious, rather than discovering it as a flaky creature
    // test three files away.
    let rng = 12345;
    const values: number[] = [];
    for (let i = 0; i < 5; i++) {
      const [value, next] = nextRandom(rng);
      values.push(Number(value.toFixed(10)));
      rng = next;
    }
    expect(values).toEqual([0.9797282678, 0.3067522645, 0.4842054215, 0.8179344125, 0.5094283693]);
  });

  it('is pure: the same input always gives the same output', () => {
    expect(nextRandom(999)).toEqual(nextRandom(999));
  });

  it('advances the state', () => {
    const [, next] = nextRandom(1);
    expect(next).not.toBe(1);
  });

  it('returns values in [0, 1)', () => {
    let rng = 7;
    for (let i = 0; i < 500; i++) {
      const [value, next] = nextRandom(rng);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      rng = next;
    }
  });

  it('keeps its state an int32, so it survives a JSON round-trip', () => {
    let rng = 0x7fffffff;
    for (let i = 0; i < 100; i++) {
      const [, next] = nextRandom(rng);
      expect(Number.isInteger(next)).toBe(true);
      expect(next).toBe(next | 0);
      // The property that actually matters: serialize, restore, same draw.
      expect(nextRandom(JSON.parse(JSON.stringify(next)) as number)).toEqual(nextRandom(next));
      rng = next;
    }
  });

  it('produces different sequences for different seeds', () => {
    expect(nextRandom(1)[0]).not.toBe(nextRandom(2)[0]);
  });
});

describe('nextInt', () => {
  it('stays in range', () => {
    let rng = 42;
    for (let i = 0; i < 200; i++) {
      const [value, next] = nextInt(rng, 5);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(5);
      expect(Number.isInteger(value)).toBe(true);
      rng = next;
    }
  });

  it('does not draw for a non-positive bound', () => {
    expect(nextInt(42, 0)).toEqual([0, 42]);
    expect(nextInt(42, -1)).toEqual([0, 42]);
  });

  it('eventually covers the whole range', () => {
    let rng = 3;
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const [value, next] = nextInt(rng, 4);
      seen.add(value);
      rng = next;
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe('rollChance', () => {
  // Certainties short-circuit without drawing. This is the contract that keeps
  // content edits from shifting later draws in the same turn.
  it('does not consume RNG for chance 0 or 1', () => {
    expect(rollChance(42, 0)).toEqual([false, 42]);
    expect(rollChance(42, 1)).toEqual([true, 42]);
  });

  it('consumes RNG for a real probability', () => {
    const [, next] = rollChance(42, 0.5);
    expect(next).not.toBe(42);
  });

  it('is reproducible for a seed', () => {
    expect(rollChance(2024, 0.3)).toEqual(rollChance(2024, 0.3));
  });

  it('approximates its probability over many draws', () => {
    let rng = 11;
    let hits = 0;
    const trials = 4000;
    for (let i = 0; i < trials; i++) {
      const [hit, next] = rollChance(rng, 0.25);
      if (hit) hits++;
      rng = next;
    }
    // Wide bounds on purpose: this checks the roll is not obviously broken,
    // not that mulberry32 passes a statistics course.
    expect(hits / trials).toBeGreaterThan(0.2);
    expect(hits / trials).toBeLessThan(0.3);
  });
});

describe('pick', () => {
  it('returns undefined for an empty list without drawing', () => {
    expect(pick(42, [])).toEqual([undefined, 42]);
  });

  it('picks an element and advances the state', () => {
    const [value, next] = pick(42, ['a', 'b', 'c']);
    expect(['a', 'b', 'c']).toContain(value);
    expect(next).not.toBe(42);
  });

  it('is reproducible for a seed', () => {
    expect(pick(7, ['a', 'b', 'c'])).toEqual(pick(7, ['a', 'b', 'c']));
  });
});
