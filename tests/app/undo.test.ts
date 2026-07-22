import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAdventure } from '../../src/loader';
import type { AdventureModule } from '../../src/engine/schema';
import { createGame, step } from '../../src/engine/engine';
import {
  isUndoInput,
  undoRefusal,
  retainedUndo,
  detectDeathText,
  UNDO_REFUSAL_LINES,
} from '../../src/app/useGame';
import { deathVignetteUrl } from '../../src/app/DeathModal';

// T6 (ui-plan §5, §12.3): the undo/death logic that can be headless, is —
// these are the pure functions useGame.ts and DeathModal.tsx call, tested
// against real engine states from the real hollowdeep module. The React
// wiring around them (savedTurn stamping, modal mounting) is smoke-verified
// in the browser; the DECISIONS are all here.
//
// The autosave interaction (cross-task note 3) is a stated invariant rather
// than a hook test: undo never writes storage — useGame pre-stamps the
// autosave guard with the restored turn — and the next consumed turn
// autosaves as normal, landing on the same ring slot its undone predecessor
// used because the ring index is pure `turn % AUTOSAVE_SLOTS` (storage.ts).

let hollowdeep: AdventureModule;

beforeAll(async () => {
  hollowdeep = await loadAdventure(
    (p) => readFile(p, 'utf8'),
    path.resolve(import.meta.dirname, '../../adventures/hollowdeep'),
    (d) => readdir(d),
  );
});

describe('isUndoInput — intercepted above step(), never a parser verb', () => {
  it('matches the keyword through trim and case', () => {
    expect(isUndoInput('undo')).toBe(true);
    expect(isUndoInput('  UNDO  ')).toBe(true);
    expect(isUndoInput('Undo')).toBe(true);
  });

  it('does not swallow commands that merely mention it', () => {
    expect(isUndoInput('undo the latch')).toBe(false);
    expect(isUndoInput('un do')).toBe(false);
    expect(isUndoInput('')).toBe(false);
  });

  it('the engine does not know the word — interception is the only path', () => {
    const state = createGame(hollowdeep, 12345);
    const result = step(hollowdeep, state, 'undo');
    // Whatever the parser says, it is a refusal, not a state rewind.
    expect(result.state.turn).toBe(state.turn);
  });
});

describe('undoRefusal — the gating matrix', () => {
  it('hardcore refuses regardless of everything else', () => {
    expect(undoRefusal({ hardcore: true, ended: false, hasUndo: true })).toBe('hardcore');
    expect(undoRefusal({ hardcore: true, ended: true, hasUndo: false })).toBe('hardcore');
  });

  it('a finished game refuses', () => {
    expect(undoRefusal({ hardcore: false, ended: true, hasUndo: true })).toBe('game-over');
  });

  it('nothing retained refuses (turn 0, fresh load, or an undo already spent)', () => {
    expect(undoRefusal({ hardcore: false, ended: false, hasUndo: false })).toBe('nothing');
  });

  it('otherwise allows', () => {
    expect(undoRefusal({ hardcore: false, ended: false, hasUndo: true })).toBeNull();
  });

  it('every refusal reason has its wry line', () => {
    expect(UNDO_REFUSAL_LINES.hardcore).toBeTruthy();
    expect(UNDO_REFUSAL_LINES['game-over']).toBeTruthy();
    expect(UNDO_REFUSAL_LINES.nothing).toBeTruthy();
  });
});

describe('retainedUndo — exactly one prior state, consumed turns only', () => {
  it('a consumed turn retains the state it left behind', () => {
    const before = createGame(hollowdeep, 12345);
    const after = step(hollowdeep, before, 'e'); // coach-road → main-street
    expect(after.state.turn).toBeGreaterThan(before.turn);
    expect(retainedUndo(before, null, after.state)).toBe(before);
  });

  it('a refused command keeps the previously retained state — a typo must not eat the step back', () => {
    const start = createGame(hollowdeep, 12345);
    const walked = step(hollowdeep, start, 'e');
    const refused = step(hollowdeep, walked.state, 'xyzzy plugh frobnicate');
    expect(refused.state.turn).toBe(walked.state.turn);
    expect(retainedUndo(walked.state, start, refused.state)).toBe(start);
  });

  it('retains only ONE step — the previous retained state is discarded on the next consumed turn', () => {
    const start = createGame(hollowdeep, 12345);
    const first = step(hollowdeep, start, 'e');
    const second = step(hollowdeep, first.state, 'n');
    expect(retainedUndo(first.state, start, second.state)).toBe(first.state);
  });
});

describe('detectDeathText', () => {
  it('finds the death event in a fatal turn and nothing in a safe one', () => {
    const start = createGame(hollowdeep, 12345);
    const safe = step(hollowdeep, start, 'e');
    expect(detectDeathText(safe.events)).toBeNull();

    // A synthetic event list — real deaths need a long setup, and the
    // walkthrough suites already prove they occur; this tests the picker.
    expect(
      detectDeathText([
        { kind: 'command-echo', text: 'jump' },
        { kind: 'death', text: 'You express your opinion of the gap, and the gap files its correction.' },
      ]),
    ).toContain('files its correction');
  });
});

describe('deathVignetteUrl — the death→vignette map (cross-task note 4)', () => {
  it('reverse-maps each of hollowdeep’s eight death messages to its marquee-death-* file', () => {
    const deathIds = Object.keys(hollowdeep.strings).filter((id) => id.endsWith('-death'));
    expect(deathIds).toHaveLength(8);
    for (const id of deathIds) {
      const text = hollowdeep.strings[id];
      expect(text).toBeDefined();
      const url = deathVignetteUrl(hollowdeep, text ?? '');
      const key = id.slice(0, -'-death'.length);
      expect(url).toBe(
        `${import.meta.env.BASE_URL}adventures/hollowdeep/art/marquee-death-${key}.${hollowdeep.manifest.artFormat}`,
      );
    }
  });

  it('returns null for prose that matches no module string (the engine’s bare fallback)', () => {
    expect(deathVignetteUrl(hollowdeep, 'You have died.')).toBeNull();
  });
});
