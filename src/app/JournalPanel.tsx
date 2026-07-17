import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AdventureModule } from '../engine/schema';
import type { GameState } from '../engine/types';
import { Overlay } from './Overlays';
import { loadSidecar, saveSidecar } from './uiState';
import { deriveJournal } from './journal';

// The Journal overlay (T7, ui-plan §6). Two tabs:
//
//   - Log: a read-only, CURRENT-STATE summary — journal.ts's pure
//     derivation, rendered. See that file's header for why it is a summary
//     rather than a history.
//   - Notes: free text in the per-adventure UI sidecar (ui-plan §8 layer 2),
//     never touching GameState (standing rule #4).
//
// Debounced persistence, not save-on-every-keystroke: a note is typed in
// bursts, and writing to localStorage on every character is wasted work for
// no correctness gain — the flush-on-blur path (and the unmount flush below,
// since `Overlay`'s `{isActive && children}` unmounts this component's tree
// the moment the overlay closes, e.g. via Esc mid-sentence) covers the paths
// a plain debounce alone would miss.

const NOTES_SAVE_DEBOUNCE_MS = 500;

export interface JournalPanelProps {
  module: AdventureModule;
  state: GameState;
  adventureId: string;
}

type JournalTab = 'log' | 'notes';

/** One `<li>` per entry; a plain wrapper so every Log section reads the same. */
function EntryList({ children }: { children: ReactNode }) {
  return <ul className="journal-panel__entries">{children}</ul>;
}

