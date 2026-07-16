import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { AdventureModule } from '../engine/schema';
import type { GameState } from '../engine/types';
import { loadGame, saveGame, serializeSave, SaveError, type SaveErrorCode } from '../engine/save';
import { readSave, writeSave, deleteSave, type SaveKind, AUTOSAVE_SLOTS, NAMED_SLOTS } from './storage';

// Save/load dialog (design plan §6, T26; FR-5.1). Five named slots the
// player drives directly, plus a load/delete view of the autosave ring
// `useGame.ts` already writes to on every consumed turn (T24) — autosave has
// no "Save" button here because nothing about it is manual. No thumbnail: art
// is placeholder in this phase (T10 SVGs), and FR-5.1 only asks a row to show
// timestamp, location name, and score.
//
// Built on the native `<dialog>` element rather than a hand-rolled modal:
// `showModal()` supplies most of NFR-5's "usable by keyboard alone" for
// free — focus moves into the dialog on open, the background becomes inert,
// Tab cannot escape it, and Escape closes it by firing a `cancel` event that
// (left un-prevented) triggers the browser's own `close()`. This file listens
// for that `close` event so React's `open` state stays truthful even when the
// close was the browser's idea, not a click on this component's own button.

type SlotSummary =
  | { status: 'empty' }
  | { status: 'error'; code: SaveErrorCode; message: string; createdAt?: number }
  | { status: 'ok'; createdAt: number; locationName: string; score: number; state: GameState };

function readCreatedAt(parsed: unknown): number | undefined {
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const value = (parsed as Record<string, unknown>).createdAt;
  return typeof value === 'number' ? value : undefined;
}

/**
 * Read and validate one slot's raw JSON into something a row can render.
 * Never throws — a corrupted save (T21's typed `SaveError`) is data for this
 * row, not an exception for the app to crash on (T26's acceptance criterion).
 *
 * Calls `loadGame` directly rather than `deserializeSave`: the raw string is
 * already in hand (needed either way, to read the envelope's `createdAt`,
 * which the bare `GameState` `loadGame` returns does not carry), so parsing
 * it twice would buy nothing.
 */
function summarizeSlot(module: AdventureModule, raw: string | undefined): SlotSummary {
  if (raw === undefined) return { status: 'empty' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'error', code: 'malformed', message: 'This save is damaged and cannot be loaded.' };
  }

  // Best-effort timestamp even when the save goes on to fail validation — a
  // broken save is still worth telling the player WHEN it was made, if the
  // envelope survived enough to say.
  const createdAt = readCreatedAt(parsed);

  try {
    const state = loadGame(module, parsed);
    const location = module.locations.find((candidate) => candidate.id === state.locationId);
    return {
      status: 'ok',
      createdAt: createdAt ?? 0,
      locationName: location?.name ?? state.locationId,
      score: state.score,
      state,
    };
  } catch (err) {
    if (err instanceof SaveError) {
      // Switching on `.code` decided the outcome (this branch exists only
      // because `err instanceof SaveError`); `.message` is what a player
      // reads, which is exactly what save.ts wrote it for.
      return createdAt !== undefined
        ? { status: 'error', code: err.code, message: err.message, createdAt }
        : { status: 'error', code: err.code, message: err.message };
    }
    throw err;
  }
}

function formatTimestamp(ms: number): string {
  if (ms === 0) return 'unknown time';
  return new Date(ms).toLocaleString();
}

interface SlotRowProps {
  label: string;
  summary: SlotSummary;
  canSave: boolean;
  onSave: () => void;
  onLoad: (state: GameState) => void;
  onDelete: () => void;
  saveError: string | undefined;
}

