import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAdventure } from '../../src/loader';
import type { AdventureModule } from '../../src/engine/schema';
import type { GameState } from '../../src/engine/types';
import { createGame, setFlag, setItemLocation } from '../../src/engine/state';
import { rankFor, scoringTick } from '../../src/engine/systems/scoring';
import { step } from '../../src/engine/engine';

const MODULE_DIR = path.resolve(import.meta.dirname, '../../adventures/test-cave');

let module_: AdventureModule;
let start: GameState;

beforeAll(async () => {
  module_ = await loadAdventure(
    (p) => readFile(p, 'utf8'),
    MODULE_DIR,
    (dir) => readdir(dir),
  );
  start = createGame(module_, 42);
});

function texts(events: { text: string }[]): string {
  return events.map((e) => e.text).join(' | ');
}

// test-cave: silver-chalice and jade-idol are both `carryPoints: 20,
// depositPoints: 25` (adventures/test-cave/items.json); `manifest.repositoryLocation`
// is `shed`; the `grate-opened` milestone is worth 10 points on `flag:
// grate-open` (scoring.json). maxScore reconciles to 100 — see the execution
// notes' "Open questions resolved in-flight" for the 20+25×2+10 split.

describe('scoringTick — treasure carry points', () => {
  it('awards carry points the turn a treasure is first carried', () => {
    const carrying = setItemLocation(start, 'silver-chalice', 'inventory');
    const [state, events] = scoringTick(module_, carrying);

    expect(state.score).toBe(20);
    expect(state.scoredCarry).toEqual(['silver-chalice']);
    expect(events).toEqual([{ kind: 'score', text: 'You score 20.', points: 20, total: 20 }]);
  });

  it('does not re-award on a second tick while still carried', () => {
    const carrying = setItemLocation(start, 'silver-chalice', 'inventory');
    const [once] = scoringTick(module_, carrying);
    const [twice, events] = scoringTick(module_, once);

    expect(twice.score).toBe(20);
    expect(twice.scoredCarry).toEqual(['silver-chalice']);
    expect(events).toEqual([]);
  });

  it('does not re-award after dropping and re-taking the same treasure', () => {
    const carrying = setItemLocation(start, 'silver-chalice', 'inventory');
    const [afterFirstCarry] = scoringTick(module_, carrying);

    // Drop it, tick (no change), pick it back up, tick again.
    const dropped = setItemLocation(afterFirstCarry, 'silver-chalice', 'grotto');
    const [afterDrop] = scoringTick(module_, dropped);
    const recarried = setItemLocation(afterDrop, 'silver-chalice', 'inventory');
    const [afterSecondCarry, events] = scoringTick(module_, recarried);

    expect(afterSecondCarry.score).toBe(20);
    expect(afterSecondCarry.scoredCarry).toEqual(['silver-chalice']);
    expect(events).toEqual([]);
  });

  it('does not award carry points for an item with no `treasure` field', () => {
    const carrying = setItemLocation(start, 'brass-lamp', 'inventory');
    const [state, events] = scoringTick(module_, carrying);

    expect(state.score).toBe(0);
    expect(state.scoredCarry).toEqual([]);
    expect(events).toEqual([]);
  });

  it('scores each treasure independently, by item id', () => {
    let both = setItemLocation(start, 'silver-chalice', 'inventory');
    both = setItemLocation(both, 'jade-idol', 'inventory');
    const [state] = scoringTick(module_, both);

    expect(state.score).toBe(40);
    expect(state.scoredCarry.sort()).toEqual(['jade-idol', 'silver-chalice']);
  });
});

