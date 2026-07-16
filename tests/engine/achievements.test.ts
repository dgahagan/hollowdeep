import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAdventure } from '../../src/loader';
import type { AdventureModule } from '../../src/engine/schema';
import type { GameState } from '../../src/engine/types';
import { createGame, setItemLocation } from '../../src/engine/state';
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

// Achievements (foundation-implementation-plan.md T20; FR-1.12).
//
// There is no `src/engine/systems/achievements.ts`, and that absence is the
// finding: every achievement in this plan is awarded by the `award` Effect
// (schema/effects.ts), applied at events.ts's single choke point (T12), from
// an ORDINARY event. test-cave's `first-treasure-award` fires on `take` when
// the player holds either treasure; `win-clean` fires on the `both-deposited`
// `flagSet` with a `deathsAtMost: 0` guard. Both are content, written in the
// same Condition/Effect vocabulary as every other event in the module.
//
// `Achievement` (schema/achievement.ts) deliberately has no `when: Condition[]`
// the way `Milestone` (schema/scoring.ts) does, and must not gain one: a second
// condition-evaluation path duplicating `fireTriggers`/`evalConditions` is two
// implementations of one rule, the exact hazard the choke point exists to
// prevent. So achievements need no engine system, no tick, and no wiring —
// engine.ts rightly carries no TODO(T20) for them.
//
// Which leaves these tests AS T20's achievement deliverable: proof the content
// awards under the right conditions and, more importantly, not otherwise.

describe('first-treasure — via the real engine', () => {
  it('awards on first picking up a treasure', () => {
    const atGrotto = { ...start, locationId: 'grotto' };
    const { state, events } = step(module_, atGrotto, 'take chalice');

    expect(state.achievements).toEqual(['first-treasure']);
    expect(texts(events)).toContain('Magpie');
  });

  it('does not award for taking a non-treasure item', () => {
    const atShed = { ...start, locationId: 'shed' };
    const { state } = step(module_, atShed, 'take lamp');

    expect(state.achievements).toEqual([]);
  });

  it('does not award a second time on re-taking a treasure', () => {
    const atGrotto = { ...start, locationId: 'grotto' };
    const { state: afterFirst } = step(module_, atGrotto, 'take chalice');
    const dropped = setItemLocation(afterFirst, 'silver-chalice', 'grotto');
    const { state: afterSecond, events } = step(module_, dropped, 'take chalice');

    expect(afterSecond.achievements).toEqual(['first-treasure']);
    expect(texts(events)).not.toContain('Achievement unlocked');
  });
});

describe('no-deaths — via the real engine', () => {
  /**
   * A state one `drop idol` away from victory, with both treasures already
   * carried and one already deposited — the same shape scoring.test.ts uses
   * for its rank tests, reused here so this test is about achievements, not
   * about re-deriving a full walkthrough.
   */
  function oneStepFromVictory(deaths: number): GameState {
    let s: GameState = {
      ...start,
      locationId: 'shed',
      deaths,
      scoredCarry: ['silver-chalice', 'jade-idol'],
      scoredDeposit: ['silver-chalice', 'jade-idol'],
      awardedMilestones: ['grate-opened'],
    };
    s = setItemLocation(s, 'silver-chalice', 'shed');
    s = setItemLocation(s, 'jade-idol', 'inventory');
    return s;
  }

  it('awards no-deaths on a victory with zero deaths', () => {
    const { state, events } = step(module_, oneStepFromVictory(0), 'drop idol');

    expect(state.ended?.victory).toBe(true);
    expect(state.achievements).toContain('no-deaths');
    expect(texts(events)).toContain('Unhurried');
  });

  it('withholds no-deaths from a victory after at least one death', () => {
    const { state } = step(module_, oneStepFromVictory(1), 'drop idol');

    expect(state.ended?.victory).toBe(true);
    expect(state.achievements).not.toContain('no-deaths');
  });
});
