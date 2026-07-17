import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAdventure } from '../../src/loader';
import type { AdventureModule } from '../../src/engine/schema';
import type { GameState } from '../../src/engine/types';
import { createGame } from '../../src/engine/state';
import { deriveStats, showEndingATease, ENDING_A_ACHIEVEMENT_ID } from '../../src/app/StatsScreen';

// T10 (ui-plan §6 "Post-game stats", §12.4 "the ending tease stays"): the
// pure derivation this task's brief calls out for testing, driven against
// the REAL modules — same pattern as mapLayout.test.ts/journal.test.ts, and
// for the same reason: "12 treasures", "58 locations", "8 achievements" are
// facts about `adventures/hollowdeep/*.json`, not fixture values this suite
// should invent and risk drifting from the content.

let hollowdeep: AdventureModule;
let testCave: AdventureModule;

async function load(dir: string): Promise<AdventureModule> {
  return loadAdventure(
    (p) => readFile(p, 'utf8'),
    path.resolve(import.meta.dirname, '../../adventures', dir),
    (d) => readdir(d),
  );
}

beforeAll(async () => {
  hollowdeep = await load('hollowdeep');
  testCave = await load('test-cave');
});

describe('showEndingATease', () => {
  it('is false before the game has ended', () => {
    const state = createGame(hollowdeep, 1);
    expect(showEndingATease(hollowdeep, state)).toBe(false);
  });

  it('is false on a loss, even if the achievement is (impossibly) present', () => {
    const base = createGame(hollowdeep, 1);
    const state: GameState = {
      ...base,
      achievements: [ENDING_A_ACHIEVEMENT_ID],
      ended: { victory: false, rank: 'Drowned' },
    };
    expect(showEndingATease(hollowdeep, state)).toBe(false);
  });

  it('is false on a victory that earned ending B instead (kept-the-seal, not the-full-ledger)', () => {
    const base = createGame(hollowdeep, 1);
    const state: GameState = {
      ...base,
      achievements: ['kept-the-seal'],
      ended: { victory: true, rank: 'Warden' },
    };
    expect(showEndingATease(hollowdeep, state)).toBe(false);
  });

  it('is true on a victory that earned the-full-ledger (ending A)', () => {
    const base = createGame(hollowdeep, 1);
    const state: GameState = {
      ...base,
      achievements: [ENDING_A_ACHIEVEMENT_ID],
      ended: { victory: true, rank: 'Warden' },
    };
    expect(showEndingATease(hollowdeep, state)).toBe(true);
  });

  it('never fires for a module that has no such achievement (test-cave)', () => {
    const base = createGame(testCave, 1);
    const state: GameState = {
      ...base,
      // Forging the id onto a module that never declares it must not matter.
      achievements: [ENDING_A_ACHIEVEMENT_ID],
      ended: { victory: true, rank: 'Winner' },
    };
    expect(showEndingATease(testCave, state)).toBe(false);
  });
});

describe('deriveStats', () => {
  it('reflects module facts for a fresh, unfinished game', () => {
    const state = createGame(hollowdeep, 1);
    const stats = deriveStats(hollowdeep, state);

    expect(stats.turns).toBe(0);
    expect(stats.score).toBe(0);
    expect(stats.rank).toBeNull();
    expect(stats.victory).toBe(false);
    expect(stats.deaths).toBe(0);
    expect(stats.hintsUsed).toBe(0);
    expect(stats.treasuresBanked).toBe(0);
    expect(stats.treasuresTotal).toBe(12); // adventures/hollowdeep/items.json: 12 items carry a `treasure` field
    expect(stats.mapVisited).toBe(state.visited.length);
    expect(stats.mapTotal).toBe(58); // adventures/hollowdeep/locations.json
    expect(stats.achievementsEarned).toBe(0);
    expect(stats.achievementsTotal).toBe(8); // adventures/hollowdeep/achievements.json
    expect(stats.showEndingATease).toBe(false);
  });

  it('reflects an ended, victorious state with the ending-A tease', () => {
    const base = createGame(hollowdeep, 1);
    const state: GameState = {
      ...base,
      turn: 210,
      score: 340,
      deaths: 2,
      hintsUsed: 3,
      scoredDeposit: ['payroll-tin', 'cut-garnets'],
      visited: [...base.visited, 'assay-office'],
      achievements: [ENDING_A_ACHIEVEMENT_ID, 'no-deaths'],
      ended: { victory: true, rank: 'Warden of the Ledger' },
    };
    const stats = deriveStats(hollowdeep, state);

    expect(stats.turns).toBe(210);
    expect(stats.score).toBe(340);
    expect(stats.rank).toBe('Warden of the Ledger');
    expect(stats.victory).toBe(true);
    expect(stats.deaths).toBe(2);
    expect(stats.hintsUsed).toBe(3);
    expect(stats.treasuresBanked).toBe(2);
    expect(stats.mapVisited).toBe(state.visited.length);
    expect(stats.achievementsEarned).toBe(2);
    expect(stats.showEndingATease).toBe(true);
  });

  it('map/achievement/treasure totals come from test-cave when playing test-cave', () => {
    const state = createGame(testCave, 1);
    const stats = deriveStats(testCave, state);

    expect(stats.mapTotal).toBe(testCave.locations.length);
    expect(stats.treasuresTotal).toBe(testCave.items.filter((item) => item.treasure !== undefined).length);
    expect(stats.achievementsTotal).toBe(testCave.achievements.length);
  });
});
