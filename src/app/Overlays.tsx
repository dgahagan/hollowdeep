import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

// The single overlay manager (T1, ui-plan §3). One piece of state — which
// overlay is open, or none — so "one overlay at a time" is structural rather
// than a rule every panel must remember. Later tasks (map T4, journal/hints
// T7, settings T2, help T10) register their content through <Overlay>; the
// keyboard shortcuts (T3) call `toggle` on this context.
//
// Focus trap, Esc-to-close, and background inertness come from the native
// `<dialog>.showModal()`, the same pattern SaveDialog.tsx established and for
// the same reason: the browser's modal machinery is the accessibility
// implementation NFR-5 asks for, not something to hand-roll. SaveDialog keeps
// its own <dialog> but routes its open/close through this manager's state
// ('saves'), so it still counts against one-at-a-time.

export type OverlayId = 'map' | 'journal' | 'hints' | 'settings' | 'saves' | 'help';

export interface OverlayApi {
  /** The currently open overlay, or null. */
  active: OverlayId | null;
  open: (id: OverlayId) => void;
  close: () => void;
  /** Open `id`, or close it if it is already the active overlay. */
  toggle: (id: OverlayId) => void;
}

const OverlayContext = createContext<OverlayApi | null>(null);

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<OverlayId | null>(null);

  const open = useCallback((id: OverlayId) => {
    setActive(id);
  }, []);
  const close = useCallback(() => {
    setActive(null);
  }, []);
  const toggle = useCallback((id: OverlayId) => {
    setActive((current) => (current === id ? null : id));
  }, []);

  const api = useMemo<OverlayApi>(() => ({ active, open, close, toggle }), [active, open, close, toggle]);

  return <OverlayContext.Provider value={api}>{children}</OverlayContext.Provider>;
}

export function useOverlays(): OverlayApi {
  const api = useContext(OverlayContext);
  if (api === null) {
    throw new Error('useOverlays must be used inside <OverlayProvider>');
  }
  return api;
}

export interface OverlayProps {
  /** Which manager slot this overlay occupies — it renders while `active === id`. */
  id: OverlayId;
  title: string;
  children: ReactNode;
}

/**
 * Shared chrome for a managed overlay: a native modal dialog with a titled
 * header and a close button. Mount it unconditionally; it shows itself while
 * its `id` is the active overlay.
 *
 * The open/close plumbing mirrors SaveDialog.tsx: `showModal()`/`close()`
 * follow the manager's state, and the native `close` event (Esc, form
 * submission) is listened to so the manager's state stays truthful when the
 * close was the browser's idea.
 */
export function Overlay({ id, title, children }: OverlayProps) {
  const { active, close } = useOverlays();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isActive = active === id;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (isActive && !dialog.open) dialog.showModal();
    else if (!isActive && dialog.open) dialog.close();
  }, [isActive]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return undefined;
    const handleClose = () => {
      close();
    };
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [close]);

  return (
    <dialog ref={dialogRef} className="overlay" aria-labelledby={`overlay-title-${id}`}>
      <header className="overlay__header">
        <h2 id={`overlay-title-${id}`}>{title}</h2>
        <button type="button" className="overlay__close" onClick={close} aria-label={`Close ${title}`}>
          ✕
        </button>
      </header>
      <div className="overlay__body">{isActive && children}</div>
    </dialog>
  );
}
