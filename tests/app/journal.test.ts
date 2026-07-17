import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAdventure } from '../../src/loader';
import type { AdventureModule } from '../../src/engine/schema';
import type { GameState } from '../../src/engine/types';
import { createGame } from '../../src/engine/state';
import { step } from '../../src/engine/engine';
import { deriveJournal, prettifyId } from '../../src/app/journal';

// T7 (ui-plan §6): the Journal's Log is a pure derivation from GameState, so
// this suite drives it against the REAL hollowdeep module the same way
// mapLayout.test.ts drives the map — real content, not a hand-built fixture,
// because the whole point of "rebuildable from any loaded save" is that it
// works against states play actually produces.

let hollowdeep: AdventureModule;

beforeAll(async () => {
  hollowdeep = await loadAdventure(
    (p) => readFile(p, 'utf8'),
    path.resolve(import.meta.dirname, '../../adventures/hollowdeep'),
    (d) => readdir(d),
  );
});

/**
 * A prefix of the real walkthrough with two `hint` calls stitched in, at
 * points where a real ladder is genuinely available (verified against
 * `hints.json`'s own `when` conditions — see the comments below), so the
 * resulting state exercises every Log section the walkthrough itself never
 * would (hollowdeep's walkthrough famously takes zero hints, per
 * `tests/walkthrough.test.ts`).
 *
 * Every non-`hint` command is copied verbatim, in order, from
 * `adventures/hollowdeep/walkthrough.json` — inserting `hint` costs no turn
 * and moves nothing, so the location trajectory below is identical to the
 * walkthrough's own first 35 turns.
 */
function playMidWalkthrough(module_: AdventureModule): GameState {
  const commands = [
    'e', // coach-road -> main-street
    // office-lock's `when` (hints.json): visited main-street && notFlag
    // office-door-open. Both hold right here, before the office is ever
    // unlocked.
    'hint',
    'n', // -> chapel
    'take key',
    's', // -> main-street
    'unlock door with key',
    'open door', // sets office-door-open
    'drop key',
    'e', // -> assay-office
    'search bench', // reveals assay-button IN the repository room: deposit scores on reveal
    'take button', // carry scores
    'drop button', // achievement: On the Books
    'w', // -> main-street
    's', // -> general-store
    'take canary',
    'n', // -> main-street
    'ne', // -> tailings-path
    'u', // -> adit-mouth
    'e', // -> behind-the-seal: milestone `enter-the-cave` (visited behind-the-seal)
    'light lamp',
    'e', // -> adit-drift
    's', // -> stables
    'take gad',
    'take handle',
    'n', // -> adit-drift
    'e', // -> junction
    // payroll-tin's `when`: visited junction && itemAt payroll-tin at
    // timekeepers-nook. Both hold here — the tin hasn't been taken yet.
    'hint',
    'e', // -> shaft-head
    'n', // -> pump-room
    'use pump',
    'use pump',
    'drop handle',
    's', // -> shaft-head
    'drop gad',
    'w', // -> junction
    'n', // -> timekeepers-nook
    'take tin', // carries payroll-tin (not yet deposited)
  ];

  let state = createGame(module_, 12345);
  for (const cmd of commands) {
    state = step(module_, state, cmd).state;
  }
  return state;
}

describe('prettifyId', () => {
  it('turns a kebab-case hint id into a title (ui-plan §6: "ids were named for this")', () => {
    expect(prettifyId('office-lock')).toBe('Office Lock');
    expect(prettifyId('payroll-tin')).toBe('Payroll Tin');
    expect(prettifyId('gunnis-word')).toBe('Gunnis Word');
  });
});

describe('deriveJournal: a fresh game', () => {
  it('is almost entirely empty — nothing has been awarded, taken, or revealed yet', () => {
    const state = createGame(hollowdeep, 12345);
    const log = deriveJournal(hollowdeep, state);

    expect(log.milestones).toEqual([]);
    expect(log.treasures).toEqual([]);
    expect(log.achievements).toEqual([]);
    expect(log.hints).toEqual([]);
    expect(log.deaths).toEqual({ count: 0, penaltyTotal: 0 });
  });
});

