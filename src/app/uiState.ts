import type { OutputEvent } from '../engine/types';

// UI-side persistence: the two layers that sit ALONGSIDE GameState saves
// without ever touching them (ui-plan §8, standing rule #4).
//
//   1. Global settings — theme, text size, transcript-only, motion,
//      typewriter speed — one JSON object at `cave.settings`.
//   2. Per-adventure UI sidecar — onboarding-seen, journal notes, hardcore
//      flag — one JSON object per adventure at `cave.<id>.ui`, namespaced the
//      same way saves are (`storage.ts`'s `cave.<id>.slot.<n>`) so two
//      adventures' sidecars can never collide.
//
// Both layers use a **tolerate-and-reset** migration posture, not the real
// migration registry `engine/save.ts` runs for GameState: anything
// unreadable, wrong-version, or wrong-shape resets silently to defaults
// rather than throwing. Losing a note or a settings tweak to a bad read is
// acceptable (ui-plan §8); losing a SAVE never is, which is exactly why saves
// don't share this file's forgiving posture. There is deliberately no
// version-to-version migration function here: a version bump just means
// "anything with a different version number is not this shape," full stop.
//
// Pure/headless by design (standing rule #2): no React import, and the only
// browser dependency (`localStorage`) is read through an injectable
// `StorageLike` so `tests/app/uiState.test.ts` can run under vitest's `node`
// environment (no jsdom/RTL — keeps the gate fast) with an in-memory fake,
// while the real app can simply call these functions with no `storage`
// argument and get `globalThis.localStorage` for free.

/**
 * The subset of the `Storage` interface these functions need. Matches the
 * real `localStorage`'s shape exactly, so `globalThis.localStorage` is
 * already a valid `StorageLike` with no adapting — this exists purely so
 * tests can pass an in-memory substitute instead.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Resolve which storage to use: an explicitly injected one (tests), or
 * `globalThis.localStorage` if the runtime has it (a real browser). Neither
 * vitest's `node` environment nor Safari private browsing (older versions)
 * guarantees the global exists, so `typeof` is the check — it never throws
 * for an undeclared/absent global, unlike a bare reference would.
 */
function resolveStorage(storage?: StorageLike): StorageLike | undefined {
  if (storage !== undefined) return storage;
  return typeof localStorage !== 'undefined' ? localStorage : undefined;
}