export function JournalPanel({ module, state, adventureId }: JournalPanelProps) {
  const [tab, setTab] = useState<JournalTab>('log');

  // Lazy initializer reads the sidecar once per mount. Because `Overlay`
  // unmounts this component's subtree whenever it closes (see file header),
  // "once per mount" already means "fresh every time the player opens the
  // journal" — exactly the read-on-open behavior the panel needs, with no
  // extra effect required.
  const [notes, setNotes] = useState<string>(() => loadSidecar(adventureId).journalNotes);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mirrors `notes`, kept in lockstep by every setter below (never written
  // during render — React forbids mutating a ref's `.current` there). The
  // unmount flush further down reads THIS, not the `notes` variable
  // directly: an effect with an empty dependency array closes over its
  // FIRST render's bindings, so reading `notes` there would flush whatever
  // was typed at mount time, not the latest keystroke. The ref sidesteps
  // the stale closure instead of re-subscribing the effect on every
  // keystroke.
  const notesRef = useRef(notes);

  const persistNotes = (value: string) => {
    const sidecar = loadSidecar(adventureId);
    saveSidecar(adventureId, { ...sidecar, journalNotes: value });
  };

  // Flush a pending debounce on unmount (overlay close) rather than drop the
  // last few hundred milliseconds of typing on the floor.
  useEffect(() => {
    return () => {
      if (saveTimer.current !== null) {
        clearTimeout(saveTimer.current);
        const sidecar = loadSidecar(adventureId);
        saveSidecar(adventureId, { ...sidecar, journalNotes: notesRef.current });
      }
    };
  }, [adventureId]);

  const handleNotesChange = (value: string) => {
    setNotes(value);
    notesRef.current = value;
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      persistNotes(value);
    }, NOTES_SAVE_DEBOUNCE_MS);
  };

  const handleNotesBlur = () => {
    if (saveTimer.current !== null) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    persistNotes(notes);
  };

  const log = deriveJournal(module, state);
  const logIsEmpty =
    log.milestones.length === 0 &&
    log.treasures.length === 0 &&
    log.achievements.length === 0 &&
    log.hints.length === 0 &&
    log.deaths.count === 0;

  return (
    <Overlay id="journal" title="Journal">
      <div className="journal-panel">
        {/* Real buttons, not divs with click handlers — keyboard-reachable by
            default, and `aria-selected` is what a screen reader needs to
            announce which tab is current (standing rule #3). */}
        <div className="journal-panel__tabs" role="tablist" aria-label="Journal sections">
          <button
            type="button"
            role="tab"
            id="journal-tab-log"
            aria-selected={tab === 'log'}
            aria-controls="journal-panel-log"
            className={`journal-panel__tab${tab === 'log' ? ' journal-panel__tab--active' : ''}`}
            onClick={() => setTab('log')}
          >
            Log
          </button>
          <button
            type="button"
            role="tab"
            id="journal-tab-notes"
            aria-selected={tab === 'notes'}
            aria-controls="journal-panel-notes"
            className={`journal-panel__tab${tab === 'notes' ? ' journal-panel__tab--active' : ''}`}
            onClick={() => setTab('notes')}
          >
            Notes
          </button>
        </div>

        {tab === 'log' && (
          <div id="journal-panel-log" role="tabpanel" aria-labelledby="journal-tab-log" className="journal-panel__section">
            {logIsEmpty ? (
              <p className="journal-panel__empty">The Log is quiet — you have only just started.</p>
            ) : (
              <>
                {log.milestones.length > 0 && (
                  <section className="journal-panel__group">
                    <h3>Milestones</h3>
                    <EntryList>
                      {log.milestones.map((entry) => (
                        <li key={entry.id}>
                          {entry.label} <span className="journal-panel__points">(+{entry.points})</span>
                        </li>
                      ))}
                    </EntryList>
                  </section>
                )}

                {log.treasures.length > 0 && (
                  <section className="journal-panel__group">
                    <h3>Treasures</h3>
                    <EntryList>
                      {log.treasures.map((entry) => {
                        const status = [
                          entry.carried ? `carried (+${entry.carryPoints})` : null,
                          entry.deposited ? `banked (+${entry.depositPoints})` : null,
                        ].filter((part): part is string => part !== null);
                        return (
                          <li key={entry.id}>
                            {entry.label} <span className="journal-panel__points">— {status.join(', ')}</span>
                          </li>
                        );
                      })}
                    </EntryList>
                  </section>
                )}

                {log.achievements.length > 0 && (
                  <section className="journal-panel__group">
                    <h3>Achievements</h3>
                    <EntryList>
                      {log.achievements.map((entry) => (
                        <li key={entry.id}>
                          <strong>{entry.name}</strong> — {entry.description}
                        </li>
                      ))}
                    </EntryList>
                  </section>
                )}

                {log.hints.length > 0 && (
                  <section className="journal-panel__group">
                    <h3>Hints taken</h3>
                    {log.hints.map((ladder) => (
                      <div key={ladder.id} className="journal-panel__ladder">
                        <h4>
                          {ladder.title}{' '}
                          <span className="journal-panel__points">
                            (rung {ladder.revealed} of {ladder.total})
                          </span>
                        </h4>
                        <ol className="journal-panel__entries">
                          {/* Index-as-key is sound here: rungs are a fixed, ordered
                              ladder authored once in `hints.json` — the index IS the
                              rung's identity, and the list only ever grows. */}
                          {ladder.rungs.map((rung, index) => (
                            <li key={index}>{rung}</li>
                          ))}
                        </ol>
                      </div>
                    ))}
                  </section>
                )}

                {log.deaths.count > 0 && (
                  <section className="journal-panel__group">
                    <h3>Deaths</h3>
                    <p>
                      {log.deaths.count} {log.deaths.count === 1 ? 'time' : 'times'}{' '}
                      <span className="journal-panel__points">(−{log.deaths.penaltyTotal} points)</span>
                    </p>
                  </section>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'notes' && (
          <div
            id="journal-panel-notes"
            role="tabpanel"
            aria-labelledby="journal-tab-notes"
            className="journal-panel__section"
          >
            <textarea
              className="journal-panel__notes"
              value={notes}
              onChange={(event) => handleNotesChange(event.target.value)}
              onBlur={handleNotesBlur}
              rows={12}
              placeholder="Write yourself a note. It stays on this browser, in this adventure's save data — nobody else will read it."
              aria-label="Journal notes"
            />
          </div>
        )}
      </div>
    </Overlay>
  );
}
