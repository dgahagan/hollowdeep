import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

// Text entry (design plan §6, T25; T3 adds the autocomplete dropdown):
// Enter submits, ↑/↓ walk command history, and — new in T3 — a dropdown of
// completions for the word currently being typed, driven by the engine's
// `suggestions()` (src/engine/view.ts) via the `suggest` prop App.tsx
// supplies (closing over the live `module`/`GameState`, both engine types
// this file has no business importing directly).
//
// **Precedence, stated once so it never has to be re-derived by reading the
// keydown handler line by line:** the dropdown, when it has anything to
// show, owns ↑/↓/Enter/Esc completely — history navigation only runs when
// the dropdown is CLOSED (empty suggestion list, blurred, or just dismissed
// with Esc). This is not two independent feature branches that happen to
// share keys; it's one priority order, checked first thing in
// `handleKeyDown`.
//
// History lives in a ref, not state — it never needs to trigger a render on
// its own (only the input's current VALUE does, and that already has its own
// `useState`), and a ref survives across the input being cleared without
// dragging history changes through the render cycle.
export interface CommandInputProps {
  onSubmit: (command: string) => void;
  /**
   * Completions for the word currently being typed — a thin closure over the
   * engine's `suggestions(module, state, prefix)` (App.tsx supplies it so
   * this file stays free of engine imports). Already spoiler-safe and
   * magic-word-safe (view.ts's own contract) — this component trusts the
   * list verbatim and adds no filtering of its own.
   */
  suggest: (prefix: string) => string[];
}

export function CommandInput({ onSubmit, suggest }: CommandInputProps) {
  const [value, setValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  // -1 means "no suggestion highlighted" (dropdown showing, nothing selected yet).
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  // Esc dismisses the dropdown for the CURRENT word without touching the
  // text; typing further (which changes `value` via `setInputValue` below)
  // reopens it, since every `value`-changing call resets this flag too.
  const [dismissed, setDismissed] = useState(false);

  const historyRef = useRef<string[]>([]);
  // -1 means "not currently browsing history" (typing fresh input).
  const cursorRef = useRef(-1);

  const suggestions = value.trim() === '' ? [] : suggest(value);
  const dropdownOpen = isFocused && !dismissed && suggestions.length > 0;

  /**
   * The one place `value` changes. A fresh word invalidates whatever was
   * highlighted/dismissed for the previous one, so every call resets both
   * alongside the text — done here, at the point of change, rather than by
   * watching `value` from a `useEffect` (an effect only to re-derive state
   * from a value that just changed is exactly the "you don't need an
   * effect" anti-pattern react-hooks' `set-state-in-effect` rule catches;
   * every call site below already knows it's changing `value`, so it can
   * just say so).
   */
  function setInputValue(next: string): void {
    setValue(next);
    setActiveSuggestion(-1);
    setDismissed(false);
  }

  function commit(command: string): void {
    const trimmed = command.trim();
    if (trimmed === '') return;
    onSubmit(trimmed);
    historyRef.current = [...historyRef.current, trimmed];
    cursorRef.current = -1;
    setInputValue('');
  }

  /** Replace the word currently being completed with `word`, leaving a trailing space to keep typing the next one. */
  function acceptSuggestion(word: string): void {
    const words = value.split(/\s+/);
    words[words.length - 1] = word;
    setInputValue(`${words.join(' ')} `);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    commit(value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    // --- Dropdown owns these keys first; history never sees them while it's open. ---
    if (dropdownOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveSuggestion((prev) => (prev + 1) % suggestions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveSuggestion((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setDismissed(true);
        return;
      }
      if (event.key === 'Enter' && activeSuggestion >= 0) {
        event.preventDefault();
        const chosen = suggestions[activeSuggestion];
        if (chosen !== undefined) acceptSuggestion(chosen);
        return;
      }
      // Enter with nothing highlighted falls through to the form's own
      // `onSubmit` (not prevented here) — the player typed a complete
      // command and never touched the dropdown, so it submits as-is.
    }

    // --- History navigation (only reached when the dropdown isn't open). ---
    const history = historyRef.current;

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (history.length === 0) return;
      const next = cursorRef.current < 0 ? history.length - 1 : Math.max(0, cursorRef.current - 1);
      cursorRef.current = next;
      setInputValue(history[next] ?? '');
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (cursorRef.current < 0) return;
      const next = cursorRef.current + 1;
      if (next >= history.length) {
        cursorRef.current = -1;
        setInputValue('');
      } else {
        cursorRef.current = next;
        setInputValue(history[next] ?? '');
      }
    }
  }

  return (
    <form className="command-input" onSubmit={handleSubmit}>
      <label htmlFor="command-input-field">Command</label>
      <div className="command-input__field-wrap">
        <input
          id="command-input-field"
          type="text"
          value={value}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          autoComplete="off"
          autoFocus
          placeholder="What do you do?"
          role="combobox"
          aria-expanded={dropdownOpen}
          aria-controls="command-input-suggestions"
          aria-autocomplete="list"
          aria-activedescendant={
            dropdownOpen && activeSuggestion >= 0 ? `command-input-suggestion-${activeSuggestion}` : undefined
          }
        />
        {dropdownOpen && (
          <ul id="command-input-suggestions" className="command-input__suggestions" role="listbox">
            {suggestions.map((word, index) => (
              <li
                key={word}
                id={`command-input-suggestion-${index}`}
                role="option"
                aria-selected={index === activeSuggestion}
                className={
                  index === activeSuggestion
                    ? 'command-input__suggestion command-input__suggestion--active'
                    : 'command-input__suggestion'
                }
                // `onMouseDown` (not `onClick`) with `preventDefault` stops
                // the input from blurring — and the dropdown from
                // disappearing — before the click has a chance to register.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => acceptSuggestion(word)}
              >
                {word}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button type="submit">Go</button>
    </form>
  );
}
