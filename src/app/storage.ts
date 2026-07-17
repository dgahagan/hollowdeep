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

// ─────────────────────────────────────────────────────────────────────────────
// The slot metadata envelope (T8, ui-plan §6; cross-task note 5).
//
// A UI-side wrapper around the engine's OPAQUE save payload (`SaveBlob`,
// `src/engine/save.ts`). "Opaque" is load-bearing, not decoration: this file
// never parses, validates, or migrates `engineSave` — that is `loadGame`'s
// job, forever, and duplicating any of it here would be a second place a
// save-format change could go stale. All this envelope adds is metadata a
// save DIALOG wants to show WITHOUT loading the whole state through the
// engine's schema first: a timestamp, a location name, a score, and the
// scene `artId` captured at save time (for a thumbnail).
//
// **Only NAMED slots get envelopes.** The autosave ring stays RAW engine
// saves on purpose — `useGame.ts` writes it every consumed turn and
// `DeathModal.tsx` reads it via `loadGame` directly, and neither file is in
// this task's scope (T8's file list). `parseSlotPayload` below is exactly
// the seam that lets both worlds coexist: a raw engine save (the autosave
// ring, or any named slot saved before this task shipped) parses as
// `{kind: 'raw'}`, and only a slot actually written by the new `handleSave`
// path parses as `{kind: 'envelope'}`. Nothing upstream of this file has to
// know which one it is looking at until it asks.

/** Bumped only if the ENVELOPE's own shape changes — independent of `SAVE_VERSION` (save.ts), which is the engine's. */
export const SLOT_ENVELOPE_VERSION = 1;

/**
 * The envelope written for a NAMED slot. `engineSave` is deliberately typed
 * `unknown` — the one honest type for a payload this file promises never to
 * look inside (see file-section header above). Whatever validates it
 * (`loadGame`) already exists in `src/engine/save.ts`; re-typing it here
 * would just be a second, driftable claim about the same shape.
 */
export interface SlotEnvelope {
  envelopeVersion: typeof SLOT_ENVELOPE_VERSION;
  /** Unix ms, read once at save time — the same clock read used to build the wrapped `SaveBlob`. */
  createdAt: number;
  /** The location's display name at save time (for the slot card — no need to reload the state to show it). */
  locationName: string;
  score: number;
  /** The scene's `artId` at save time, for a thumbnail — absent when the room was dark (view.ts omits it; that is correct, not a gap). */
  artId?: string;
  /** The engine's own `SaveBlob` (save.ts), carried opaquely. Validate it with `loadGame`; never read a field off it here. */
  engineSave: unknown;
}

/**
 * Build a slot envelope. Pure — no `localStorage`, no clock read (the
 * caller supplies `createdAt`, same discipline as `saveGame` itself takes
 * with its own `createdAt` parameter). `JSON.stringify` on the result is the
 * whole serialization step; there is no bespoke encoding to keep in sync.
 */
export function wrapSlot(params: {
  createdAt: number;
  locationName: string;
  score: number;
  artId?: string;
  engineSave: unknown;
}): SlotEnvelope {
  return {
    envelopeVersion: SLOT_ENVELOPE_VERSION,
    createdAt: params.createdAt,
    locationName: params.locationName,
    score: params.score,
    ...(params.artId !== undefined ? { artId: params.artId } : {}),
    engineSave: params.engineSave,
  };
}

/**
 * What `parseSlotPayload` found. Three shapes, not two — a corrupted file is
 * data for a save dialog to display, never a thrown exception (FR-5.3/5.4:
 * "never silent corruption" cuts both ways — it also means never a crash).
 *
 *   - `envelope` — a slot this task's `wrapSlot` wrote. `engineSave` still
 *     needs `loadGame` before it is a `GameState`; only the metadata fields
 *     are free.
 *   - `raw` — no envelope at all: the autosave ring (by design, forever) or
 *     a named slot saved before this task shipped (by history, until it is
 *     next overwritten). `engineSave` is the parsed JSON value as-is,
 *     unvalidated — exactly what pre-T8 callers already handed `loadGame`
 *     directly.
 *   - `invalid` — not parseable JSON at all.
 */
export type SlotParseResult =
  | { kind: 'envelope'; envelope: SlotEnvelope }
  | { kind: 'raw'; engineSave: unknown }
  | { kind: 'invalid'; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse one slot's raw JSON string (from `localStorage` or an imported
 * file) into an envelope, a raw engine save, or an explained failure.
 * Never throws — `JSON.parse` is the only thing here that can, and it is
 * caught.
 *
 * The envelope test is a single field (`envelopeVersion`), deliberately: a
 * raw engine `SaveBlob` (save.ts) has no such field, so its absence is
 * exactly the "not enveloped" signal, and this file does not need to know
 * `SaveBlob`'s shape (`saveVersion`, `engineVersion`, ...) to tell the two
 * apart. That is what keeps this file honestly ignorant of the engine save
 * format, per the header comment.
 */
export function parseSlotPayload(raw: string): SlotParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'invalid', message: 'This save is damaged and cannot be loaded.' };
  }

  if (isPlainObject(parsed) && parsed.envelopeVersion === SLOT_ENVELOPE_VERSION) {
    const { createdAt, locationName, score, artId, engineSave } = parsed;
    const shapeOk =
      typeof createdAt === 'number' &&
      typeof locationName === 'string' &&
      typeof score === 'number' &&
      (artId === undefined || typeof artId === 'string') &&
      engineSave !== undefined;
    if (!shapeOk) {
      return { kind: 'invalid', message: 'This save is damaged and cannot be loaded.' };
    }
    return {
      kind: 'envelope',
      envelope: {
        envelopeVersion: SLOT_ENVELOPE_VERSION,
        createdAt,
        locationName,
        score,
        ...(typeof artId === 'string' ? { artId } : {}),
        engineSave,
      },
    };
  }

  // No `envelopeVersion` field at all: a legacy named slot or the (always
  // raw, by design) autosave ring. Pass the parsed value through unvalidated
  // — `loadGame` is the only thing entitled to say whether it is a real
  // `SaveBlob`.
  return { kind: 'raw', engineSave: parsed };
}