describe('deriveJournal: a mid-walkthrough state', () => {
  it('reflects the awarded milestone, exactly as scoring.json describes it', () => {
    const state = playMidWalkthrough(hollowdeep);
    const log = deriveJournal(hollowdeep, state);

    expect(state.awardedMilestones).toEqual(['enter-the-cave']);
    expect(log.milestones).toEqual([
      {
        id: 'enter-the-cave',
        label: 'Passed the cracked seal and stood inside the hill.',
        points: 5,
      },
    ]);
  });

  it('lists each treasure with its own carried/deposited status', () => {
    const state = playMidWalkthrough(hollowdeep);
    const log = deriveJournal(hollowdeep, state);

    const button = log.treasures.find((t) => t.id === 'assay-button');
    const tin = log.treasures.find((t) => t.id === 'payroll-tin');
    expect(button).toEqual({
      id: 'assay-button',
      label: "assayer's button",
      carried: true,
      deposited: true,
      carryPoints: 5,
      depositPoints: 10,
    });
    expect(tin).toEqual({
      id: 'payroll-tin',
      label: 'payroll tin',
      carried: true,
      deposited: false,
      carryPoints: 5,
      depositPoints: 10,
    });
    // Nothing else has been scored yet — the list is exactly these two.
    expect(log.treasures.map((t) => t.id).sort()).toEqual(['assay-button', 'payroll-tin']);
  });

  it('lists the earned achievement by its module name and description', () => {
    const state = playMidWalkthrough(hollowdeep);
    const log = deriveJournal(hollowdeep, state);

    expect(log.achievements).toEqual([
      {
        id: 'on-the-books',
        name: 'On the Books',
        description: 'Your first find, weighed and entered. The Hollowdeep is now, officially, an income.',
      },
    ]);
  });

  it('groups revealed hint rungs by ladder, titled from the id, with nothing unrevealed', () => {
    const state = playMidWalkthrough(hollowdeep);
    const log = deriveJournal(hollowdeep, state);

    expect(state.hintsRevealed).toEqual({ 'office-lock': 1, 'payroll-tin': 1 });

    const officeLock = log.hints.find((h) => h.id === 'office-lock');
    expect(officeLock).toEqual({
      id: 'office-lock',
      title: 'Office Lock',
      rungs: [
        'The assay office kept the town\'s gold, so the town kept the office locked. Locks outlive their keyholders.',
      ],
      revealed: 1,
      total: 3,
    });

    const payrollTin = log.hints.find((h) => h.id === 'payroll-tin');
    expect(payrollTin).toEqual({
      id: 'payroll-tin',
      title: 'Payroll Tin',
      rungs: ['The timekeeper kept the wages, and the nook is barely a step off the junction. Nobody ever collected.'],
      revealed: 1,
      total: 1,
    });

    // Every OTHER ladder in the module has revealed nothing, and must not appear.
    expect(log.hints.map((h) => h.id).sort()).toEqual(['office-lock', 'payroll-tin']);
  });

  it('reports zero deaths — nothing on this route died', () => {
    const state = playMidWalkthrough(hollowdeep);
    const log = deriveJournal(hollowdeep, state);
    expect(log.deaths).toEqual({ count: 0, penaltyTotal: 0 });
  });

  it('is a CURRENT-STATE summary: deriving twice from the identical state never drifts', () => {
    const state = playMidWalkthrough(hollowdeep);
    const first = deriveJournal(hollowdeep, state);
    const second = deriveJournal(hollowdeep, state);
    expect(second).toEqual(first);
  });
});

describe('deriveJournal: deaths', () => {
  it('summarizes a nonzero death count with the ledger-derived penalty total, never a per-death list', () => {
    // GameState keeps no per-death detail (journal.ts's own header) — only a
    // running `deaths` count survives a save. Building the state directly
    // (rather than actually dying in play) is the honest way to test that:
    // it proves the summary is a pure function of the count, not of how the
    // deaths happened.
    const base = createGame(hollowdeep, 12345);
    const state: GameState = { ...base, deaths: 3 };
    const log = deriveJournal(hollowdeep, state);

    expect(log.deaths).toEqual({ count: 3, penaltyTotal: 3 * hollowdeep.scoring.deathPenalty });
  });
});
