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
import { loadSettings, saveSettings, TEXT_SCALE_BY_STEP, type Settings } from './uiState';
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
 * Adventures this dev build knows how to find on disk (`adventures/<id>`).
 * Not Phase 3's adventure-select screen — just enough to let `?adventure=`
 * pick Hollowdeep or fall back to the `test-cave` fixture without a select
 * UI or any chrome. T9 replaces this with the real front door.
 */
const KNOWN_ADVENTURE_IDS = ['hollowdeep', 'test-cave'] as const;
type KnownAdventureId = (typeof KNOWN_ADVENTURE_IDS)[number];

const DEFAULT_ADVENTURE_ID: KnownAdventureId = 'hollowdeep';

function isKnownAdventureId(id: string): id is KnownAdventureId {
  return (KNOWN_ADVENTURE_IDS as readonly string[]).includes(id);
}

/**
 * Which adventure to load: `?adventure=<id>` in the URL, defaulting to
 * Hollowdeep. Reads `window.location.search` directly rather than a router —
 * this is a dev convenience, not the Phase 3 select screen, so there's
 * nothing else in the URL to coordinate with.
 */
function adventureIdFromLocation(): string {
  return new URLSearchParams(window.location.search).get('adventure') ?? DEFAULT_ADVENTURE_ID;
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

function AdventureGate({ id }: { id: string }) {
  const adventure = useAdventure(id);

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
      <Game module={adventure.module} />
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

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const value = useMemo<SettingsContextValue>(() => ({ settings, updateSettings }), [settings, updateSettings]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

function Game({ module }: { module: AdventureModule }) {
  const { state, scene, actions, transcript, submit, load } = useGame(module);
  const overlays = useOverlays();
  const { settings } = useSettings();

  // T26's `i` shortcut moves focus to the inventory panel rather than
  // "doing" anything by itself — `InventoryPanel`'s own buttons are already
  // the click path (FR-2.7), so focusing it is the whole job. The wrapper div
  // (not `InventoryPanel` itself) carries the ref and `tabIndex={-1}`: T25's
  // component is out of this task's file list, and a focusable, otherwise
  // inert wrapper around it needs no change inside.
  const inventoryFocusRef = useRef<HTMLDivElement>(null);

  useKeyboard({
    onLook: () => {
      submit('look');
    },
    onInventoryFocus: () => {
      inventoryFocusRef.current?.focus();
    },
    onOpenSaveDialog: () => {
      overlays.open('saves');
    },
  });

  // Transcript-only (ui-plan §6) collapses the scene column via a class on
  // the shell root — app.css's `.shell--transcript-only` rules do the actual
  // hiding; this is the only place that class name gets decided.
  const shellClassName = settings.transcriptOnly ? 'shell shell--transcript-only' : 'shell';

  return (
    <main className={shellClassName}>
      <header className="shell__header">
        <h1 className="shell__title">{module.manifest.title}</h1>
        <div className="shell__header-actions">
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
        </div>
        <StatusBar module={module} state={state} scene={scene} />
      </header>

      <div className="shell__body">
        <div className="shell__scene-region">
          <ScenePanel module={module} scene={scene} />
          <ActionBar actions={actions} onAction={submit} />
          <div className="shell__inventory-focus" ref={inventoryFocusRef} tabIndex={-1}>
            <InventoryPanel actions={actions} onAction={submit} />
          </div>
        </div>

        <div className="shell__transcript-region">
          <TranscriptPanel entries={transcript} />
          {state.ended && (
            <p className="shell__ended">
              {state.ended.victory ? 'Victory!' : 'Game over.'} Final rank: {state.ended.rank}
            </p>
          )}
          <CommandInput onSubmit={submit} />
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
      />
      <SettingsPanel />
    </main>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <ErrorBoundary>
        <AdventureGate id={adventureIdFromLocation()} />
      </ErrorBoundary>
    </SettingsProvider>
  );
}