describe('scoringTick — treasure deposit points', () => {
  it('awards deposit points the turn a treasure first reaches the repository', () => {
    const deposited = setItemLocation(start, 'silver-chalice', 'shed');
    const [state, events] = scoringTick(module_, deposited);

    expect(state.score).toBe(25);
    expect(state.scoredDeposit).toEqual(['silver-chalice']);
    expect(events).toEqual([{ kind: 'score', text: 'You score 25.', points: 25, total: 25 }]);
  });

  it('does not re-award if the treasure leaves and comes back to the repository', () => {
    const deposited = setItemLocation(start, 'silver-chalice', 'shed');
    const [afterFirst] = scoringTick(module_, deposited);

    // A thief (or the player) moves it back out, then it returns.
    const takenBack = setItemLocation(afterFirst, 'silver-chalice', 'inventory');
    const [afterOut] = scoringTick(module_, takenBack);
    const redeposited = setItemLocation(afterOut, 'silver-chalice', 'shed');
    const [afterSecond, events] = scoringTick(module_, redeposited);

    // The re-take DOES award carry points here since scoredCarry started
    // empty — that's a separate ledger from deposit and is exactly the point.
    expect(afterSecond.scoredDeposit).toEqual(['silver-chalice']);
    expect(events.filter((e) => e.kind === 'score' && e.text.includes('25'))).toHaveLength(0);
  });

  it('carry and deposit are independent: carrying then depositing awards both, once each', () => {
    const carrying = setItemLocation(start, 'silver-chalice', 'inventory');
    const [afterCarry] = scoringTick(module_, carrying);
    expect(afterCarry.score).toBe(20);

    const deposited = setItemLocation(afterCarry, 'silver-chalice', 'shed');
    const [afterDeposit] = scoringTick(module_, deposited);
    expect(afterDeposit.score).toBe(45);
    expect(afterDeposit.scoredCarry).toEqual(['silver-chalice']);
    expect(afterDeposit.scoredDeposit).toEqual(['silver-chalice']);

    // A further tick with nothing changed awards nothing more.
    const [settled, events] = scoringTick(module_, afterDeposit);
    expect(settled.score).toBe(45);
    expect(events).toEqual([]);
  });

  it('does not award deposit points for a treasure elsewhere', () => {
    const elsewhere = setItemLocation(start, 'silver-chalice', 'grotto');
    const [state, events] = scoringTick(module_, elsewhere);

    expect(state.score).toBe(0);
    expect(state.scoredDeposit).toEqual([]);
    expect(events).toEqual([]);
  });
});

describe('scoringTick — milestones', () => {
  it('awards a milestone the turn its `when` first passes', () => {
    const grateOpen = setFlag(start, 'grate-open', true);
    const [state, events] = scoringTick(module_, grateOpen);

    expect(state.score).toBe(10);
    expect(state.awardedMilestones).toEqual(['grate-opened']);
    expect(events).toEqual([{ kind: 'score', text: 'You score 10.', points: 10, total: 10 }]);
  });

  it('does not award before the condition is met', () => {
    const [state, events] = scoringTick(module_, start);

    expect(state.score).toBe(0);
    expect(state.awardedMilestones).toEqual([]);
    expect(events).toEqual([]);
  });

  it('does not re-award on a later tick once already awarded', () => {
    const grateOpen = setFlag(start, 'grate-open', true);
    const [once] = scoringTick(module_, grateOpen);
    const [twice, events] = scoringTick(module_, once);

    expect(twice.score).toBe(10);
    expect(twice.awardedMilestones).toEqual(['grate-opened']);
    expect(events).toEqual([]);
  });

  it('does not re-award even if the flag is later cleared and re-set', () => {
    const grateOpen = setFlag(start, 'grate-open', true);
    const [awarded] = scoringTick(module_, grateOpen);
    const stillAwarded = { ...awarded, flags: { ...awarded.flags, 'grate-open': false } };
    const reopened = setFlag(stillAwarded, 'grate-open', true);
    const [state, events] = scoringTick(module_, reopened);

    expect(state.score).toBe(10);
    expect(state.awardedMilestones).toEqual(['grate-opened']);
    expect(events).toEqual([]);
  });
});

describe('scoringTick — treasures and milestones together', () => {
  it('reaches exactly maxScore when both treasures are deposited and the grate is open', () => {
    let full = setItemLocation(start, 'silver-chalice', 'inventory');
    full = setItemLocation(full, 'jade-idol', 'inventory');
    const [afterCarry] = scoringTick(module_, full);

    let atShed = setItemLocation(afterCarry, 'silver-chalice', 'shed');
    atShed = setItemLocation(atShed, 'jade-idol', 'shed');
    atShed = setFlag(atShed, 'grate-open', true);
    const [final] = scoringTick(module_, atShed);

    expect(final.score).toBe(module_.manifest.maxScore);
    expect(final.score).toBe(100);
  });
});

