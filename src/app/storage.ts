// The `localStorage` adapter (design plan §6, T24).
//
// Deliberately thin: this file knows the KEY SCHEME and how to survive a
// browser that refuses to write, and nothing about game rules. It reads and
// writes STRINGS — the engine's `serializeSave`/`deserializeSave` (save.ts)
// own the shape of what's inside them. Keeping game logic out of here is the
// point: a redesign of the save format should never have to touch this file,
// and this file's failure modes should never have to know what a `GameState`
// is.
//
// This is also why it lives in `src/app/`, not `src/engine/`: `localStorage`
// is a browser global, and `eslint.config.js`'s engine-purity override
// (`ENGINE_FILES`) blocks it under `src/engine/**`/`src/loader.ts` on
// purpose (design plan §3, exit criterion #4).
//
// **Writes must not throw.** `localStorage.setItem` throws in Safari private
// browsing and on quota-exceeded — and a save failure must not take the game
// down with it (T24's brief). Every write here is caught and reported as a
// boolean; a failed autosave costs recoverability for that one turn, not the
// turn itself.

/** Key scheme: `cave.<adventureId>.slot.<n>` and `cave.<adventureId>.auto.<n>` (design plan §6). */
export type SaveKind = 'slot' | 'auto';

/** Size of the autosave ring (FR-5.2) — 5 slots, oldest overwritten. */
export const AUTOSAVE_SLOTS = 5;

/** Number of named save slots (FR-5.1). */
export const NAMED_SLOTS = 5;

function keyFor(adventureId: string, kind: SaveKind, index: number): string {
  return `cave.${adventureId}.${kind}.${index}`;
}

/**
 * Is `localStorage` there and usable at all? Private browsing in older
 * Safari removes the global entirely rather than throwing on use; this is
 * the one check that has to happen before touching it at all.
 */
function hasLocalStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

/** Read a saved slot's raw JSON, or `undefined` if absent, unreadable, or storage is unavailable. */
export function readSave(adventureId: string, kind: SaveKind, index: number): string | undefined {
  if (!hasLocalStorage()) return undefined;
  try {
    return localStorage.getItem(keyFor(adventureId, kind, index)) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Write a slot's raw JSON. Returns whether it actually landed — the caller
 * decides what a failed write means (an autosave just tries again next turn;
 * an explicit "Save" click should tell the player).
 */
export function writeSave(adventureId: string, kind: SaveKind, index: number, data: string): boolean {
  if (!hasLocalStorage()) return false;
  try {
    localStorage.setItem(keyFor(adventureId, kind, index), data);
    return true;
  } catch {
    return false;
  }
}

/** Delete a slot. A missing slot or unavailable storage is not an error — there is simply nothing there afterward either way. */
export function deleteSave(adventureId: string, kind: SaveKind, index: number): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.removeItem(keyFor(adventureId, kind, index));
  } catch {
    // Nothing to do — the slot is unreadable either way.
  }
}

/**
 * Convenience wrapper: write into the autosave ring at `turn % AUTOSAVE_SLOTS`.
 * `turn` is always a non-negative integer (`GameState.turn`, engine
 * types.ts), so plain modulo is the ring index — turn 0..4 fill the ring,
 * turn 5 overwrites the slot from turn 0, and so on.
 */
export function writeAutosave(adventureId: string, turn: number, data: string): boolean {
  return writeSave(adventureId, 'auto', turn % AUTOSAVE_SLOTS, data);
}

/** Every populated slot of `kind`, as `{index, data}`, in index order — for a save dialog to list. */
export function listSaves(adventureId: string, kind: SaveKind, count: number): Array<{ index: number; data: string }> {
  const found: Array<{ index: number; data: string }> = [];
  for (let index = 0; index < count; index++) {
    const data = readSave(adventureId, kind, index);
    if (data !== undefined) found.push({ index, data });
  }
  return found;
}
