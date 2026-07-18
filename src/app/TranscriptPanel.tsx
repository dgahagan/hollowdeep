import { useEffect, useRef, useState } from 'react';
import type { OutputEvent } from '../engine/types';
import type { TypewriterSpeedSetting } from './uiState';

// Scrolling transcript (design plan §6, T25; T3 adds the typewriter reveal
// and finishes the typed-event stylings). Renders the STRUCTURED
// `OutputEvent` union (src/engine/types.ts) — the union exists precisely so
// the UI can style a death differently from a score notice without parsing
// prose, so this switches on `kind` rather than flattening every event to a
// string up in `useGame`. `command-echo` gets its own visual treatment (a
// `>` prompt marker, styled distinctly in app.css) so a click's echoed
// command reads exactly like a typed one (FR-2.7) and neither is mistaken
// for narration.

export interface TranscriptPanelProps {
  entries: OutputEvent[];
  /** T3 (ui-plan §3/§9): reveal speed for NEWLY appended entries; `'instant'` renders whole lines immediately, same as before this task. */
  typewriterSpeed: TypewriterSpeedSetting;
  /** The in-app motion toggle (uiState.ts §6) — EITHER this or the OS `prefers-reduced-motion` query (checked below) disables the reveal, per ui-plan §9. */
  reduceMotion: boolean;
}

/** Milliseconds between each revealed character, by speed — `'instant'` never reaches this (its entries are never animated at all). */
const MS_PER_CHAR: Record<'normal' | 'slow', number> = {
  normal: 18,
  slow: 45,
};

/**
 * Extra text this component has always appended per `kind` (score totals,
 * achievement ids, etc.) — pulled out to its own function so the typewriter
 * reveals the WHOLE line (base text + suffix) as one continuous reveal
 * instead of the suffix popping in instantly after an animated prefix.
 */
function suffixFor(entry: OutputEvent): string {
  switch (entry.kind) {
    case 'score':
      return ` (+${entry.points}, total ${entry.total})`;
    case 'achievement':
      return ` [achievement: ${entry.achievementId}]`;
    case 'question':
      return entry.options.length > 0 ? ` (${entry.options.join(' / ')})` : '';
    case 'game-over':
      return ` — ${entry.victory ? 'Victory' : 'Game over'} · rank: ${entry.rank} · score ${entry.score}`;
    default:
      return '';
  }
}

/**
 * `true` while the OS asks for less motion, live-updated (a player who
 * toggles it at the OS level mid-session should not need a reload) — the
 * same media query standing rule #3 requires every animation in this app to
 * respect, mirrored here rather than imported from anywhere since T3 owns no
 * shared "motion" module (App.tsx's theme listener is the same pattern for a
 * different query).
 */
function usePrefersReducedMotionQuery(): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setMatches(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return matches;
}

interface TranscriptEntryLineProps {
  entry: OutputEvent;
  typewriterSpeed: TypewriterSpeedSetting;
  /** Settings-toggle OR OS query, already OR'd together by the parent (computed once there, not per line). */
  motionReduced: boolean;
}

/**
 * One transcript line. "New entry vs. history" is decided with NO counting
 * or bookkeeping at all: this component is keyed by array INDEX
 * (`TranscriptPanel` below), and the transcript only ever grows by appending
 * — so a given index's `TranscriptEntryLine` is created (mounted) for the
 * FIRST time at exactly the moment its entry is appended, and never again
 * afterwards (React reuses the same instance across re-renders as long as
 * its key persists). "Is this my first render?" and "was I just appended?"
 * are therefore the same fact, so `shouldAnimate` can be frozen straight
 * into `useState`'s initializer, which runs exactly once, on mount — no ref
 * read during render, no effect whose only job is re-deriving state from a
 * prop that changed (both of which react-hooks' newer `refs` and
 * `set-state-in-effect` rules flag, correctly, as unnecessary here).
 *
 * This also covers `useGame.ts`'s `load()` (a save load REPLACES the whole
 * `transcript` array with one "Game loaded." line) for free: whatever index
 * already existed before the load keeps its ALREADY-MOUNTED instance (same
 * key, reused, not remounted) even though its content just changed — so it
 * renders complete instantly, exactly like any other history line, with no
 * special-casing for "this was a load" anywhere in this file.
 */
