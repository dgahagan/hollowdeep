import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

// Text entry (design plan §6, T25): Enter submits, ↑/↓ walk command history.
//
// History lives in a ref, not state — it never needs to trigger a render on
// its own (only the input's current VALUE does, and that already has its own
// `useState`), and a ref survives across the input being cleared without
// dragging history changes through the render cycle.
export interface CommandInputProps {
  onSubmit: (command: string) => void;
}

export function CommandInput({ onSubmit }: CommandInputProps) {
  const [value, setValue] = useState('');
  const historyRef = useRef<string[]>([]);
  // -1 means "not currently browsing history" (typing fresh input).
  const cursorRef = useRef(-1);

  function commit(command: string): void {
    const trimmed = command.trim();
    if (trimmed === '') return;
    onSubmit(trimmed);
    historyRef.current = [...historyRef.current, trimmed];
    cursorRef.current = -1;
    setValue('');
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    commit(value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    const history = historyRef.current;

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (history.length === 0) return;
      const next = cursorRef.current < 0 ? history.length - 1 : Math.max(0, cursorRef.current - 1);
      cursorRef.current = next;
      setValue(history[next] ?? '');
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (cursorRef.current < 0) return;
      const next = cursorRef.current + 1;
      if (next >= history.length) {
        cursorRef.current = -1;
        setValue('');
      } else {
        cursorRef.current = next;
        setValue(history[next] ?? '');
      }
    }
  }

  return (
    <form className="command-input" onSubmit={handleSubmit}>
      <label htmlFor="command-input-field">Command</label>
      <input
        id="command-input-field"
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        autoFocus
        placeholder="What do you do?"
      />
      <button type="submit">Go</button>
    </form>
  );
}
