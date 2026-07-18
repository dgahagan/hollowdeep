import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AdventureModule } from '../engine/schema';
import { suggestions } from '../engine/view';
import { loadAdventure } from '../loader';
import { fetchReader } from './fetchReader';
import { ErrorBoundary } from './ErrorBoundary';
import { useGame } from './useGame';
import { useKeyboard } from './useKeyboard';
import { OverlayProvider, useOverlays } from './Overlays';
import { ScenePanel } from './ScenePanel';
import { TranscriptPanel } from './TranscriptPanel';
import { CommandInput } from './CommandInput';
import { ActionBar } from './ActionBar';
import { InventoryPanel } from './InventoryPanel';
import { StatusBar } from './StatusBar';
import { SaveDialog } from './SaveDialog';
import { SettingsPanel } from './SettingsPanel';
import { MapOverlay } from './MapOverlay';
import {
  loadSettings,
  loadSidecar,
  saveSettings,
  setAdventureHardcore,
  TEXT_SCALE_BY_STEP,
  type Settings,
} from './uiState';
import { DeathModal } from './DeathModal';
import { JournalPanel } from './JournalPanel';
import { HintsPanel } from './HintsPanel';
import { AdventureSelect } from './AdventureSelect';
import { HelpPanel } from './HelpPanel';
import { Onboarding } from './Onboarding';
import { StatsScreen } from './StatsScreen';
import type { GameState } from '../engine/types';
import './fonts.css';
import './theme.css';
import './app.css';

// The Phase 3 app shell (T1, ui-plan §3): three regions — scene (left, with
// the action region beneath it), transcript (right, with the command input
// pinned under it), and the header status bar — plus the overlay host
// (Overlays.tsx) every panel and shortcut routes through. The wiring pattern
// from Phase 1 survives unchanged: ONE `submit(input)` call is the entire
// write path, whether the input came from typing (CommandInput) or clicking
// (ActionBar/InventoryPanel) — FR-2.7's "clicking IS typing".

/**
 * Adventures this build knows how to find on disk (`adventures/<id>`). The
 * real front door is `AdventureSelect` (T9); this list is now only the guard
 * for a `?adventure=<id>` deep link — a typo'd id lands on the error path in
 * `useAdventure` rather than a raw fetch failure.
 */
const KNOWN_ADVENTURE_IDS = ['hollowdeep', 'test-cave'] as const;
type KnownAdventureId = (typeof KNOWN_ADVENTURE_IDS)[number];

