import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAdventure } from '../src/loader';
import type { AdventureModule } from '../src/engine/schema';
import type { GameState, OutputEvent } from '../src/engine/types';
import { createGame } from '../src/engine/state';
import { step } from '../src/engine/engine';

// ─────────────────────────────────────────────────────────────────────────────
// The scripted walkthrough (design plan §9, exit criterion #2, NFR-4; T23).
//
// This is the first and only test that runs the WHOLE engine against real
// content, end to end. Every other test in the suite checks one system against
// a state it built itself; this one starts at turn 0 and plays the game.
//
// **It must reach 100/100 at EVERY seed, not just a lucky one.** That is only
// achievable on purpose: the thief consumes no RNG (§8, verified in T19 across
// six seeds) and the stalker is wardable with a lit lamp, so nothing on the
// winning path is left to chance. A seed that fails is therefore a real bug —
// in content or engine — and never a reason to loosen an assertion. If this
// test ever starts flaking, the flake IS the finding.
// ─────────────────────────────────────────────────────────────────────────────

const MODULE_DIR = path.resolve(import.meta.dirname, '../adventures/test-cave');

/** Distinct, arbitrary, and pinned. Nothing about the run may depend on which. */
const SEEDS = [12345, 0, 1, 99, 20260716];

let module_: AdventureModule;

beforeAll(async () => {
  module_ = await loadAdventure(
    (p) => readFile(p, 'utf8'),
    MODULE_DIR,
    (dir) => readdir(dir),
  );
});

function transcript(events: OutputEvent[]): string {
  return events.map((e) => e.text).join('\n');
}

interface Run {
  state: GameState;
  /** Every turn's output, for reporting where a run went wrong. */
  log: string[];
}

/**
 * Play the whole walkthrough at one seed.
 *
 * Per-step `expect` substrings are asserted here rather than collected, so a
 * failure names the step that broke instead of only the ending. `expect` may be
 * a list, and a list requires ALL of them (schema/walkthrough.ts) — an
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
  // If these drift, every assertion below silently weakens: a walkthrough with
  // no expectations passes against an engine that prints nothing at all.
  it('declares a score, a rank, achievements, and real per-step expectations', () => {
    expect(module_.walkthrough.expectedScore).toBe(module_.manifest.maxScore);
    expect(module_.walkthrough.expectedRank).toBeTruthy();
    expect(module_.walkthrough.expectedAchievements.length).toBeGreaterThan(0);

    const withExpectations = module_.walkthrough.steps.filter((s) => s.expect !== undefined);
    expect(withExpectations.length).toBeGreaterThan(10);
  });
});

describe('test-cave completes to a perfect score (exit criterion #2)', () => {
  it('reaches 100/100 with the expected rank and achievements at the canonical seed', () => {
    const { state } = play(12345);

    expect(state.score).toBe(module_.walkthrough.expectedScore);
    expect(state.score).toBe(module_.manifest.maxScore);
    expect(state.ended?.victory).toBe(true);
    expect(state.ended?.rank).toBe(module_.walkthrough.expectedRank);
    expect([...state.achievements].sort()).toEqual([...module_.walkthrough.expectedAchievements].sort());
  });

  it('never dies along the way — the no-deaths achievement is earned, not assumed', () => {
    expect(play(12345).state.deaths).toBe(0);
  });

  it('scores every treasure both carried and deposited', () => {
    // Guards the arithmetic rather than just the total: 100 could also be
    // reached by awarding one treasure twice.
    const { state } = play(12345);
    const treasures = module_.items.filter((i) => i.treasure !== undefined).map((i) => i.id);
    expect(treasures.length).toBeGreaterThan(1);
    expect([...state.scoredCarry].sort()).toEqual([...treasures].sort());
    expect([...state.scoredDeposit].sort()).toEqual([...treasures].sort());
  });
});

describe('completability does not depend on luck (NFR-4)', () => {
  // The property the whole determinism design exists to buy. If one of these
  // fails, something on the winning path is rolling a die that it must not.
  it.each(SEEDS)('reaches a perfect score at seed %i', (seed) => {
    const { state } = play(seed);
    expect(state.score).toBe(module_.manifest.maxScore);
    expect(state.ended?.victory).toBe(true);
    expect(state.ended?.rank).toBe(module_.walkthrough.expectedRank);
    expect(state.deaths).toBe(0);
    expect([...state.achievements].sort()).toEqual([...module_.walkthrough.expectedAchievements].sort());
  });

  it('produces a materially identical outcome at every seed', () => {
    // Stronger than "all seeds win", and the real regression guard: if the
    // thief ever draws (§8 forbids it), its timing or destination shifts with
    // the seed and the treasure ends up somewhere else — caught HERE, at the
    // change that caused it, instead of as a rare flake in someone's CI months
    // later.
    //
    // The comparison is of OUTCOME, not transcript. The walkthrough path really
    // does consume RNG: `maze-mutter` is a `chance: 0.3` ambient line on
    // entering the maze, so the prose legitimately differs between seeds. What
    // NFR-4 promises is that COMPLETABILITY does not depend on luck — never that
    // the cave is silent about it. Asserting identical transcripts would be
    // asserting that content may not have atmosphere.
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

    const first = outcome(SEEDS[0] ?? 0);
    for (const seed of SEEDS.slice(1)) {
      expect(outcome(seed), `seed ${seed} ended differently from seed ${SEEDS[0]}`).toEqual(first);
    }
  });

  it('the ambient flavour really is seed-dependent, or the test above proves less than it looks', () => {
    // Pins the reason the assertion above compares outcome rather than
    // transcript. If `maze-mutter` were ever made deterministic, this fails and
    // whoever is here can go back to the stricter, simpler check.
    const transcripts = new Set(SEEDS.map((seed) => play(seed).log.map((l) => l.replace(`[seed ${seed}]`, '')).join('\n')));
    expect(transcripts.size).toBeGreaterThan(1);
  });
});

describe('the run is deterministic', () => {
  it('the same seed twice gives the identical final state', () => {
    expect(play(12345).state).toEqual(play(12345).state);
  });
});