function SlotRow({ label, summary, canSave, onSave, onLoad, onDelete, saveError }: SlotRowProps) {
  return (
    <li className="save-dialog__row">
      <div className="save-dialog__row-main">
        <span className="save-dialog__row-label">{label}</span>
        {summary.status === 'empty' && <span className="save-dialog__row-detail">Empty</span>}
        {summary.status === 'error' && (
          <span className="save-dialog__row-detail save-dialog__row-detail--error">
            {summary.message}
            {summary.createdAt !== undefined && ` (${formatTimestamp(summary.createdAt)})`}
          </span>
        )}
        {summary.status === 'ok' && (
          <span className="save-dialog__row-detail">
            {formatTimestamp(summary.createdAt)} · {summary.locationName} · score {summary.score}
          </span>
        )}
        {saveError !== undefined && (
          <span className="save-dialog__row-detail save-dialog__row-detail--error">{saveError}</span>
        )}
      </div>
      <div className="save-dialog__row-actions">
        {canSave && (
          <button type="button" onClick={onSave}>
            Save
          </button>
        )}
        {summary.status === 'ok' && (
          <button
            type="button"
            onClick={() => {
              onLoad(summary.state);
            }}
          >
            Load
          </button>
        )}
        {summary.status !== 'empty' && (
          <button type="button" onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

export interface SaveDialogProps {
  open: boolean;
  module: AdventureModule;
  /** The live game state — what a click on a named slot's "Save" button writes. */
  state: GameState;
  /** Adopt a loaded state (wired to `useGame`'s `load`). Called with the row's validated `GameState`. */
  onLoad: (state: GameState) => void;
  onClose: () => void;
}

export function SaveDialog({ open, module, state, onLoad, onClose }: SaveDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // `storage.ts` is a plain synchronous adapter with no subscription
  // mechanism of its own — the rows below are computed fresh from
  // `localStorage` in the render body every render, so all this needs is a
  // reason to RE-render after a write/delete. A `useReducer` counter with no
  // named value (the state itself is unused, only the trigger matters) is
  // that reason without inventing a variable ESLint would flag as unread.
  const [, forceRerender] = useReducer((n: number) => n + 1, 0);
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});

  // Open/close the native dialog to match the `open` prop.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  // The browser can close the dialog on its own (Escape → `cancel` →
  // `close`) without this component's `onClose` ever being called — this
  // listener is what keeps `open` truthful afterward.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const handleClose = () => {
      onClose();
    };
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  const handleSave = useCallback(
    (index: number): void => {
      const blob = saveGame(module, state, Date.now());
      const ok = writeSave(module.manifest.id, 'slot', index, serializeSave(blob));
      const key = `slot:${index}`;
      setSaveErrors((previous) => {
        if (ok) {
          if (!(key in previous)) return previous;
          const next = { ...previous };
          delete next[key];
          return next;
        }
        return { ...previous, [key]: 'Save failed — storage may be full or unavailable.' };
      });
      forceRerender();
    },
    [module, state],
  );

  function handleDelete(kind: SaveKind, index: number): void {
    deleteSave(module.manifest.id, kind, index);
    forceRerender();
  }

  const slotRows = Array.from({ length: NAMED_SLOTS }, (_unused, index) => {
    const raw = readSave(module.manifest.id, 'slot', index);
    const summary = summarizeSlot(module, raw);
    return (
      <SlotRow
        key={`slot-${index}`}
        label={`Slot ${index + 1}`}
        summary={summary}
        canSave
        onSave={() => {
          handleSave(index);
        }}
        onLoad={onLoad}
        onDelete={() => {
          handleDelete('slot', index);
        }}
        saveError={saveErrors[`slot:${index}`]}
      />
    );
  });

  const autoRows = Array.from({ length: AUTOSAVE_SLOTS }, (_unused, index) => {
    const raw = readSave(module.manifest.id, 'auto', index);
    const summary = summarizeSlot(module, raw);
    const label = summary.status === 'ok' ? `Autosave — turn ${summary.state.turn}` : `Autosave ${index + 1}`;
    return (
      <SlotRow
        key={`auto-${index}`}
        label={label}
        summary={summary}
        canSave={false}
        onSave={() => {
          /* no-op: the autosave ring has no manual "Save" — useGame.ts writes it every turn */
        }}
        onLoad={onLoad}
        onDelete={() => {
          handleDelete('auto', index);
        }}
        saveError={undefined}
      />
    );
  });

  return (
    <dialog ref={dialogRef} className="save-dialog" aria-labelledby="save-dialog-title">
      <h2 id="save-dialog-title">Save &amp; load</h2>

      <section aria-label="Named save slots">
        <h3>Slots</h3>
        <ul className="save-dialog__list">{slotRows}</ul>
      </section>

      <section aria-label="Autosaves">
        <h3>Autosaves</h3>
        <ul className="save-dialog__list">{autoRows}</ul>
      </section>

      {/* No explicit autoFocus here: React implements it by imperatively
          calling `.focus()` on mount, which for this always-rendered-but-
          hidden dialog happens once at page load, long before `showModal()`
          is ever called — so it would not do what it looks like it does.
          `showModal()` itself already moves focus to the dialog's first
          focusable descendant (a slot's "Save" button) every time it opens,
          which is real, correctly-timed focus management and needs no help. */}
      <div className="save-dialog__footer">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}
