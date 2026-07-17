import type { AdventureModule } from '../engine/schema';
import type { GameState } from '../engine/types';
import { Overlay } from './Overlays';
import { revealedHintLadders } from './journal';

// The Hints overlay (T7, ui-plan §6 "Hints (FR-7.2 UI)"): a VIEW of the
// `hint` verb, never a second hint mechanic. Two rules the panel exists to
// honor, both stated in the plan and worth restating here because getting
// either wrong would quietly reintroduce a second hint system:
//
//   1. Nothing unrevealed is EVER listed. `revealedHintLadders` (journal.ts,
//      shared with the Journal's own "hints taken" section — one derivation,
//      two views) only returns ladders with `rungsRevealed > 0`. Whether a
//      NEXT rung exists right now is a selection decision (document order,
//      `when` conditions, `chance` draws) that lives entirely in
//      `hintHandler` (`engine/actions/meta.ts`) — reimplementing any part of
//      that here would be exactly the "second hint mechanic" the plan rules
//      out.
//   2. There is exactly one button, and clicking it submits the string
//      `"hint"` through the SAME input path a typed command takes (FR-2.7:
//      "clicks echo commands") — `submit` is `useGame`'s own write function,
//      the identical prop `ActionBar`/`InventoryPanel` already use under the
//      name `onAction`. The engine decides what happens next: a new rung
//      revealed, or `noHintMessageId` printed to the transcript because
//      nothing is available. This panel does not pre-empt that decision by
//      graying out or hiding the button — doing so WOULD be reimplementing
//      selection, just in a different place.
//
// The panel's OWN empty state — "nothing revealed yet" — is a different
// thing from "no hint available right now": it is simply what
// `revealedHintLadders` returns before the player has ever asked, and it
// borrows the adventure's own `noHintMessageId` line (`hints.json`) so the
// panel's silence and the verb's silence read as the same voice.

export interface HintsPanelProps {
  module: AdventureModule;
  state: GameState;
  /** `useGame`'s write path (ui-plan §6, FR-2.7) — the SAME function `submit`s a typed command. */
  submit: (command: string) => void;
}

export function HintsPanel({ module, state, submit }: HintsPanelProps) {
  const ladders = revealedHintLadders(module, state);
  const noHintText = module.strings[module.hints.noHintMessageId] ?? '';

  return (
    <Overlay id="hints" title="Hints">
      <div className="hints-panel">
        {ladders.length === 0 ? (
          <p className="hints-panel__empty">{noHintText}</p>
        ) : (
          <div className="hints-panel__ladders">
            {ladders.map((ladder) => (
              <section key={ladder.id} className="hints-panel__ladder">
                <h3>{ladder.title}</h3>
                <ol className="hints-panel__rungs">
                  {/* Index-as-key: a fixed, ordered ladder authored once in
                      `hints.json` — the index IS the rung's identity. */}
                  {ladder.rungs.map((rung, index) => (
                    <li key={index}>{rung}</li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}

        <button
          type="button"
          className="hints-panel__next"
          onClick={() => {
            submit('hint');
          }}
        >
          Take the next hint (−{module.scoring.hintPenalty} points)
        </button>
      </div>
    </Overlay>
  );
}
