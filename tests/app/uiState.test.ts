import { describe, expect, it } from 'vitest';
import {
  activeInspect,
  DEFAULT_SETTINGS,
  DEFAULT_SIDECAR,
  loadSettings,
  loadSidecar,
  saveSettings,
  saveSidecar,
  type StorageLike,
} from '../../src/app/uiState';

// Headless coverage for uiState.ts (T2, ui-plan §8's "tolerate-and-reset"
// posture). Deliberately no jsdom/RTL (standing rule #2, "keep the gate
// fast") — a tiny in-memory `StorageLike` stands in for `localStorage`,
// which vitest's `node` environment (vitest.config.ts) doesn't provide.

function makeMemoryStorage(): StorageLike {
  const backing = new Map<string, string>();
  return {
    getItem(key) {
      return backing.has(key) ? (backing.get(key) as string) : null;
    },
    setItem(key, value) {
      backing.set(key, value);
    },
    removeItem(key) {
      backing.delete(key);
    },
  };
}

describe('uiState — global settings (cave.settings)', () => {
  it('returns defaults when storage has nothing stored yet', () => {
    const storage = makeMemoryStorage();
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips a saved settings object exactly', () => {
    const storage = makeMemoryStorage();
    const custom = {
      ...DEFAULT_SETTINGS,
      theme: 'light' as const,
      textSize: 'large' as const,
      transcriptOnly: true,
      reduceMotion: true,
      typewriterSpeed: 'slow' as const,
    };

    expect(saveSettings(custom, storage)).toBe(true);
    expect(loadSettings(storage)).toEqual(custom);
  });

  it('tolerates malformed JSON by resetting to defaults, never throwing', () => {
    const storage = makeMemoryStorage();
    storage.setItem('cave.settings', '{ this is not json');

    expect(() => loadSettings(storage)).not.toThrow();
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('tolerates a stale/foreign version number by resetting to defaults', () => {
    const storage = makeMemoryStorage();
    storage.setItem('cave.settings', JSON.stringify({ ...DEFAULT_SETTINGS, version: 999 }));

    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('tolerates a wrong-shaped object (bad enum value, missing field) by resetting to defaults', () => {
    const storage = makeMemoryStorage();
    storage.setItem(
      'cave.settings',
      JSON.stringify({ version: DEFAULT_SETTINGS.version, theme: 'ultraviolet' }),
    );

    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('tolerates a JSON value that parses but is not an object (e.g. a bare number)', () => {
    const storage = makeMemoryStorage();
    storage.setItem('cave.settings', '42');

    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to defaults with no storage available at all (no arg, node env has no localStorage)', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(DEFAULT_SETTINGS)).toBe(false);
  });
});

describe('uiState — per-adventure UI sidecar (cave.<id>.ui)', () => {
  it('returns defaults when nothing is stored for that adventure yet', () => {
    const storage = makeMemoryStorage();
    expect(loadSidecar('hollowdeep', storage)).toEqual(DEFAULT_SIDECAR);
  });

  it('round-trips a saved sidecar object exactly', () => {
    const storage = makeMemoryStorage();
    const sidecar = { ...DEFAULT_SIDECAR, onboardingSeen: true, journalNotes: 'the grate needs oil', hardcore: true };

    expect(saveSidecar('hollowdeep', sidecar, storage)).toBe(true);
    expect(loadSidecar('hollowdeep', storage)).toEqual(sidecar);
  });

  it('namespaces sidecars per adventure id — two ids never collide', () => {
    const storage = makeMemoryStorage();
    const hollowdeep = { ...DEFAULT_SIDECAR, journalNotes: 'hollowdeep notes', hardcore: true };
    const testCave = { ...DEFAULT_SIDECAR, journalNotes: 'test-cave notes', onboardingSeen: true };

    saveSidecar('hollowdeep', hollowdeep, storage);
    saveSidecar('test-cave', testCave, storage);

    expect(loadSidecar('hollowdeep', storage)).toEqual(hollowdeep);
    expect(loadSidecar('test-cave', storage)).toEqual(testCave);
    // Writing one adventure's sidecar must not disturb the other's.
    expect(loadSidecar('hollowdeep', storage).journalNotes).not.toBe(testCave.journalNotes);
  });

  it('tolerates malformed JSON for one adventure without affecting another', () => {
    const storage = makeMemoryStorage();
    const testCave = { ...DEFAULT_SIDECAR, journalNotes: 'still good' };
    saveSidecar('test-cave', testCave, storage);
    storage.setItem('cave.hollowdeep.ui', 'not json at all');

    expect(loadSidecar('hollowdeep', storage)).toEqual(DEFAULT_SIDECAR);
    expect(loadSidecar('test-cave', storage)).toEqual(testCave);
  });

  it('tolerates a stale version number by resetting to defaults', () => {
    const storage = makeMemoryStorage();
    storage.setItem('cave.hollowdeep.ui', JSON.stringify({ ...DEFAULT_SIDECAR, version: 0 }));

    expect(loadSidecar('hollowdeep', storage)).toEqual(DEFAULT_SIDECAR);
  });

  it('falls back to defaults with no storage available at all', () => {
    expect(loadSidecar('hollowdeep')).toEqual(DEFAULT_SIDECAR);
    expect(saveSidecar('hollowdeep', DEFAULT_SIDECAR)).toBe(false);
  });
});

describe('activeInspect — the one-turn examine-art window', () => {
  const echo = { kind: 'command-echo', text: '> examine lamp' } as const;
  const text = { kind: 'text', text: 'A brass lamp.' } as const;
  const inspect = { kind: 'inspect', text: 'lamp', artId: 'brass-lamp' } as const;

  it('returns the inspect from the newest turn', () => {
    expect(activeInspect([echo, text, inspect])).toEqual({ artId: 'brass-lamp', name: 'lamp' });
  });

  it('an inspect from a PRIOR turn is over — any newer command reverts', () => {
    expect(activeInspect([echo, inspect, { kind: 'command-echo', text: '> wait' }, text])).toBeNull();
  });

  it('empty and inspect-free transcripts yield null', () => {
    expect(activeInspect([])).toBeNull();
    expect(activeInspect([echo, text])).toBeNull();
  });
});