function TranscriptEntryLine({ entry, typewriterSpeed, motionReduced }: TranscriptEntryLineProps) {
  const fullText = entry.text + suffixFor(entry);

  // `'instant'` (the default) and reduced motion (either source) always
  // render complete immediately — frozen at mount, per the function comment.
  const [shouldAnimate] = useState(() => typewriterSpeed !== 'instant' && !motionReduced);

  const [revealedLength, setRevealedLength] = useState(() => (shouldAnimate ? 0 : fullText.length));

  // Recursive `setTimeout`, not `setInterval`: the effect re-fires every time
  // `revealedLength` advances, and simply declines to schedule another tick
  // once the text is fully revealed — no separate "am I done?" bookkeeping,
  // and nothing keeps ticking in the background after the line finishes.
  useEffect(() => {
    if (!shouldAnimate) return undefined;
    if (revealedLength >= fullText.length) return undefined;

    const msPerChar = MS_PER_CHAR[typewriterSpeed === 'slow' ? 'slow' : 'normal'];
    const id = window.setTimeout(() => {
      setRevealedLength((prev) => Math.min(prev + 1, fullText.length));
    }, msPerChar);
    return () => window.clearTimeout(id);
  }, [shouldAnimate, revealedLength, fullText, typewriterSpeed]);

  const displayText = shouldAnimate ? fullText.slice(0, revealedLength) : fullText;

  return <p className={`transcript-entry transcript-entry--${entry.kind}`}>{displayText}</p>;
}

export function TranscriptPanel({ entries, typewriterSpeed, reduceMotion }: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Whether the view should stay glued to the newest text. True until the
  // player deliberately scrolls up to read history; scrolling back to the
  // bottom (or a new turn happening) re-pins. A ref, not state: pinnedness
  // changes on every scroll event and must never cause a render.
  const pinnedRef = useRef(true);
  const osReducedMotion = usePrefersReducedMotionQuery();
  const motionReduced = reduceMotion || osReducedMotion;

  // Keep the newest line in view. `entries.length` (not `entries` itself) is
  // the dependency — the array grows by concatenation each turn (see
  // useGame.ts), so a new length is exactly "a turn happened", and comparing
  // by length avoids re-scrolling on a render that didn't add anything.
  // A new turn always re-pins: asking the game something means wanting the
  // answer, wherever the player had scrolled to before.
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    pinnedRef.current = true;
    el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  // The typewriter reveal (TranscriptEntryLine) grows a line CHARACTER BY
  // CHARACTER long after the entries-length scroll above has fired — at
  // normal/slow speed the tail of the newest line kept sliding below the
  // fold. Watch the content's actual size and, while pinned, follow it.
  // ResizeObserver rather than scrolling from the reveal ticks keeps the
  // "stay at the bottom" concern in the one component that owns the
  // scroller, whatever grows it.
  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (scroller === null || content === null) return undefined;

    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) scroller.scrollTop = scroller.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // Scrolling up unpins (the player is reading history — yanking them back
  // down mid-reveal would be hostile); returning to the bottom re-pins. The
  // 40px slack means "close enough to the bottom counts", so a stray
  // one-notch wheel tick doesn't strand the view just above the newest text.
  const onScroll = () => {
    const el = scrollRef.current;
    if (el === null) return;
    pinnedRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
  };

  return (
    <div className="transcript-panel" role="log" aria-live="polite" ref={scrollRef} onScroll={onScroll}>
      <div ref={contentRef}>
        {entries.length === 0 && (
          <p className="transcript-panel__hint">Type a command, or click something below, to begin.</p>
        )}
        {entries.map((entry, index) =>
          // `inspect` is a visual directive — the scene panel renders it as
          // the examined subject's painting (activeInspect, uiState.ts); as a
          // transcript line it would just be the subject's bare name, noise.
          entry.kind === 'inspect' ? null : (
            // Index keys are safe here: the transcript only ever grows by
            // appending at the end (useGame.ts) — entries are never reordered,
            // inserted in the middle, or removed. See `TranscriptEntryLine`'s own
            // comment for why that stability is exactly what makes it safe to
            // decide "new vs. history" from mount timing alone.
            <TranscriptEntryLine
              key={index}
              entry={entry}
              typewriterSpeed={typewriterSpeed}
              motionReduced={motionReduced}
            />
          ),
        )}
      </div>
    </div>
  );
}