/** Read a key's raw string, tolerating an unavailable or throwing storage. */
function safeGet(store: StorageLike, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

/** Write a key's raw string, tolerating a throwing storage (quota, private-mode Safari, etc). */
function safeSet(store: StorageLike, key: string, value: string): boolean {
  try {
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Global settings — `cave.settings` (ui-plan §6 "Settings (FR-3.7)")
// ---------------------------------------------------------------------------

const SETTINGS_KEY = 'cave.settings';
export const SETTINGS_VERSION = 1;

/** `'system'` follows the OS via `prefers-color-scheme` (App.tsx's `SettingsProvider` owns the listener). */
export type ThemeSetting = 'dark' | 'light' | 'system';
const THEME_VALUES: readonly ThemeSetting[] = ['dark', 'light', 'system'];

/** Three steps, applied as `--text-scale` (theme.css) — see `TEXT_SCALE_BY_STEP` below. */
export type TextSizeSetting = 'small' | 'medium' | 'large';
const TEXT_SIZE_VALUES: readonly TextSizeSetting[] = ['small', 'medium', 'large'];

/** Reveal speed for the transcript's typewriter effect (T3/T5 consume this); `'instant'` is the default. */
export type TypewriterSpeedSetting = 'instant' | 'normal' | 'slow';
const TYPEWRITER_VALUES: readonly TypewriterSpeedSetting[] = ['instant', 'normal', 'slow'];

/**
 * `--text-scale` multipliers for the three text-size steps (task brief's own
 * example values). Lives here rather than in App.tsx/theme.css because it is
 * settings SEMANTICS (what "large" means), not layout — theme.css only
 * defines the token and its default of `1`.
 */
export const TEXT_SCALE_BY_STEP: Record<TextSizeSetting, number> = {
  small: 0.9,
  medium: 1,
  large: 1.15,
};

export interface Settings {
  version: number;
  theme: ThemeSetting;
  textSize: TextSizeSetting;
  /** ui-plan §6: hides the scene region, collapsing the shell to transcript + input (app.css `.shell--transcript-only`). */
  transcriptOnly: boolean;
  /**
   * The in-app "motion toggle" (ui-plan §6), independent of the OS-level
   * `prefers-reduced-motion` media query standing rule #3 already requires
   * every overlay/animation to respect — this is for a player who wants
   * calmer motion in THIS app without having to change an OS-wide setting.
   * T3 (typewriter) and T5 (lamplight flicker) are the consumers; this task
   * only persists and exposes it.
   */
  reduceMotion: boolean;
  typewriterSpeed: TypewriterSpeedSetting;
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  theme: 'dark',
  textSize: 'medium',
  transcriptOnly: false,
  reduceMotion: false,
  typewriterSpeed: 'instant',
};

/**
 * Validate an arbitrary parsed JSON value into a `Settings`, or fall back to
 * `DEFAULT_SETTINGS` on ANY mismatch — wrong version, missing field, wrong
 * type, or an enum value that isn't one of the known ones (e.g. a future
 * build's setting read by an older one, or hand-edited storage). No partial
 * recovery is attempted on purpose: tolerate-and-reset, not migrate.
 */
function parseSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SETTINGS;
  const candidate = raw as Record<string, unknown>;

  if (candidate.version !== SETTINGS_VERSION) return DEFAULT_SETTINGS;
  if (!isOneOf(candidate.theme, THEME_VALUES)) return DEFAULT_SETTINGS;
  if (!isOneOf(candidate.textSize, TEXT_SIZE_VALUES)) return DEFAULT_SETTINGS;
  if (typeof candidate.transcriptOnly !== 'boolean') return DEFAULT_SETTINGS;
  if (typeof candidate.reduceMotion !== 'boolean') return DEFAULT_SETTINGS;
  if (!isOneOf(candidate.typewriterSpeed, TYPEWRITER_VALUES)) return DEFAULT_SETTINGS;

  return {
    version: SETTINGS_VERSION,
    theme: candidate.theme,
    textSize: candidate.textSize,
    transcriptOnly: candidate.transcriptOnly,
    reduceMotion: candidate.reduceMotion,
    typewriterSpeed: candidate.typewriterSpeed,
  };
}

/** Load global settings, or `DEFAULT_SETTINGS` if storage is absent/unreadable/malformed/stale-versioned/wrong-shaped. */
export function loadSettings(storage?: StorageLike): Settings {
  const store = resolveStorage(storage);
  if (store === undefined) return DEFAULT_SETTINGS;

  const raw = safeGet(store, SETTINGS_KEY);
  if (raw === null) return DEFAULT_SETTINGS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }

  return parseSettings(parsed);
}

/** Persist global settings. Returns whether the write actually landed (mirrors `storage.ts`'s `writeSave`). */
export function saveSettings(settings: Settings, storage?: StorageLike): boolean {
  const store = resolveStorage(storage);
  if (store === undefined) return false;
  return safeSet(store, SETTINGS_KEY, JSON.stringify(settings));
}

// ---------------------------------------------------------------------------
// Per-adventure UI sidecar — `cave.<id>.ui` (ui-plan §8 layer 2)
// ---------------------------------------------------------------------------

function sidecarKeyFor(adventureId: string): string {
  return `cave.${adventureId}.ui`;
}

export const SIDECAR_VERSION = 1;

/**
 * Scaffolding for later tasks: T10 sets `onboardingSeen`, T7's journal Notes
 * tab reads/writes `journalNotes`, T6/T9 read/set `hardcore`. One JSON object
 * per adventure rather than one key per field — simpler to version and
 * tolerate-and-reset as a unit, and nothing here is large enough to need
 * finer-grained storage.
 */
export interface AdventureUiState {
  version: number;
  onboardingSeen: boolean;
  journalNotes: string;
  hardcore: boolean;
}

export const DEFAULT_SIDECAR: AdventureUiState = {
  version: SIDECAR_VERSION,
  onboardingSeen: false,
  journalNotes: '',
  hardcore: false,
};

/** Same tolerate-and-reset posture as `parseSettings` — see its comment. */
function parseSidecar(raw: unknown): AdventureUiState {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SIDECAR;
  const candidate = raw as Record<string, unknown>;

  if (candidate.version !== SIDECAR_VERSION) return DEFAULT_SIDECAR;
  if (typeof candidate.onboardingSeen !== 'boolean') return DEFAULT_SIDECAR;
  if (typeof candidate.journalNotes !== 'string') return DEFAULT_SIDECAR;
  if (typeof candidate.hardcore !== 'boolean') return DEFAULT_SIDECAR;

  return {
    version: SIDECAR_VERSION,
    onboardingSeen: candidate.onboardingSeen,
    journalNotes: candidate.journalNotes,
    hardcore: candidate.hardcore,
  };
}

/** Load `adventureId`'s UI sidecar, or `DEFAULT_SIDECAR` on any of the tolerate-and-reset conditions above. */
export function loadSidecar(adventureId: string, storage?: StorageLike): AdventureUiState {
  const store = resolveStorage(storage);
  if (store === undefined) return DEFAULT_SIDECAR;

  const raw = safeGet(store, sidecarKeyFor(adventureId));
  if (raw === null) return DEFAULT_SIDECAR;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_SIDECAR;
  }

  return parseSidecar(parsed);
}

