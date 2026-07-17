import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { AdventureModule } from '../engine/schema';
import type { GameState } from '../engine/types';
import { describeScene } from '../engine/view';
import { loadGame, saveGame, SaveError, type SaveErrorCode } from '../engine/save';
import {
  readSave,
  writeSave,
  deleteSave,
  wrapSlot,
  parseSlotPayload,
  type SaveKind,
  AUTOSAVE_SLOTS,
  NAMED_SLOTS,
} from './storage';

// Save/load dialog (design plan §6, T26; FR-5.1. T8, ui-plan §6, extends it
// with slot metadata, thumbnails, and export/import — FR-5.3/5.4). Five
// named slots the player drives directly, plus a load/delete view of the
// autosave ring `useGame.ts` already writes to on every consumed turn
// (T24) — autosave has no "Save" button here because nothing about it is
// manual, and (T8) no "Export"/"Import" either, for the same reason: those
// actions are about a payload the PLAYER composed by choosing to save, and
// the autosave ring is not that.
//
// Built on the native `<dialog>` element rather than a hand-rolled modal:
// `showModal()` supplies most of NFR-5's "usable by keyboard alone" for
// free — focus moves into the dialog on open, the background becomes inert,
// Tab cannot escape it, and Escape closes it by firing a `cancel` event that
// (left un-prevented) triggers the browser's own `close()`. This file listens
// for that `close` event so React's `open` state stays truthful even when the
// close was the browser's idea, not a click on this component's own button.
//
// **T8's envelope discipline (cross-task note 5).** Named slots are now
// written as `storage.ts`'s `SlotEnvelope` — a wrapper carrying a
// timestamp/location/score/artId captured AT SAVE TIME, around the engine's
// opaque `SaveBlob`. `parseSlotPayload` is the seam that lets this file read
// BOTH that new shape AND every raw engine save that predates it (a pre-T8
// named slot, or any autosave row — the ring stays raw FOREVER, per
// storage.ts's header) without a special case per caller — `summarizeSlot`
// below asks it once and branches on `.kind`, and everything downstream
// (rendering, Load, Export) works off `SlotSummary` either way.

