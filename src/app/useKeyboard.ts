import { useEffect } from 'react';

// Global keyboard shortcuts (design plan §6, T26). Limited to exactly the
// three the plan names — `i` inventory focus, `l` look, `Ctrl+S` save dialog
// — the rest of FR-2.8 is explicitly deferred to Phase 3's panels (design
// plan §6's own note).
//
// **Must not fire while the command input has focus** (T26's acceptance
// criterion) — a player typing "light lamp" must not have the `l` land as a
// shortcut. The guard is a general "is the event target a text-entry
// control?" check rather than an id match against `CommandInput`'s specific
// `<input>`, so it also covers any other text field this app grows later
// without this file having to know about it.
//
// **`Ctrl+S`/`Cmd+S` is exempt from that guard, and the exemption is not a
// loophole — it is what the rule was protecting in the first place.** The
// hazard is a BARE LETTER also being a command: `l` in "light lamp" is
// exactly that collision. `Ctrl+S` cannot collide with typing — there is no
// way to type an `s` into the input with Ctrl held down, so the chord is
// never part of a command the player is composing. Blocking it anyway while
// the input is focused would not prevent a collision (there isn't one); it
// would just hand the keystroke to the browser's native "Save Page" dialog
// at the one moment — mid-command, input focused, which is the input's
// normal state (`CommandInput` autofocuses) — a player is most likely to
// reach for it. So the chord is checked, and `preventDefault()`'d, BEFORE
// the text-entry guard; only the bare-letter shortcuts (`l`, `i`) go through
// it.

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export interface KeyboardHandlers {
  /** `l` — look. */
  onLook: () => void;
  /** `i` — move focus to the inventory panel. */
  onInventoryFocus: () => void;
  /** `Ctrl+S` (or `Cmd+S`) — open the save dialog. */
  onOpenSaveDialog: () => void;
}

/** Attaches the shortcuts to `window` for the lifetime of the calling component. */
export function useKeyboard({ onLook, onInventoryFocus, onOpenSaveDialog }: KeyboardHandlers): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      // `Ctrl+S`/`Cmd+S` — checked BEFORE the text-entry guard and always
      // `preventDefault()`'d, focused input or not. See the file header: this
      // chord cannot collide with typing a command, so the guard that exists
      // to stop that collision has nothing to protect here — and skipping
      // `preventDefault()` when the input happens to be focused is exactly
      // what would hand the keystroke to the browser's native "Save Page"
      // dialog instead of this one.
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        onOpenSaveDialog();
        return;
      }

      if (isTextEntryTarget(event.target)) return;

      // Everything below is a bare letter — never hijack a browser/OS chord
      // that happens to also use that letter (Ctrl+L for the address bar, etc).
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === 'l' || event.key === 'L') {
        onLook();
        return;
      }
      if (event.key === 'i' || event.key === 'I') {
        onInventoryFocus();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onLook, onInventoryFocus, onOpenSaveDialog]);
}