describe('rankFor — band boundaries', () => {
  // test-cave's real table (scoring.json): Tourist @0, Spelunker @45,
  // Master of the Test Cave @100.
  it.each([
    [0, 'Tourist'],
    [1, 'Tourist'],
    [44, 'Tourist'],
    [45, 'Spelunker'],
    [46, 'Spelunker'],
    [99, 'Spelunker'],
    [100, 'Master of the Test Cave'],
    [1000, 'Master of the Test Cave'],
  ])('score %i -> %s', (score, expected) => {
    expect(rankFor(module_, score)).toBe(expected);
  });

  it('resolves a synthetic table at every boundary, not just the middle of a band', () => {
    // A hand-built table lets this test catch an off-by-one at a boundary
    // independent of whatever thresholds test-cave happens to use.
    const withRanks: AdventureModule = {
      ...module_,
      scoring: {
        ...module_.scoring,
        ranks: [
          { minScore: -100, title: 'Floor' },
          { minScore: 0, title: 'Zero' },
          { minScore: 10, title: 'Ten' },
          { minScore: 20, title: 'Twenty' },
        ],
      },
    };

    expect(rankFor(withRanks, -1)).toBe('Floor');
    expect(rankFor(withRanks, 0)).toBe('Zero');
    expect(rankFor(withRanks, 9)).toBe('Zero');
    expect(rankFor(withRanks, 10)).toBe('Ten');
    expect(rankFor(withRanks, 19)).toBe('Ten');
    expect(rankFor(withRanks, 20)).toBe('Twenty');
    expect(rankFor(withRanks, 500)).toBe('Twenty');
  });

  // Regression: `rankFor` used to seed its running "best" rank with
  // `ranks[0]` unconditionally, even when that entry didn't qualify for the
  // score. Every ascending table (test-cave's real one, and the synthetic one
  // above) hides this completely, because an ascending table's `ranks[0]` is
  // always the `minScore <= 0` floor, which always qualifies. Author the
  // identical table best-first — a wholly natural way to write a rank table,
  // and one `zScoring`'s schema explicitly does not forbid (its own `.refine`
  // comments name array-order-dependence as the exact thing to fear) — and
  // the bug crowned every score "Master of the Test Cave", including zero.
  //
  // So this asserts the SAME boundaries as the `it.each` above, against THREE
  // orderings of the same three ranks, and requires identical answers from
  // all three: a change that special-cases "the floor happens to be first"
  // back in would fail this immediately.
  const sameThreeRanks = {
    ascending: [
      { minScore: 0, title: 'Tourist' },
      { minScore: 45, title: 'Spelunker' },
      { minScore: 100, title: 'Master of the Test Cave' },
    ],
    'best-first (descending)': [
      { minScore: 100, title: 'Master of the Test Cave' },
      { minScore: 45, title: 'Spelunker' },
      { minScore: 0, title: 'Tourist' },
    ],
    shuffled: [
      { minScore: 45, title: 'Spelunker' },
      { minScore: 100, title: 'Master of the Test Cave' },
      { minScore: 0, title: 'Tourist' },
    ],
  };

  it.each(Object.entries(sameThreeRanks))('is order-independent: %s', (_label, ranks) => {
    const withRanks: AdventureModule = { ...module_, scoring: { ...module_.scoring, ranks } };

    expect(rankFor(withRanks, 0)).toBe('Tourist');
    expect(rankFor(withRanks, 44)).toBe('Tourist');
    expect(rankFor(withRanks, 45)).toBe('Spelunker');
    expect(rankFor(withRanks, 99)).toBe('Spelunker');
    expect(rankFor(withRanks, 100)).toBe('Master of the Test Cave');
    expect(rankFor(withRanks, 1000)).toBe('Master of the Test Cave');
  });
});

