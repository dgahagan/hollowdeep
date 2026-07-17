import { useEffect, useRef, useState } from 'react';
import type { AdventureModule } from '../engine/schema';
import type { GameState } from '../engine/types';
import { loadGame, SaveError } from '../engine/save';
import { readSave, AUTOSAVE_SLOTS } from './storage';
import type { PendingDeath } from './useGame';

// The death modal (T6, ui-plan §5): on a non-hardcore death, a choice
// between two states that BOTH already exist — the engine's classic
// reincarnation (already applied by the time this renders) and the newest
// autosave written before the fall (the ring writes every turn, so "resume"
// is a load, not a mechanic). Dismissing by any route — button, Esc — is
// accepting reincarnation, because reincarnation is not an offer; it
// already happened. The modal never appears in hardcore (useGame suppresses
// `pendingDeath` there).
//
// It is its own native <dialog>, NOT an Overlays.tsx overlay: the manager's
// contract is "one overlay at a time, freely toggled by shortcuts", and a
// death is not something `m` should be able to replace with the map. Focus
// trap and Esc semantics still come from `showModal()`, same as everywhere.

/**
 * The per-death vignette (ui-plan §12's cross-plan addition; art-plan §9.3):
 * the death event's prose is the module string looked up verbatim from the
 * death effect's `messageId` (events.ts), so reversing text → id over
 * `module.strings` recovers the id with no engine surface added. The file
 * key strips the id's `-death` suffix — `chute-death` → `marquee-death-chute`
 * — matching art-plan's `marquee-death-*` naming. Phase B may land before or
 * after this code; a missing file (or unmatchable text, e.g. the engine's
 * bare "You have died." fallback) falls back to no image, silently.
 */
export function deathVignetteUrl(module: AdventureModule, deathText: string): string | null {
  const entry = Object.entries(module.strings).find(([, text]) => text === deathText);
  if (entry === undefined) return null;
  const key = entry[0].endsWith('-death') ? entry[0].slice(0, -'-death'.length) : entry[0];
  return `/adventures/${module.manifest.id}/art/marquee-death-${key}.${module.manifest.artFormat}`;
}

/**
 * The newest autosave strictly BEFORE the death turn, validated. The ring
 * writes every consumed turn including the fatal one, so the death turn
 * itself is in there — "before the fall" means `turn < deathTurn`, newest
 * first. A slot that fails to parse or load is skipped, not fatal: a rescue
 * offer built on a corrupt save would be crueller than none.
 */
export function newestAutosaveBefore(
  module: AdventureModule,
  deathTurn: number,
): { state: GameState; turn: number } | null {
  let best: { state: GameState; turn: number } | null = null;
  for (let index = 0; index < AUTOSAVE_SLOTS; index++) {
    const raw = readSave(module.manifest.id, 'auto', index);
    if (raw === undefined) continue;
    try {
      const state = loadGame(module, JSON.parse(raw));
      if (state.turn < deathTurn && (best === null || state.turn > best.turn)) {
        best = { state, turn: state.turn };
      }
    } catch (err) {
      if (err instanceof SaveError || err instanceof SyntaxError) continue;
      throw err;
    }
  }
  return best;
}

export interface DeathModalProps {
  module: AdventureModule;
  /** The death to present, or null for closed. */
  death: PendingDeath | null;
  /** Accept reincarnation: the engine already did it — dismiss and read on. */
  onAccept: () => void;
  /** Resume from before the fall: adopt the pre-death autosave (wired to `useGame`'s `load`). */
  onResume: (state: GameState) => void;
}

export function DeathModal({ module, death, onAccept, onResume }: DeathModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const open = death !== null;

  // The vignette hides for the session's current death once its file 404s —
  // keyed by the death's text so a DIFFERENT death gets a fresh try.
  const [failedVignette, setFailedVignette] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  // Esc fires the native cancel → close; accepting reincarnation is the
  // only thing dismissal can mean (see file header), so route it to onAccept.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return undefined;
    const handleClose = () => {
      if (death !== null) onAccept();
    };
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [death, onAccept]);

  const vignetteUrl = death !== null ? deathVignetteUrl(module, death.text) : null;
  const rescue = death !== null ? newestAutosaveBefore(module, death.deathTurn) : null;

  return (
    <dialog ref={dialogRef} className="death-modal" aria-labelledby="death-modal-title">
      {death !== null && (
        <>
          {vignetteUrl !== null && failedVignette !== death.text && (
            <img
              className="death-modal__vignette"
              src={vignetteUrl}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => {
                setFailedVignette(death.text);
              }}
            />
          )}
          <h2 id="death-modal-title">The cave has seen this before.</h2>
          <p className="death-modal__text">{death.text}</p>
          <div className="death-modal__choices">
            {/* No autoFocus — same reasoning as SaveDialog.tsx: `showModal()`
                already focuses the first focusable descendant, which is this
                button; the safe choice gets focus by position, not by prop. */}
            <button type="button" onClick={onAccept}>
              Accept reincarnation
            </button>
            <button
              type="button"
              disabled={rescue === null}
              onClick={() => {
                if (rescue !== null) onResume(rescue.state);
              }}
            >
              {rescue !== null ? `Resume from before the fall (turn ${rescue.turn})` : 'No earlier moment survives'}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
