import { Overlay } from './Overlays';

// The real Help overlay (T10, ui-plan §6 "Help & onboarding (FR-7.1)"),
// replacing App.tsx's inline placeholder `<Overlay id="help">` stub (T3).
// Content is DISTILLED from `docs/PLAYING.md`, not reproduced wholesale —
// that doc is the player's guide in full prose; this panel is the
// in-context cheat sheet a player reaches for mid-game, so it keeps only
// what a stuck player actually needs at a glance: the shape of a command,
// the verb families (every one of which ships with the engine, per
// PLAYING.md's own "Verbs" section, so this list is honest for every
// adventure), and the shortcut table. It intentionally leaves out
// PLAYING.md's narrative framing (turns/light/saving prose) — that's
// scene-setting for a fresh read, not a lookup.
//
// Pure presentation, no props: this panel reads no GameState and no module
// data (the verb list is engine-wide, not adventure-specific — an adventure
// may ADD verbs/synonyms per PLAYING.md, but never remove one, so nothing
// here can go stale against a particular module). That is also why it takes
// no `module`/`state` props unlike its sibling overlays (Journal, Hints,
// Map) — there is nothing about THIS run it needs to know.

/** One verb family, grouped exactly as `docs/PLAYING.md`'s "Verbs" section does. */
interface VerbGroup {
  label: string;
  verbs: string;
}

const VERB_GROUPS: VerbGroup[] = [
  { label: 'Moving', verbs: 'go (walk, head, move) · enter · exit (leave) · back (retreat)' },
  { label: 'Looking', verbs: 'look (l) · examine (x, inspect, describe) · read · search' },
  { label: 'Handling', verbs: 'take (get, grab, pick) · drop (discard) · put (place, insert) · open · close (shut) · lock · unlock' },
  { label: 'The lamp', verbs: 'light (ignite) · extinguish (douse, snuff) · refuel (refill)' },
  { label: 'Trouble', verbs: 'attack (kill, hit, fight) · throw (toss) · give (offer) · use' },
  { label: 'Bookkeeping', verbs: 'inventory (i, inv) · score · wait (z) · again (g) · verbose · brief · help · hint (hints)' },
];

/** One row of the shortcut table — mirrors `useKeyboard.ts`'s `KeyboardHandlers` exactly. */
interface ShortcutRow {
  keys: string[];
  does: string;
}

const SHORTCUTS: ShortcutRow[] = [
  { keys: ['m'], does: 'Open the map' },
  { keys: ['j'], does: 'Open the journal' },
  { keys: ['i'], does: 'Jump to the inventory panel' },
  { keys: ['l'], does: 'Look' },
  { keys: ['?'], does: 'Open this help panel' },
  { keys: ['Ctrl', 'S'], does: 'Save / load' },
];

export function HelpPanel() {
  return (
    <Overlay id="help" title="Help">
      <div className="help-panel">
        <section className="help-panel__section">
          <h3>How to play</h3>
          <p>
            Type what you want to do — a verb alone (<code>look</code>), a verb and a noun (
            <code>take lamp</code>), or a verb, a noun, a preposition, and a noun (
            <code>unlock grate with key</code>). A bare direction means &ldquo;go that
            way&rdquo; — <code>n</code>, <code>s</code>, <code>e</code>, <code>w</code>,{' '}
            <code>ne</code>, <code>nw</code>, <code>se</code>, <code>sw</code>, <code>up</code>,{' '}
            <code>down</code>, <code>in</code>, <code>out</code>. Every button on screen is a
            command too — clicking an exit or an item types the same words a keyboard would, and
            they land in the transcript exactly as if you had typed them yourself. If two things
            answer to the same noun, the cave asks which you mean; answer however you like, or
            type a completely different command to cancel the question.
          </p>
          <p>
            A typo, a refusal, a question, and checking your <code>inventory</code>,{' '}
            <code>score</code>, or a <code>hint</code> never cost a turn — only something that
            actually happens does.
          </p>
        </section>

        <section className="help-panel__section">
          <h3>Verbs</h3>
          <p>
            Every verb below ships with the engine and works in every adventure; an adventure may
            add its own on top, but never take one of these away.
          </p>
          <dl className="help-panel__verbs">
            {VERB_GROUPS.map((group) => (
              <div key={group.label} className="help-panel__verb-group">
                <dt>{group.label}</dt>
                <dd>{group.verbs}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="help-panel__section">
          <h3>Keyboard shortcuts</h3>
          <ul className="overlay__shortcut-list">
            {SHORTCUTS.map((row) => (
              <li key={row.does}>
                {row.keys.map((key, index) => (
                  <span key={key}>
                    {index > 0 && '+'}
                    <kbd>{key}</kbd>
                  </span>
                ))}{' '}
                {row.does}
              </li>
            ))}
          </ul>
          <p className="help-panel__note">
            The Hints panel has no shortcut of its own — every free bare letter is a plausible
            command word, so its header button (top of the screen) is the only door to it.
            Shortcuts that are also letters (<kbd>l</kbd>, <kbd>i</kbd>) only fire while the
            command box does NOT have focus, so typing a word like &ldquo;light&rdquo; is never
            interrupted.
          </p>
        </section>
      </div>
    </Overlay>
  );
}
