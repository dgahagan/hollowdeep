import { useEffect, useState } from 'react';
import type { AdventureModule } from '../engine/schema';
import type { GameState } from '../engine/types';
import { loadAdventure } from '../loader';
import { loadGame, SaveError } from '../engine/save';
import { fetchReader } from './fetchReader';
import { readSave, AUTOSAVE_SLOTS } from './storage';

// The front door (T9, ui-plan §7): a landing screen that lists the known
// adventures with title, blurb, and cover art, offers continue-from-autosave
// when a run exists, shows per-adventure achievement progress, and owns the
// new-game flow — which is where the hardcore choice is made and locked
// (ui-plan §12.2). `?adventure=` deep-links straight past this screen (App
// handles that); this component is what a player with a clean URL sees first.
//
// **Blurbs are UI copy, not module content.** The engine's manifest carries
// no tagline field, and adding one would be an engine change (§2 —
// stop-and-report). A one-line pitch for a launcher card is presentation
// text by nature, so it lives here in the registry below; the TITLE, by
// contrast, is read from the loaded module so it can never drift from the
// game's own name.

interface RegistryEntry {
  id: string;
  blurb: string;
}

/**
 * The adventures this build ships. Order is display order. `test-cave` is the
 * format fixture — playable, but presented as what it is so a first-time
 * player reaches for Hollowdeep.
 */
const REGISTRY: RegistryEntry[] = [
  {
    id: 'hollowdeep',
    blurb: 'A drowned mining town, ninety years empty, and a payroll nobody came back for. Fill your pockets, keep your lamp, and mind the dark — it has had a long time to get hungry.',
  },
  {
    id: 'test-cave',
    blurb: 'The reference fixture — a tiny cave that exercises the module format. Short, plain, and mostly here for the engine.',
  },
];

/** Everything a card needs, resolved asynchronously from the module + storage. */
interface CardData {
  entry: RegistryEntry;
  status: 'loading' | 'ready' | 'error';
  module?: AdventureModule;
  /** The newest valid autosave, if any — powers "Continue" and the progress line. */
  resume?: { state: GameState } | null;
  achievementsEarned?: number;
  achievementsTotal?: number;
}

/**
 * The newest valid autosave for an adventure, or null. The ring holds RAW
 * engine saves (storage.ts), so each is `loadGame`'d directly; a slot that
 * fails to parse or validate is skipped, not fatal — the front door must
 * render even if one save is corrupt. "Newest" is the highest `turn`.
 */
function newestAutosave(module: AdventureModule): { state: GameState } | null {
  let best: { state: GameState; turn: number } | null = null;
  for (let index = 0; index < AUTOSAVE_SLOTS; index++) {
    const raw = readSave(module.manifest.id, 'auto', index);
    if (raw === undefined) continue;
    try {
      const state = loadGame(module, JSON.parse(raw));
      if (best === null || state.turn > best.turn) best = { state, turn: state.turn };
    } catch (err) {
      if (err instanceof SaveError || err instanceof SyntaxError) continue;
      throw err;
    }
  }
  return best === null ? null : { state: best.state };
}

export interface AdventureSelectProps {
  /** Start a fresh run; `hardcore` is chosen here and locked for the run (ui-plan §12.2). */
  onNewGame: (id: string, hardcore: boolean) => void;
  /** Resume the newest autosave. */
  onContinue: (id: string, state: GameState) => void;
}

