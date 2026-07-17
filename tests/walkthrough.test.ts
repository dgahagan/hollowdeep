import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAdventure } from '../src/loader';
import type { AdventureModule } from '../src/engine/schema';
import type { GameState, OutputEvent } from '../src/engine/types';
import { createGame } from '../src/engine/state';
import { step } from '../src/engine/engine';

// ─────────────────────────────────────────────────────────────────────────────
// The scripted walkthroughs (design plan §9, exit criterion #2, NFR-4; T23,
// generalized per-adventure by hollowdeep T9).
//
// This is the only suite that runs the WHOLE engine against real content, end
// to end, for EVERY adventure in the repo. Every other test checks one system
// against a state it built itself; this one starts each module at turn 0 and
// plays its game to victory.
//
// **Each walkthrough must reach its perfect score at EVERY seed, not just a
// lucky one.** That is only achievable on purpose: the thief consumes no RNG
// and the stalkers are wardable, so nothing on a winning path is left to
// chance. A seed that fails is a real bug — in content or engine — and never
// a reason to loosen an assertion. If this test ever starts flaking, the
// flake IS the finding.
// ─────────────────────────────────────────────────────────────────────────────

interface AdventureCase {
  dir: string;
  /** Distinct, arbitrary, and pinned. Nothing about the run may depend on which. */
  seeds: number[];
  /**
   * Does the winning path legitimately consume RNG that varies the PROSE
   * (never the outcome)? test-cave's `maze-mutter` is a `chance: 0.3` ambient
   * line, so its transcripts differ per seed. Hollowdeep's walkthrough
   * consumes NO RNG at all — creature movement is deterministic, the stalker
   * never rolls because the canary wards it, darkness never rolls because
   * the lamp is lit, and no content uses `chance` (design plan §12.9.1) — so
   * its transcripts are byte-identical across seeds, verified empirically.
   */
  ambientVariance: boolean;
}

const ADVENTURES: AdventureCase[] = [
  { dir: 'test-cave', seeds: [12345, 0, 1, 99, 20260716], ambientVariance: true },
  { dir: 'hollowdeep', seeds: [12345, 0, 1, 99, 20260716], ambientVariance: false },
];

function transcript(events: OutputEvent[]): string {
  return events.map((e) => e.text).join('\n');
}

interface Run {
  state: GameState;
  /** Every turn's output, for reporting where a run went wrong. */
  log: string[];
}