describe('scoring — death (penalty already applied by engine.ts, not here)', () => {
  /**
   * `jump` at the ledge is test-cave's lethal hazard (also exercised in
   * step.test.ts). Its trigger only guards on `atLocation: ledge`
   * (events.json's `jump-ledge`) — no light needed to fall off a cliff.
   */
  function at(locationId: string): GameState {
    return { ...start, locationId };
  }

  it('death does not touch scoredCarry: re-collecting a scattered treasure does not re-award', () => {
    // Carry the chalice, score it, then die at the ledge — it scatters there —
    // then walk it back into inventory and confirm no second carry award.
    const carrying = setItemLocation(at('ledge'), 'silver-chalice', 'inventory');
    const [afterCarry] = scoringTick(module_, carrying);
    expect(afterCarry.score).toBe(20);
    expect(afterCarry.scoredCarry).toEqual(['silver-chalice']);

    const { state: afterDeath } = step(module_, { ...afterCarry, rng: 42 }, 'jump');
    // The death penalty (10, scoring.json) applied once, on top of the 20 already banked.
    expect(afterDeath.score).toBe(20 - module_.scoring.deathPenalty);
    expect(afterDeath.itemLocations['silver-chalice']).toBe('ledge');
    expect(afterDeath.deaths).toBe(1);

    // Pick the chalice back up (simulating the walk back) and tick again.
    const recollected = setItemLocation(afterDeath, 'silver-chalice', 'inventory');
    const [afterRecollect, events] = scoringTick(module_, recollected);

    expect(afterRecollect.score).toBe(20 - module_.scoring.deathPenalty);
    expect(afterRecollect.scoredCarry).toEqual(['silver-chalice']);
    expect(events).toEqual([]);
  });

  it('does not drive score below zero even with treasure banked (engine.ts owns the clamp)', () => {
    const carrying = setItemLocation(at('ledge'), 'silver-chalice', 'inventory');
    const [afterCarry] = scoringTick(module_, carrying);
    // Bank fewer points than the death penalty so the clamp is exercised.
    const lowScore = { ...afterCarry, score: 5 };
    const { state } = step(module_, { ...lowScore, rng: 42 }, 'jump');
    expect(state.score).toBe(0);
  });
});

describe('step — rank appears in the end-of-game event and in state.ended', () => {
  /**
   * A state one `drop idol` away from victory, with both treasures' ledgers
   * already settled — so `scoringTick`'s own carry/deposit awards (already
   * covered above) do not perturb `score` and this test can assert the rank
   * wiring against an exact, known-final number.
   */
  function oneStepFromVictory(score: number): GameState {
    let s: GameState = {
      ...start,
      locationId: 'shed',
      score,
      scoredCarry: ['silver-chalice', 'jade-idol'],
      scoredDeposit: ['silver-chalice', 'jade-idol'],
      awardedMilestones: ['grate-opened'],
    };
    s = setItemLocation(s, 'silver-chalice', 'shed');
    s = setItemLocation(s, 'jade-idol', 'inventory');
    return s;
  }

  it('fills in the rank once the game ends', () => {
    const { state, events } = step(module_, oneStepFromVictory(100), 'drop idol');

    expect(state.score).toBe(100);
    expect(state.ended?.victory).toBe(true);
    expect(state.ended?.rank).toBe('Master of the Test Cave');
    const gameOver = events.find((e) => e.kind === 'game-over');
    expect(gameOver).toBeDefined();
    expect(gameOver?.kind === 'game-over' && gameOver.rank).toBe('Master of the Test Cave');
  });

  it('a lower final score gets the corresponding lower rank, not the top one', () => {
    const { state } = step(module_, oneStepFromVictory(45), 'drop idol');
    expect(state.score).toBe(45);
    expect(state.ended?.rank).toBe('Spelunker');
  });
});

// Kept to make sure the two test-cave OutputEvent texts stay legible without
// re-asserting message content elsewhere in this file.
describe('scoreEvent text', () => {
  it('reads as a plain mechanical status line, matching addScore\'s own voice', () => {
    const carrying = setItemLocation(start, 'silver-chalice', 'inventory');
    const [, events] = scoringTick(module_, carrying);
    expect(texts(events)).toBe('You score 20.');
  });
});