function isKnownAdventureId(id: string): id is KnownAdventureId {
  return (KNOWN_ADVENTURE_IDS as readonly string[]).includes(id);
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; module: AdventureModule }
  | { status: 'error'; error: Error };

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Loads the adventure on mount. `loadAdventure` is async, so a failure
 * arrives via a rejected promise in `useEffect` — that alone can't reach an
 * error boundary, which only catches things thrown during render. Storing
 * the rejection in state and re-throwing it from `AdventureGate`'s render
 * body is the bridge.
 *
 * An `id` outside `KNOWN_ADVENTURE_IDS` (a typo'd `?adventure=`) takes the
 * same bridge: rather than a raw fetch failure, `state` starts out already
 * in `error` (set in `useState`'s lazy initializer, not the effect — an
 * effect setting state synchronously on mount is a react-hooks/no-op lint
 * error) with a message naming the bad id and the valid ones, so it lands on
 * the same "adventure could not be loaded" presentation as a real load error.
 */
function useAdventure(id: string): LoadState {
  const [state, setState] = useState<LoadState>(() =>
    isKnownAdventureId(id)
      ? { status: 'loading' }
      : {
          status: 'error',
          error: new Error(
            `Unknown adventure "${id}" (from ?adventure=). Known adventures: ${KNOWN_ADVENTURE_IDS.join(', ')}.`,
          ),
        },
  );

  useEffect(() => {
    if (!isKnownAdventureId(id)) return undefined;

    let cancelled = false;

    loadAdventure(fetchReader, `adventures/${id}`)
      .then((module) => {
        if (!cancelled) setState({ status: 'ready', module });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: 'error', error: toError(err) });
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  return state;
}

function AdventureGate({
  id,
  resume,
  onSelect,
}: {
  id: string;
  resume: GameState | null;
  onSelect: () => void;
}) {
  const adventure = useAdventure(id);
  // Replay (T10 stats screen): a fresh run of the SAME adventure can't change
  // `id`, so `key={id}` alone would never remount. This nonce, bumped by the
  // stats screen's Replay, becomes part of the key — a new nonce is a new
  // mount: empty transcript, turn 0, no resume.
  const [replayNonce, setReplayNonce] = useState(0);

  if (adventure.status === 'error') {
    // Re-thrown during render so the surrounding `ErrorBoundary` (which only
    // sees synchronous render-time throws) can catch it.
    throw adventure.error;
  }

  if (adventure.status === 'loading') {
    return (
      <main>
        <p>Loading the cave…</p>
      </main>
    );
  }

  return (
    <OverlayProvider>
      {/* `key` forces a fresh Game (and a fresh useGame session) whenever the
          adventure OR the replay nonce changes, so switching titles from the
          select screen — or replaying — never leaks one game's state into
          another. A replay carries no resume state. */}
      <Game
        key={`${id}-${replayNonce}`}
        module={adventure.module}
        resume={replayNonce === 0 ? resume : null}
        onReplay={() => {
          setReplayNonce((nonce) => nonce + 1);
        }}
        onSelect={onSelect}
      />
    </OverlayProvider>
  );
}

// The permanent settings context (T2, replacing T1's "temporary toggle is
// fine until T2" `useThemeToggle`). One provider wraps the whole app (see
// `App` at the bottom of this file) so `SettingsPanel.tsx` — a sibling file
// that imports `useSettings` from here — and `Game` below both read/write
// the same live `Settings` object, with every write persisted to
// `cave.settings` (uiState.ts) on the same render pass.
//
// `SettingsPanel` living in its own file but consuming a hook exported from
// this one makes App.tsx <-> SettingsPanel.tsx mutually importing (App
// renders <SettingsPanel/>, SettingsPanel calls useSettings from App). That
// is fine for ES modules — nothing here is touched at module-evaluation
// time, only inside component bodies, by which point both modules have
// finished loading — and keeps the file list to exactly what T2 specifies
// (no extra "context" file).

interface SettingsContextValue {
  settings: Settings;
  /** Merge a partial patch into the live settings and persist the result. */
  updateSettings: (patch: Partial<Settings>) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/** Read/update the global settings. Must be called under `<SettingsProvider>` (mounted once, in `App`). */
export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (value === null) {
    throw new Error('useSettings must be used inside <SettingsProvider>');
  }
  return value;
}

/**
 * Owns the one `Settings` object and the three DOM/CSS side effects it
 * drives (ui-plan §6): theme -> `data-theme` on `<html>`, text size ->
 * `--text-scale`, and persistence back to `cave.settings`. Transcript-only
 * is applied by `Game` itself (a class on the shell element, not a global
 * document effect) since it only affects markup already inside this
 * provider's tree; motion + typewriter speed are exposed via context only —
 * T3/T5 apply them where the animations actually live.
 */
function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  // Persist on every change. Also fires once on mount with the just-loaded
  // value — a harmless no-op write (same bytes back), not worth special-
  // casing away.
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // Theme -> `data-theme`. 'light' sets it, 'dark' removes it (theme.css's
  // :root is the dark theme by default), and 'system' tracks the OS live via
  // a MediaQueryList 'change' listener rather than reading it once — a
  // player who leaves the tab open across sunset should not need a reload.
  useEffect(() => {
    const root = document.documentElement;

    if (settings.theme === 'light') {
      root.dataset.theme = 'light';
      return undefined;
    }
    if (settings.theme === 'dark') {
      delete root.dataset.theme;
      return undefined;
    }

    const query = window.matchMedia('(prefers-color-scheme: light)');
    const applySystemTheme = () => {
      if (query.matches) root.dataset.theme = 'light';
      else delete root.dataset.theme;
    };
    applySystemTheme();
    query.addEventListener('change', applySystemTheme);
    return () => query.removeEventListener('change', applySystemTheme);
  }, [settings.theme]);

  // Text size -> `--text-scale` (theme.css defines the token and its `1`
  // default; this is the only place that ever overrides it).
  useEffect(() => {
    document.documentElement.style.setProperty('--text-scale', String(TEXT_SCALE_BY_STEP[settings.textSize]));
  }, [settings.textSize]);

  // T11 accessibility audit finding: `settings.reduceMotion` ("disable the
  // lamplight flicker and OTHER animation" per its own SettingsPanel label)
  // reached the flicker fine — `ScenePanel.tsx` reads it directly — but
  // nothing app-wide reflected it to CSS, so a purely decorative transition
  // like the onboarding card's fade-in was only ever killed by the OS-level
  // `prefers-reduced-motion` query, never by this in-app toggle. Mirrored
  // from the `data-theme` pattern just above: a `data-reduce-motion`
  // attribute on `<html>` lets app.css's reduced-motion rules key off EITHER
  // signal without threading the setting through every component that
  // animates.
  useEffect(() => {
    const root = document.documentElement;
    if (settings.reduceMotion) root.dataset.reduceMotion = 'true';
    else delete root.dataset.reduceMotion;
  }, [settings.reduceMotion]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const value = useMemo<SettingsContextValue>(() => ({ settings, updateSettings }), [settings, updateSettings]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

function Game({
  module,
  resume,
  onReplay,
  onSelect,
}: {
  module: AdventureModule;
  resume: GameState | null;
  /** T10 stats screen: start a fresh run of this same adventure (remount via AdventureGate's nonce). */
  onReplay: () => void;
  /** T10 stats screen: back to the adventure-select front door. */
  onSelect: () => void;
}) {
  // Hardcore (T6, ui-plan §5): read ONCE, at mount, from the per-adventure
  // sidecar — set by the new-game flow (T9, `setAdventureHardcore`) BEFORE
  // this component mounts, and never re-read, so the mode is locked for the
  // run. A lazy useState initializer rather than a plain call so a sidecar
  // write during play (journal notes share the object) can never flip it.
  const [hardcore] = useState(() => loadSidecar(module.manifest.id).hardcore);
  const { state, scene, actions, transcript, submit, load, pendingDeath, dismissDeath } = useGame(module, {
    hardcore,
  });
  const overlays = useOverlays();
  const { settings } = useSettings();

  // Continue-from-autosave (T9, ui-plan §7): if the select screen handed us a
  // resume state, adopt it once on mount. `load` is the same swap the save
  // dialog uses; running it in an effect (not during render) keeps useGame's
  // updater pure. The `key` on Game (AdventureGate) guarantees a fresh mount
  // per navigation, so this fires exactly once per continue and never re-runs
  // for a later turn's re-render.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resume !== null && !resumedRef.current) {
      resumedRef.current = true;
      load(resume);
    }
  }, [resume, load]);

  // T26's `i` shortcut moves focus to the inventory panel rather than
  // "doing" anything by itself — `InventoryPanel`'s own buttons are already
  // the click path (FR-2.7), so focusing it is the whole job. The wrapper div
  // (not `InventoryPanel` itself) carries the ref and `tabIndex={-1}`: T25's
  // component is out of this task's file list, and a focusable, otherwise
  // inert wrapper around it needs no change inside.
  const inventoryFocusRef = useRef<HTMLDivElement>(null);

  // T3's autocomplete dropdown (CommandInput.tsx) needs the engine's
  // `suggestions()`, which takes `module` + the live `GameState` — both
  // engine-side types CommandInput has no business importing. This closure
  // is the seam: CommandInput only ever sees `(prefix: string) => string[]`.
  const getSuggestions = useCallback((prefix: string) => suggestions(module, state, prefix), [module, state]);

  useKeyboard({
    onLook: () => {
      submit('look');
    },
    onInventoryFocus: () => {
      inventoryFocusRef.current?.focus();
    },
    onToggleMap: () => {
      overlays.toggle('map');
    },
    onToggleJournal: () => {
      overlays.toggle('journal');
    },
    onToggleHelp: () => {
      overlays.toggle('help');
    },
    onOpenSaveDialog: () => {
      overlays.open('saves');
    },
  });

  // Transcript-only (ui-plan §6) collapses the scene column via a class on
  // the shell root — app.css's `.shell--transcript-only` rules do the actual
  // hiding; this is the only place that class name gets decided.
  const shellClassName = settings.transcriptOnly ? 'shell shell--transcript-only' : 'shell';

  // The scene's lamp-warn tint (T5's `lampWarn` prop, wired here because
  // App.tsx was outside T5's file list): the SAME derivation StatusBar uses
  // for its 'low' state — fuel at or under the manifest's highest `warnAt`
  // threshold but not yet out. Out needs no tint; the dark plate takes over.
  const warnThreshold = module.manifest.lamp.warnAt.length > 0 ? Math.max(...module.manifest.lamp.warnAt) : 0;
  const lampWarn = state.lampFuel > 0 && state.lampFuel <= warnThreshold;

  return (
    <main className={shellClassName}>
      {/* First-run onboarding (T10): self-gating on the sidecar's
          onboardingSeen; non-modal, dismissible, never forced. */}
      <Onboarding adventureId={module.manifest.id} />

      <header className="shell__header">
        <h1 className="shell__title">{module.manifest.title}</h1>
        <div className="shell__header-actions">
          {/* Hints has no FR-2.8 shortcut — every free bare letter is a
              plausible command word — so a header button is its only door. */}
          <button
            type="button"
            onClick={() => {
              overlays.open('hints');
            }}
          >
            Hints
          </button>
          <button
            type="button"
            onClick={() => {
              overlays.open('settings');
            }}
          >
            Settings
          </button>
          <button
            type="button"
            onClick={() => {
              overlays.open('saves');
            }}
          >
            Save / Load
          </button>
          {/* Back to the adventure-select front door. Safe to offer without a
              confirm: the autosave effect (useGame.ts) has already written
              this turn, and the select screen's Continue resumes it — leaving
              is navigation, not abandonment. */}
          <button type="button" onClick={onSelect}>
            Adventures
          </button>
        </div>
        <StatusBar module={module} state={state} scene={scene} />
      </header>

      <div className="shell__body">
        <div className="shell__scene-region">
          <ScenePanel module={module} scene={scene} lampWarn={lampWarn} />
          <ActionBar actions={actions} onAction={submit} />
          <div className="shell__inventory-focus" ref={inventoryFocusRef} tabIndex={-1}>
            <InventoryPanel actions={actions} onAction={submit} />
          </div>
        </div>

        <div className="shell__transcript-region">
          <TranscriptPanel
            entries={transcript}
            typewriterSpeed={settings.typewriterSpeed}
            reduceMotion={settings.reduceMotion}
          />
          {/* The end-of-game summary is the T10 StatsScreen (mounted below),
              not an inline banner — it supersedes the old `.shell__ended`
              line, which showed the same victory/rank fact a second time. */}
          <CommandInput onSubmit={submit} suggest={getSuggestions} />
        </div>
      </div>

      <SaveDialog
        open={overlays.active === 'saves'}
        module={module}
        state={state}
        onLoad={(loaded) => {
          load(loaded);
          overlays.close();
        }}
        onClose={overlays.close}
        hideAutosaves={hardcore && state.ended === undefined}
      />
      <SettingsPanel />

      <DeathModal module={module} death={pendingDeath} onAccept={dismissDeath} onResume={load} />

      <MapOverlay module={module} state={state} />
      <JournalPanel module={module} state={state} adventureId={module.manifest.id} />
      <HintsPanel module={module} state={state} submit={submit} />
      <HelpPanel />

      {/* Post-game stats (T10): mounts unconditionally, reveals itself on
          state.ended after a short courtesy delay. Replay starts a fresh run
          of this adventure (remount via AdventureGate's nonce — same hardcore
          mode, read again from the unchanged sidecar); Select returns to the
          front door. */}
      <StatsScreen module={module} state={state} onReplay={onReplay} onSelect={onSelect} />
    </main>
  );
}

/**
 * Where the app is right now (T9, ui-plan §7): the adventure-select front
 * door, or in a specific adventure — optionally resuming a saved state.
 * `?adventure=<id>` deep-links straight to `game` (decision 3: the param
 * survives as a dev/link shortcut past the screen); a clean URL starts at
 * `select`.
 */
type Route = { screen: 'select' } | { screen: 'game'; id: string; resume: GameState | null };

function initialRoute(): Route {
  const params = new URLSearchParams(window.location.search);
  const deepLink = params.get('adventure');
  // A deep link goes straight in with no resume — the autosave ring is still
  // there for a manual load, but a URL is a "start here" instruction, not a
  // "resume" one, and matches the pre-T9 dev behavior the param preserved.
  if (deepLink !== null) return { screen: 'game', id: deepLink, resume: null };
  return { screen: 'select' };
}

export default function App() {
  const [route, setRoute] = useState<Route>(initialRoute);

  return (
    <SettingsProvider>
      <ErrorBoundary>
        {route.screen === 'select' ? (
          <AdventureSelect
            onNewGame={(id, hardcore) => {
              // The one write that sets a run's mode, BEFORE Game mounts and
              // reads it (ui-plan §12.2). A fresh run has no resume state.
              setAdventureHardcore(id, hardcore);
              setRoute({ screen: 'game', id, resume: null });
            }}
            onContinue={(id, state) => {
              setRoute({ screen: 'game', id, resume: state });
            }}
          />
        ) : (
          <AdventureGate
            id={route.id}
            resume={route.resume}
            onSelect={() => {
              setRoute({ screen: 'select' });
            }}
          />
        )}
      </ErrorBoundary>
    </SettingsProvider>
  );
}