/** Persist `adventureId`'s UI sidecar. Returns whether the write actually landed. */
export function saveSidecar(adventureId: string, sidecar: AdventureUiState, storage?: StorageLike): boolean {
  const store = resolveStorage(storage);
  if (store === undefined) return false;
  return safeSet(store, sidecarKeyFor(adventureId), JSON.stringify(sidecar));
}

/**
 * Set the per-adventure hardcore flag — the ONE write that decides a run's
 * mode (T9, ui-plan §12.2). Called exactly once per playthrough, by the
 * new-game flow, BEFORE the game mounts (Game reads the flag once at mount
 * and never re-reads it, so the mode is locked the instant play begins). A
 * read-modify-write so it never clobbers a note the player left in the same
 * sidecar object. There is deliberately no in-game path that flips it back:
 * "set at new-game and locked thereafter" is enforced by the absence of any
 * other caller, not by a guard here.
 */
export function setAdventureHardcore(adventureId: string, hardcore: boolean, storage?: StorageLike): boolean {
  const current = loadSidecar(adventureId, storage);
  return saveSidecar(adventureId, { ...current, hardcore }, storage);
}

/**
 * The examine-art to show for the CURRENT turn, derived from the transcript
 * tail (T-none: the item-art display feature, 2026-07-18). An `inspect`
 * event belongs to the newest turn exactly while no `command-echo` has
 * appeared after it — the next command of any kind reverts the scene panel
 * to the room, which is the whole "look at a painting, then put it down"
 * interaction. Pure derivation: no session field, nothing to reset on
 * undo/load (both append or replace transcript lines, which makes the scan
 * come up empty on its own).
 */
export function activeInspect(transcript: readonly OutputEvent[]): {
  artId: string;
  name: string;
} | null {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const entry = transcript[i];
    if (entry === undefined) continue;
    if (entry.kind === 'inspect') return { artId: entry.artId, name: entry.text };
    if (entry.kind === 'command-echo') return null;
  }
  return null;
}