type SlotSummary =
  | { status: 'empty' }
  | { status: 'error'; code: SaveErrorCode; message: string; createdAt?: number }
  | {
      status: 'ok';
      createdAt: number;
      locationName: string;
      score: number;
      /** Absent when the room was dark at save time (view.ts omits `artId` on purpose) — no thumbnail is correct, not a gap. */
      artId?: string;
      state: GameState;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read and validate one slot's raw JSON into something a row can render.
 * Never throws — a corrupted save (T21's typed `SaveError`) is data for this
 * row, not an exception for the app to crash on (T26's acceptance criterion).
 *
 * Routes through `parseSlotPayload` (storage.ts) first so an ENVELOPED slot
 * (T8's `wrapSlot`) can hand back its captured metadata directly — no need
 * to re-derive a location name or score the player already saw once — while
 * a RAW slot (every autosave, or a named slot saved before T8) falls back
 * to deriving them mechanically from the validated `GameState`, exactly as
 * this function did before T8. `describeScene` supplies the thumbnail
 * `artId` for that raw path only; an enveloped slot's `artId` was already
 * captured at save time and travels with the envelope.
 */
function summarizeSlot(module: AdventureModule, raw: string | undefined): SlotSummary {
  if (raw === undefined) return { status: 'empty' };

  const payload = parseSlotPayload(raw);
  if (payload.kind === 'invalid') {
    return { status: 'error', code: 'malformed', message: payload.message };
  }

  // Best-effort timestamp even when the save goes on to fail validation — a
  // broken save is still worth telling the player WHEN it was made, if the
  // payload survived enough to say. Enveloped slots captured this at save
  // time; a raw slot's timestamp (if any) lives on the unvalidated engine
  // `SaveBlob` itself, read loosely since `loadGame` hasn't run yet.
  const createdAtHint =
    payload.kind === 'envelope'
      ? payload.envelope.createdAt
      : isRecord(payload.engineSave) && typeof payload.engineSave.createdAt === 'number'
        ? payload.engineSave.createdAt
        : undefined;

  const engineSave = payload.kind === 'envelope' ? payload.envelope.engineSave : payload.engineSave;

  try {
    const state = loadGame(module, engineSave);

    if (payload.kind === 'envelope') {
      const { envelope } = payload;
      return {
        status: 'ok',
        createdAt: envelope.createdAt,
        locationName: envelope.locationName,
        score: envelope.score,
        ...(envelope.artId !== undefined ? { artId: envelope.artId } : {}),
        state,
      };
    }

    const location = module.locations.find((candidate) => candidate.id === state.locationId);
    const artId = describeScene(module, state).artId;
    return {
      status: 'ok',
      createdAt: createdAtHint ?? 0,
      locationName: location?.name ?? state.locationId,
      score: state.score,
      ...(artId !== undefined ? { artId } : {}),
      state,
    };
  } catch (err) {
    if (err instanceof SaveError) {
      // Switching on `.code` decided the outcome (this branch exists only
      // because `err instanceof SaveError`); `.message` is what a player
      // reads, which is exactly what save.ts wrote it for.
      return createdAtHint !== undefined
        ? { status: 'error', code: err.code, message: err.message, createdAt: createdAtHint }
        : { status: 'error', code: err.code, message: err.message };
    }
    throw err;
  }
}

function formatTimestamp(ms: number): string {
  if (ms === 0) return 'unknown time';
  return new Date(ms).toLocaleString();
}

/** Same `<artId>.<format>` convention `ScenePanel.tsx` renders with — kept in sync deliberately, not re-derived from it (that file is out of T8's scope). */
function thumbnailUrl(module: AdventureModule, artId: string): string {
  return `/adventures/${module.manifest.id}/art/${artId}.${module.manifest.artFormat}`;
}

function downloadJson(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Validate an imported file's text against the CURRENT module before it is
 * ever written anywhere. This is the whole of FR-5.3/5.4's "never silent
 * corruption" for imports: a save for a different adventure, a future save
 * format, or plain garbage all fail HERE, as a typed message, before
 * `writeSave` is ever called — so a bad import can never land in storage,
 * let alone cross an adventure's namespace (the namespace it would land in
 * is always `module.manifest.id`, never anything read out of the file).
 */
function validateImport(module: AdventureModule, raw: string): { ok: true } | { ok: false; message: string } {
  const payload = parseSlotPayload(raw);
  if (payload.kind === 'invalid') return { ok: false, message: payload.message };
  try {
    loadGame(module, payload.kind === 'envelope' ? payload.envelope.engineSave : payload.engineSave);
    return { ok: true };
  } catch (err) {
    if (err instanceof SaveError) return { ok: false, message: err.message };
    throw err;
  }
}

interface SlotRowProps {
  label: string;
  summary: SlotSummary;
  module: AdventureModule;
  canSave: boolean;
  /** Export/import are a NAMED-slot affordance only (see file header) — false hides both controls for autosave rows. */
  canImportExport: boolean;
  onSave: () => void;
  onLoad: (state: GameState) => void;
  onDelete: () => void;
  onExport: () => void;
  onImportFile: (file: File) => void;
  /** Set while an import into an OCCUPIED slot awaits confirmation ("empty-or-confirmed"). */
  pendingImport: boolean;
  onConfirmImport: () => void;
  onCancelImport: () => void;
  rowError: string | undefined;
}

function SlotRow({
  label,
  summary,
  module,
  canSave,
  canImportExport,
  onSave,
  onLoad,
  onDelete,
  onExport,
  onImportFile,
  pendingImport,
  onConfirmImport,
  onCancelImport,
  rowError,
}: SlotRowProps) {
  // Two-step delete confirm (T8) — no `window.confirm`: the button itself
  // flips to a confirm/cancel pair. Reset whenever the underlying slot's
  // summary changes (a save/delete/import elsewhere re-renders this row
  // with a different one), so a stale "Really delete?" never lingers over a
  // slot it no longer describes. This is "adjusting state during render"
  // (React's own sanctioned pattern for resetting state when an input
  // changes), not an effect — calling `setState` synchronously inside a
  // `useEffect` body here would just add a redundant extra render.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [summaryAtLastRender, setSummaryAtLastRender] = useState(summary);
  if (summary !== summaryAtLastRender) {
    setSummaryAtLastRender(summary);
    setConfirmingDelete(false);
  }

  const importInputRef = useRef<HTMLInputElement>(null);

  // Placeholder-tolerant the same way DeathModal/ScenePanel are: a 404
  // hides the thumbnail rather than showing a broken-image icon. Keyed by
  // the URL so a different save loaded into this slot gets a fresh attempt.
  const art = summary.status === 'ok' && summary.artId !== undefined ? thumbnailUrl(module, summary.artId) : undefined;
  const [failedThumbnail, setFailedThumbnail] = useState<string | null>(null);

  return (
    <li className="save-dialog__row">
      {art !== undefined && failedThumbnail !== art && (
        <img
          src={art}
          alt=""
          width={64}
          height={36}
          loading="lazy"
          decoding="async"
          style={{
            width: '64px',
            height: '36px',
            objectFit: 'cover',
            borderRadius: '3px',
            flexShrink: 0,
            border: '1px solid var(--border)',
          }}
          onError={() => {
            setFailedThumbnail(art);
          }}
        />
      )}
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
        {rowError !== undefined && <span className="save-dialog__row-detail save-dialog__row-detail--error">{rowError}</span>}
      </div>
      <div className="save-dialog__row-actions">
        {pendingImport ? (
          // "Empty-or-confirmed" (T8): this slot already holds something and
          // an import is staged — nothing was written when the file was
          // picked, and nothing is written now until the player says so a
          // second time.
          <>
            <span className="save-dialog__row-detail save-dialog__row-detail--error">Overwrite with imported save?</span>
            <button type="button" onClick={onConfirmImport}>
              Really import
            </button>
            <button type="button" onClick={onCancelImport}>
              Cancel
            </button>
          </>
        ) : (
          <>
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
            {canImportExport && summary.status === 'ok' && (
              <button type="button" onClick={onExport}>
                Export
              </button>
            )}
            {canImportExport && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    importInputRef.current?.click();
                  }}
                >
                  Import…
                </button>
                <input
                  ref={importInputRef}
                  type="file"
                  accept="application/json,.json"
                  style={{ display: 'none' }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file !== undefined) onImportFile(file);
                  }}
                />
              </>
            )}
            {summary.status !== 'empty' &&
              (confirmingDelete ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingDelete(false);
                      onDelete();
                    }}
                  >
                    Really delete?
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingDelete(false);
                    }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingDelete(true);
                  }}
                >
                  Delete
                </button>
              ))}
          </>
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
  /**
   * T6, ui-plan §5: hardcore hides the autosave ring MID-RUN (App passes
   * `hardcore && !ended`). The ring is still written every turn —
   * resume-after-tab-close is not a rescue — but surfacing it here would
   * be the death-rescue flow with extra steps. After game over the ring
   * reappears; there is nothing left to rescue.
   */
  hideAutosaves?: boolean;
}