export function AdventureSelect({ onNewGame, onContinue }: AdventureSelectProps) {
  const [cards, setCards] = useState<CardData[]>(() =>
    REGISTRY.map((entry) => ({ entry, status: 'loading' })),
  );
  // Per-card hardcore intent for the NEXT new game (not persisted until the
  // player actually starts — the sidecar write happens in App's onNewGame).
  const [hardcoreIntent, setHardcoreIntent] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;

    Promise.all(
      REGISTRY.map(async (entry): Promise<CardData> => {
        try {
          const module = await loadAdventure(fetchReader, `adventures/${entry.id}`);
          const resume = newestAutosave(module);
          return {
            entry,
            status: 'ready',
            module,
            resume,
            achievementsEarned: resume?.state.achievements.length ?? 0,
            achievementsTotal: module.achievements.length,
          };
        } catch {
          return { entry, status: 'error' };
        }
      }),
    )
      .then((resolved) => {
        if (!cancelled) setCards(resolved);
      })
      // Each entry's own try/catch already downgrades a failed load to an
      // `error` card, so `Promise.all` cannot reject here — this handler
      // exists only to satisfy no-floating-promises, and marks any truly
      // unexpected rejection instead of swallowing it silently.
      .catch(() => {
        if (!cancelled) setCards((previous) => previous.map((card) => ({ ...card, status: 'error' })));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="select">
      <header className="select__header">
        <h1 className="select__title">Hollowdeep</h1>
        <p className="select__subtitle">An adventure in the dark. Choose where to begin.</p>
      </header>

      <ul className="select__list">
        {cards.map((card) => (
          <AdventureCard
            key={card.entry.id}
            card={card}
            hardcore={hardcoreIntent[card.entry.id] ?? false}
            onHardcoreChange={(value) => {
              setHardcoreIntent((previous) => ({ ...previous, [card.entry.id]: value }));
            }}
            onNewGame={onNewGame}
            onContinue={onContinue}
          />
        ))}
      </ul>
    </main>
  );
}

interface AdventureCardProps {
  card: CardData;
  hardcore: boolean;
  onHardcoreChange: (value: boolean) => void;
  onNewGame: (id: string, hardcore: boolean) => void;
  onContinue: (id: string, state: GameState) => void;
}

function AdventureCard({ card, hardcore, onHardcoreChange, onNewGame, onContinue }: AdventureCardProps) {
  const { entry, module, status, resume } = card;

  const title = module?.manifest.title ?? entry.id;

  // Cover candidates, in order: the marquee title plate, then the start
  // location's own scene art. Not every adventure has a marquee —
  // test-cave's art set is frozen without one (art-implementation-plan,
  // deferred table) — but every adventure has a start location with art, so
  // the second candidate makes a blank cover the exception rather than the
  // rule. `coverIndex` advances on load error; past the end, the quiet
  // plate keeps the card's shape (art-plan §7's placeholder tolerance).
  const coverCandidates: string[] = [];
  if (module !== undefined) {
    coverCandidates.push(
      `${import.meta.env.BASE_URL}adventures/${entry.id}/art/marquee-title.${module.manifest.artFormat}`,
    );
    const startArtId = module.locations.find((l) => l.id === module.manifest.startLocation)?.artId;
    if (startArtId !== undefined) {
      coverCandidates.push(
        `${import.meta.env.BASE_URL}adventures/${entry.id}/art/${startArtId}.${module.manifest.artFormat}`,
      );
    }
  }
  const [coverIndex, setCoverIndex] = useState(0);
  const coverUrl = coverCandidates[coverIndex];

  return (
    <li className="select-card">
      <div className="select-card__cover">
        {coverUrl !== undefined ? (
          <img
            className="select-card__cover-img"
            src={coverUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => {
              setCoverIndex((prev) => prev + 1);
            }}
          />
        ) : (
          <div className="select-card__cover-plate" aria-hidden="true" />
        )}
      </div>

      <div className="select-card__body">
        <h2 className="select-card__title">{title}</h2>
        <p className="select-card__blurb">{entry.blurb}</p>

        {status === 'error' && (
          <p className="select-card__error">This adventure could not be loaded.</p>
        )}

        {status === 'ready' && (
          <>
            {card.achievementsTotal !== undefined && card.achievementsTotal > 0 && (
              <p className="select-card__progress">
                Achievements: {card.achievementsEarned} / {card.achievementsTotal}
              </p>
            )}

            <div className="select-card__actions">
              {resume != null && (
                <button
                  type="button"
                  className="select-card__continue"
                  onClick={() => {
                    onContinue(entry.id, resume.state);
                  }}
                >
                  Continue (turn {resume.state.turn})
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  onNewGame(entry.id, hardcore);
                }}
              >
                New game
              </button>
              <label className="select-card__hardcore">
                <input
                  type="checkbox"
                  checked={hardcore}
                  onChange={(event) => {
                    onHardcoreChange(event.target.checked);
                  }}
                />
                Hardcore — no rescue, no undo
              </label>
            </div>
          </>
        )}
      </div>
    </li>
  );
}
