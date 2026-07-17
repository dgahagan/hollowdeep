import { useCallback, useEffect, useState } from 'react';
import { loadSidecar, saveSidecar } from './uiState';

// First-run onboarding (T10, ui-plan §6 "Help & onboarding (FR-7.1)"): 3
// dismissible tips, conceptually anchored to the input, the exits, and the
// map button — "conceptually" because that is the plan's own word for it
// (ui-implementation-plan T10): these tips describe what those UI areas DO
// rather than pointing an arrow at a measured DOM rect. Pixel-anchoring
// would need refs into CommandInput/ActionBar/the header's Map button, all
// of which live in App.tsx/ActionBar.tsx — outside this task's file list —
// so a plain, self-contained card that MENTIONS each area by name is both
// the simpler build and the one this task's file boundary actually allows.
//
// NEVER a forced tutorial (ui-plan §6, restated in the implementation plan
// twice): no focus-stealing on mount (a player who is already typing must
// stay uninterrupted), no backdrop, no scrim, nothing modal — a plain
// `role="status"` card that sits quietly until dismissed. "Skip" and "Got
// it" are the same action (both set `onboardingSeen`); the two labels exist
// only so a player mid-sequence isn't told "Got it" for tips they haven't
// read yet.
//
// **Per-adventure, not per-browser — a deliberate reading of an ambiguous
// plan.** `onboardingSeen` lives in the PER-ADVENTURE sidecar
// (`cave.<id>.ui`, uiState.ts — built in T2, already shipping the field this
// task consumes) even though ui-plan §6 and this task's own acceptance
// criteria say "once per browser." Two reasons this task keeps the
// already-built per-adventure field rather than adding a new browser-global
// key to `cave.settings`:
//   1. This task's file list is `HelpPanel.tsx`/`Onboarding.tsx`/
//      `StatsScreen.tsx` (+ CSS) ONLY — `uiState.ts` is explicitly not in
//      scope, so adding a new global flag there is not this task's to do.
//   2. In practice the two readings coincide for the overwhelming majority
//      of play: a player's FIRST adventure (almost always Hollowdeep, per
//      AdventureSelect's registry order) shows the tips exactly once, and
//      replaying or continuing that same adventure never shows them again
//      (the flag persists in that adventure's sidecar). The only case where
//      the readings diverge is a player who tries test-cave and Hollowdeep
//      as two genuinely different first visits — which arguably even
//      WARRANTS its own one-time orientation, since the two are different
//      UIs with different exits and different map shapes to discover.
// If a stricter "once ever, across every adventure" reading turns out to
// matter, promoting this flag to `cave.settings` is a small, isolated change
// for whichever task next touches `uiState.ts` (T11 or later) — noted here
// rather than smuggled into this task's diff.

export interface OnboardingProps {
  /** Which adventure's sidecar to read/write — see the file header for why this is per-adventure. */
  adventureId: string;
}

interface Tip {
  title: string;
  body: string;
}

/** Exactly the three anchors ui-plan §6 names: the input, the exits, the map button. */
const TIPS: Tip[] = [
  {
    title: 'Type it, or click it',
    body: 'Type what you want to do in the box at the bottom — or click a button. Clicking types the same command for you; there is no second set of rules.',
  },
  {
    title: 'Every exit is a button',
    body: 'Clicking a direction like West does exactly what typing "w" does. Look at what is around you, then walk by clicking or typing.',
  },
  {
    title: 'Keep your bearings',
    body: 'Press m, or click Map in the header, any time to see where you have been. It only remembers what you have actually found — no spoilers.',
  },
];

export function Onboarding({ adventureId }: OnboardingProps) {
  // Lazy initializer: read the sidecar exactly once, at mount (this
  // component lives for the whole game session — nothing remounts it
  // mid-run the way `Overlay`'s `{isActive && children}` remounts a panel on
  // every open, so "once at mount" is the only read this needs).
  const [seen, setSeen] = useState<boolean>(() => loadSidecar(adventureId).onboardingSeen);
  const [step, setStep] = useState(0);

  // Read-modify-write, same shape as JournalPanel's notes persistence and
  // uiState.ts's own `setAdventureHardcore`: never clobber a sidecar field
  // (journal notes, hardcore) some OTHER panel wrote in the same session.
  const dismiss = useCallback(() => {
    setSeen(true);
    const sidecar = loadSidecar(adventureId);
    saveSidecar(adventureId, { ...sidecar, onboardingSeen: true });
  }, [adventureId]);

  // T11 accessibility audit finding: dismissing (Skip/Got it/Esc) unmounts
  // this card's own focused button, and a non-modal component that steals no
  // focus on OPEN still owes the keyboard user somewhere sane to land on
  // CLOSE — otherwise focus drops to `<body>`, same dead end an untrapped
  // overlay would leave. `CommandInput.tsx`'s field carries a stable id for
  // exactly this: the natural "next thing to do" after dismissing a tip
  // about typing/clicking is to be back in the box ready to type.
  useEffect(() => {
    if (seen) document.getElementById('command-input-field')?.focus();
  }, [seen]);

  // Esc dismisses too (keyboard-reachable, standing rule #3's spirit, even
  // though this is not an Overlays.tsx-managed overlay) — but it does NOT
  // trap focus and does NOT call `preventDefault`, so it never fights a
  // genuinely modal overlay's own Esc handling if one happens to be open at
  // the same time.
  useEffect(() => {
    if (seen) return undefined;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') dismiss();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [seen, dismiss]);

  if (seen) return null;

  const tip = TIPS[step];
  if (tip === undefined) return null; // unreachable given TIPS.length static and step clamped below; narrows for TS.
  const isLast = step === TIPS.length - 1;

  return (
    // `role="status"`/`aria-live="polite"`, not `"alert"`: this is an
    // unprompted courtesy, not an urgent notice — a screen reader announces
    // it without interrupting whatever the player is doing.
    <div className="onboarding" role="status" aria-live="polite">
      <div className="onboarding__card">
        <p className="onboarding__step">
          Tip {step + 1} of {TIPS.length}
        </p>
        <h3 className="onboarding__title">{tip.title}</h3>
        <p className="onboarding__body">{tip.body}</p>
        <div className="onboarding__actions">
          <button type="button" className="onboarding__skip" onClick={dismiss}>
            Skip
          </button>
          {isLast ? (
            <button type="button" className="onboarding__next" onClick={dismiss}>
              Got it
            </button>
          ) : (
            <button
              type="button"
              className="onboarding__next"
              onClick={() => {
                setStep((current) => current + 1);
              }}
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
