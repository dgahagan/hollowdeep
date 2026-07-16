import { useEffect, useRef } from 'react';
import type { OutputEvent } from '../engine/types';

// Scrolling transcript (design plan §6, T25). Renders the STRUCTURED
// `OutputEvent` union (src/engine/types.ts) — the union exists precisely so
// the UI can style a death differently from a score notice without parsing
// prose, so this switches on `kind` rather than flattening every event to a
// string up in `useGame`. `command-echo` gets its own visual treatment (a
// `>` prompt marker, styled distinctly in app.css) so a click's echoed
// command reads exactly like a typed one (FR-2.7) and neither is mistaken
// for narration.
export interface TranscriptPanelProps {
  entries: OutputEvent[];
}

export function TranscriptPanel({ entries }: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest line in view. `entries.length` (not `entries` itself) is
  // the dependency — the array grows by concatenation each turn (see
  // useGame.ts), so a new length is exactly "a turn happened", and comparing
  // by length avoids re-scrolling on a render that didn't add anything.
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  return (
    <div className="transcript-panel" role="log" aria-live="polite" ref={scrollRef}>
      {entries.length === 0 && (
        <p className="transcript-panel__hint">Type a command, or click something below, to begin.</p>
      )}
      {entries.map((entry, index) => (
        // Index keys are safe here: the transcript only ever grows by
        // appending at the end (useGame.ts) — entries are never reordered,
        // inserted in the middle, or removed.
        <p key={index} className={`transcript-entry transcript-entry--${entry.kind}`}>
          {entry.text}
          {entry.kind === 'score' && ` (+${entry.points}, total ${entry.total})`}
          {entry.kind === 'achievement' && ` [achievement: ${entry.achievementId}]`}
          {entry.kind === 'question' && entry.options.length > 0 && ` (${entry.options.join(' / ')})`}
          {entry.kind === 'game-over' &&
            ` — ${entry.victory ? 'Victory' : 'Game over'} · rank: ${entry.rank} · score ${entry.score}`}
        </p>
      ))}
    </div>
  );
}