export function SaveDialog({ open, module, state, onLoad, onClose, hideAutosaves = false }: SaveDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // `storage.ts` is a plain synchronous adapter with no subscription
  // mechanism of its own — the rows below are computed fresh from
  // `localStorage` in the render body every render, so all this needs is a
  // reason to RE-render after a write/delete. A `useReducer` counter with no
  // named value (the state itself is unused, only the trigger matters) is
  // that reason without inventing a variable ESLint would flag as unread.
  const [, forceRerender] = useReducer((n: number) => n + 1, 0);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  // At most one slot's import awaits confirmation at a time — the dialog is
  // modal, so only one file picker can be mid-flow anyway.
  const [pendingImport, setPendingImport] = useState<{ index: number; raw: string } | null>(null);

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

  const setRowError = useCallback((key: string, message: string | undefined) => {
    setRowErrors((previous) => {
      if (message === undefined) {
        if (!(key in previous)) return previous;
        const next = { ...previous };
        delete next[key];
        return next;
      }
      return { ...previous, [key]: message };
    });
  }, []);

  const handleSave = useCallback(
    (index: number): void => {
      const createdAt = Date.now();
      const blob = saveGame(module, state, createdAt);
      const location = module.locations.find((candidate) => candidate.id === state.locationId);
      const artId = describeScene(module, state).artId;
      const envelope = wrapSlot({
        createdAt,
        locationName: location?.name ?? state.locationId,
        score: state.score,
        ...(artId !== undefined ? { artId } : {}),
        engineSave: blob,
      });
      const ok = writeSave(module.manifest.id, 'slot', index, JSON.stringify(envelope));
      setRowError(`slot:${index}`, ok ? undefined : 'Save failed — storage may be full or unavailable.');
      forceRerender();
    },
    [module, state, setRowError],
  );

  function handleDelete(kind: SaveKind, index: number): void {
    deleteSave(module.manifest.id, kind, index);
    setRowError(`${kind}:${index}`, undefined);
    forceRerender();
  }

  function handleExport(index: number): void {
    const raw = readSave(module.manifest.id, 'slot', index);
    if (raw === undefined) return; // export button only renders for an 'ok' summary; this guards a stale click racing a delete
    downloadJson(`${module.manifest.id}-slot-${index + 1}.json`, raw);
  }

  /**
   * Import into a NAMED slot (canImportExport is slot-only — see file
   * header). Validates against the CURRENT `module` before anything is
   * written (`validateImport`), so a version mismatch or a save for the
   * other adventure surfaces its `SaveError` message right here and never
   * touches storage. An occupied slot stages the write and waits for a
   * second click (`pendingImport`); an empty one writes immediately —
   * "empty-or-confirmed" per the task brief.
   */
  const handleImportFile = useCallback(
    (index: number, file: File): void => {
      void file.text().then((raw) => {
        const key = `slot:${index}`;
        const result = validateImport(module, raw);
        if (!result.ok) {
          setRowError(key, result.message);
          return;
        }
        setRowError(key, undefined);
        const occupied = readSave(module.manifest.id, 'slot', index) !== undefined;
        if (occupied) {
          setPendingImport({ index, raw });
        } else {
          writeSave(module.manifest.id, 'slot', index, raw);
          forceRerender();
        }
      });
    },
    [module, setRowError],
  );

  const slotRows = Array.from({ length: NAMED_SLOTS }, (_unused, index) => {
    const raw = readSave(module.manifest.id, 'slot', index);
    const summary = summarizeSlot(module, raw);
    return (
      <SlotRow
        key={`slot-${index}`}
        label={`Slot ${index + 1}`}
        summary={summary}
        module={module}
        canSave
        canImportExport
        onSave={() => {
          handleSave(index);
        }}
        onLoad={onLoad}
        onDelete={() => {
          handleDelete('slot', index);
        }}
        onExport={() => {
          handleExport(index);
        }}
        onImportFile={(file) => {
          handleImportFile(index, file);
        }}
        pendingImport={pendingImport?.index === index}
        onConfirmImport={() => {
          if (pendingImport === null || pendingImport.index !== index) return;
          writeSave(module.manifest.id, 'slot', index, pendingImport.raw);
          setPendingImport(null);
          forceRerender();
        }}
        onCancelImport={() => {
          setPendingImport(null);
        }}
        rowError={rowErrors[`slot:${index}`]}
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
        module={module}
        canSave={false}
        canImportExport={false}
        onSave={() => {
          /* no-op: the autosave ring has no manual "Save" — useGame.ts writes it every turn */
        }}
        onLoad={onLoad}
        onDelete={() => {
          handleDelete('auto', index);
        }}
        onExport={() => {
          /* unreachable: canImportExport is false for autosave rows */
        }}
        onImportFile={() => {
          /* unreachable: autosaves are never import targets — see file header */
        }}
        pendingImport={false}
        onConfirmImport={() => {
          /* unreachable: pendingImport is always false for autosaves */
        }}
        onCancelImport={() => {
          /* unreachable: pendingImport is always false for autosaves */
        }}
        rowError={undefined}
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

      {!hideAutosaves && (
        <section aria-label="Autosaves">
          <h3>Autosaves</h3>
          <ul className="save-dialog__list">{autoRows}</ul>
        </section>
      )}

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