describe.each(ADVENTURES)('walkthrough: $dir', ({ dir, seeds, ambientVariance }) => {
  let module_: AdventureModule;

  beforeAll(async () => {
    module_ = await loadAdventure(
      (p) => readFile(p, 'utf8'),
      path.resolve(import.meta.dirname, '../adventures', dir),
      (d) => readdir(d),
    );
  });

  /**
   * Play the whole walkthrough at one seed.
   *
   * Per-step `expect` substrings are asserted here rather than collected, so a
   * failure names the step that broke instead of only the ending. `expect` may
   * be a list, and a list requires ALL of them (schema/walkthrough.ts) — an
   * "any-of" reading would quietly be a weaker check than it looks.
   */
  function play(seed: number): Run {
    let state = createGame(module_, seed);
    const log: string[] = [];

    module_.walkthrough.steps.forEach((walkStep, index) => {
      const result = step(module_, state, walkStep.cmd);
      state = result.state;
      const text = transcript(result.events);
      log.push(`[seed ${seed}] ${index}: ${walkStep.cmd}\n${text}`);

      const expected = walkStep.expect;
      if (expected === undefined) return;
      for (const needle of Array.isArray(expected) ? expected : [expected]) {
        expect(text, `seed ${seed}, step ${index} \`${walkStep.cmd}\` — expected "${needle}" in:\n${text}\n`).toContain(
          needle,
        );
      }
    });

    return { state, log };
  }

  describe('the walkthrough asset itself', () => {
    // If these drift, every assertion below silently weakens: a walkthrough
    // with no expectations passes against an engine that prints nothing.
    it('declares a score, a rank, achievements, and real per-step expectations', () => {
      expect(module_.walkthrough.expectedScore).toBe(module_.manifest.maxScore);
      expect(module_.walkthrough.expectedRank).toBeTruthy();
      expect(module_.walkthrough.expectedAchievements.length).toBeGreaterThan(0);

      const withExpectations = module_.walkthrough.steps.filter((s) => s.expect !== undefined);
      expect(withExpectations.length).toBeGreaterThan(10);
    });
  });

  describe('completes to a perfect score (exit criterion #2)', () => {
    it('reaches the max score with the expected rank and achievements at the canonical seed', () => {
      const { state } = play(seeds[0] ?? 12345);

      expect(state.score).toBe(module_.walkthrough.expectedScore);
      expect(state.score).toBe(module_.manifest.maxScore);
      expect(state.ended?.victory).toBe(true);
      expect(state.ended?.rank).toBe(module_.walkthrough.expectedRank);
      expect([...state.achievements].sort()).toEqual([...module_.walkthrough.expectedAchievements].sort());
    });

    it('never dies and never takes a hint — those achievements are earned, not assumed', () => {
      const { state } = play(seeds[0] ?? 12345);
      expect(state.deaths).toBe(0);
      expect(state.hintsUsed).toBe(0);
    });

    it('scores every treasure both carried and deposited', () => {
      // Guards the arithmetic rather than just the total: the max could also
      // be reached by awarding one treasure twice.
      const { state } = play(seeds[0] ?? 12345);
      const treasures = module_.items.filter((i) => i.treasure !== undefined).map((i) => i.id);
      expect(treasures.length).toBeGreaterThan(1);
      expect([...state.scoredCarry].sort()).toEqual([...treasures].sort());
      expect([...state.scoredDeposit].sort()).toEqual([...treasures].sort());
    });
  });

  describe('completability does not depend on luck (NFR-4)', () => {
    // The property the whole determinism design exists to buy. If one of
    // these fails, something on the winning path is rolling a die that it
    // must not.
    it.each(seeds)('reaches a perfect score at seed %i', (seed) => {
      const { state } = play(seed);
      expect(state.score).toBe(module_.manifest.maxScore);
      expect(state.ended?.victory).toBe(true);
      expect(state.ended?.rank).toBe(module_.walkthrough.expectedRank);
      expect(state.deaths).toBe(0);
      expect(state.hintsUsed).toBe(0);
      expect([...state.achievements].sort()).toEqual([...module_.walkthrough.expectedAchievements].sort());
    });

    it('produces a materially identical outcome at every seed', () => {
      // Stronger than "all seeds win", and the real regression guard: if the
      // thief ever draws (§8 forbids it), its timing or destination shifts
      // with the seed and the treasure ends up somewhere else — caught HERE,
      // at the change that caused it, instead of as a rare flake months
      // later.
      //
      // The comparison is of OUTCOME, not transcript: ambient prose (see
      // `ambientVariance`) legitimately differs between seeds. What NFR-4
      // promises is that COMPLETABILITY does not depend on luck — never that
      // the cave is silent about it.
      const outcome = (seed: number) => {
        const { state } = play(seed);
        return {
          turn: state.turn,
          locationId: state.locationId,
          score: state.score,
          deaths: state.deaths,
          ended: state.ended,
          achievements: [...state.achievements].sort(),
          scoredCarry: [...state.scoredCarry].sort(),
          scoredDeposit: [...state.scoredDeposit].sort(),
          awardedMilestones: [...state.awardedMilestones].sort(),
          itemLocations: state.itemLocations,
        };
      };

      const first = outcome(seeds[0] ?? 0);
      for (const seed of seeds.slice(1)) {
        expect(outcome(seed), `seed ${seed} ended differently from seed ${seeds[0]}`).toEqual(first);
      }
    });

    it('the ambient flavour really is seed-dependent, or the test above proves less than it looks', () => {
      // Pins the reason the assertion above compares outcome rather than
      // transcript. If the ambient RNG were ever made deterministic, this
      // fails and whoever is here can go back to the stricter, simpler check.
      if (!ambientVariance) return;
      const transcripts = new Set(
        seeds.map((seed) => play(seed).log.map((l) => l.replace(`[seed ${seed}]`, '')).join('\n')),
      );
      expect(transcripts.size).toBeGreaterThan(1);
    });
  });

  describe('the run is deterministic', () => {
    it('the same seed twice gives the identical final state', () => {
      const seed = seeds[0] ?? 12345;
      expect(play(seed).state).toEqual(play(seed).state);
    });
  });
});
