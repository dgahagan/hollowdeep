import { useEffect } from 'react';
import { DIRECTIONS, type AdventureModule } from '../engine/schema';
import type { SceneView } from '../engine/types';
import { useSettings } from './App';
import { preloadImages } from './preload';

// The scene's art panel (design plan §6, T25; T5 adds preloading + ambient
// lamplight, ui-plan §3/§9). Renders the file committed under
// `adventures/<id>/art/<artId>.<format>`, published to
// `/adventures/<id>/art/...` by `vite.config.ts`'s copy-adventures plugin.
//
// The extension comes from `manifest.artFormat`, never a hardcoded `.svg`. It
// cannot be discovered at runtime — a browser loads art by URL and cannot list
// a directory over HTTP — so the adventure declares it, and `checkConsistency`
// verifies the files match what was declared. Hardcoding `.svg` here (which an
// earlier version did) meant a module shipping WebP validated green and served
// broken images.
//
// **In the dark there is no picture.** `describeScene` omits `artId` entirely
// when `dark` (src/engine/view.ts), because a picture of the room is the one
// thing a player who cannot see plainly cannot see. This panel therefore has
// to handle its absence, and draws a blank plate instead.
//
// Alt text is the LOCATION'S BRIEF (NFR-5: art carries alt text = location
// short description), not `scene.description` — the two differ in verbose mode,
// where `description` becomes `location.full`. `SceneView` carries no bare
// `brief`, so it is looked up in `module.locations` by `scene.locationId`.
// That lookup is safe ONLY in the lit branch: reaching past `SceneView` into
// the module is how a UI accidentally re-reveals what the engine withheld, so
// in the dark the plate is labelled with `scene.description` — the adventure's
// darkness warning, which is exactly what a sighted player reads in the caption
// below it. Both kinds of player learn the same thing, which is the whole idea.
//
// **Preloading (NFR-3: scene swap < 200 ms).** On every arrival, this
// component looks up the CURRENT location's exits in `module.locations` (not
// `scene.exits` — that list is spoiler-filtered to hidden/unmet-condition
// exits per view.ts, but preloading a file in the background reveals nothing
// to the player either way, so there is no reason to under-fetch) and warms
// the browser's cache for every destination's art via `preload.ts`. That
// makes the swap on whichever exit the player actually takes a cache hit
// instead of a network round trip.
//
// **Lamplight flicker (ui-plan §3, decision 2).** A slow ambient flicker is a
// CSS animation on a gradient overlay stacked ON TOP of the `<img>` —
// deliberately never a transform/filter on the image element itself, so the
// art asset always paints crisp and the animation is free to composite on its
// own layer. Gated off by TWO independent switches, both required by standing
// rule #3: the in-app `settings.reduceMotion` toggle (read here via
// `useSettings`, imported from `./App` — the same circular-import pattern
// `SettingsPanel.tsx` already uses, since `App.tsx` owns the provider) turns
// off the `--flicker` modifier class in JS, and the OS-level
// `prefers-reduced-motion: reduce` query kills the keyframes entirely in CSS
// (`app.css`) — belt and suspenders, and neither one depends on the other
// working.
//
// **Lamp-state tint.** `SceneView` (src/engine/types.ts) carries NO lamp-fuel
// signal — `StatusBar.tsx` derives its low/out gauge from `state.lampFuel`
// directly against `module.manifest.lamp.warnAt`, but `state: GameState` is
// not part of this component's props (`App.tsx` calls `<ScenePanel module
// scene />` only, and T5's file list does not include `App.tsx`). So there is
// nothing "usable here" beyond `scene.dark` itself — which already routes to
// the no-picture dark plate below, a different state entirely from "lit, but
// the lamp is dying." The tint machinery is built and wired to an OPTIONAL
// `lampWarn` prop instead: inert today (nothing currently passes it, and the
// default is `false`), ready for whichever later task threads a lamp-warning
// boolean down from `state.lampFuel <= warnThreshold` without requiring an
// engine change. Flagged in T5's report rather than silently left unwired.

export interface ScenePanelProps {
  module: AdventureModule;
  scene: SceneView;
  /** See "Lamp-state tint" above — no current caller passes this; defaults to off. */
  lampWarn?: boolean;
  /**
   * A just-examined subject's art (uiState.ts `activeInspect`): shown in
   * place of the room's painting for exactly one turn — the next command of
   * any kind reverts. Never present in the dark: the engine only emits
   * `inspect` events when the player can see (actions/senses.ts).
   */
  inspect?: { artId: string; name: string } | null;
}

/** Same `<artId>.<format>` convention as the render below, shared (also by InventoryPanel's thumbnails) so nothing drifts from it. */
export function artUrl(module: AdventureModule, artId: string): string {
  return `/adventures/${module.manifest.id}/art/${artId}.${module.manifest.artFormat}`;
}

export function ScenePanel({ module, scene, lampWarn = false, inspect = null }: ScenePanelProps) {
  const { settings } = useSettings();
  const location = module.locations.find((candidate) => candidate.id === scene.locationId);
  // The inspect view borrows the panel wholesale: its art, its alt. `dark`
  // still wins — the engine never emits inspect in the dark, but a stale
  // transcript after a load could in principle disagree, and the dark plate
  // is the boundary that must not lose.
  const showInspect = inspect !== null && !scene.dark;
  const shownArtId = showInspect ? inspect.artId : scene.artId;
  const altText = showInspect ? inspect.name : (location?.brief ?? scene.description);

  // Preload every exit-adjacent location's art on arrival. Re-derives the
  // current location from `module.locations` INSIDE the effect (rather than
  // depending on the `location` computed above) so the dependency array can
  // name exactly what triggers a re-run: a fresh `module` (a different
  // adventure loaded) or a new `scene.locationId` (the player moved) — not
  // "some object changed identity," which would be true on every render for
  // no reason.
  useEffect(() => {
    const here = module.locations.find((candidate) => candidate.id === scene.locationId);
    if (here === undefined) return;

    const urls: string[] = [];
    for (const dir of DIRECTIONS) {
      const exit = here.exits[dir];
      if (exit === undefined) continue;
      const destination = module.locations.find((candidate) => candidate.id === exit.to);
      if (destination === undefined) continue; // a malformed module would fail `validate`, not this
      urls.push(artUrl(module, destination.artId));
    }
    if (urls.length > 0) preloadImages(urls);
  }, [module, scene.locationId]);

  // Both motion gates (see header comment): the settings toggle decides
  // whether the `--flicker` class is even present; CSS's own
  // `@media (prefers-reduced-motion: reduce)` (app.css) additionally kills the
  // animation regardless of this class, for a player whose OS asks for less
  // motion but who has not (or cannot) find this app's own setting.
  const ambientClassName = [
    'scene-panel__ambient',
    settings.reduceMotion ? '' : 'scene-panel__ambient--flicker',
    lampWarn ? 'scene-panel__ambient--warn' : '',
  ]
    .filter((token) => token !== '')
    .join(' ');

  return (
    <section className="scene-panel" aria-label="Scene">
      {shownArtId === undefined ? (
        <div className="scene-panel__art scene-panel__art--dark" role="img" aria-label={scene.description} />
      ) : (
        <div className="scene-panel__art-wrap">
          <img
            className={showInspect ? 'scene-panel__art scene-panel__art--inspect' : 'scene-panel__art'}
            src={artUrl(module, shownArtId)}
            alt={altText}
            width={512}
            height={288}
          />
          {/* Decorative only — the room is already described by the `<img>`'s
              alt text above, so screen readers must skip this overlay entirely. */}
          <div className={ambientClassName} aria-hidden="true" />
        </div>
      )}
      {showInspect && <p className="scene-panel__contents scene-panel__inspect-caption">Examining: {inspect.name}</p>}
      <h2 className="scene-panel__name">{scene.name}</h2>
      <p className="scene-panel__description">{scene.description}</p>
      {/* What's here, right now — `scene.items` already includes the visible
          contents of open containers and `scene.creatures` whoever is present
          (view.ts), both empty in the dark. Without these lines a
          thief-dropped treasure exists only as a sidebar button; the panel is
          the current-state caption, so it says what the room would say. */}
      {scene.items.map((item) => (
        <p key={item.id} className="scene-panel__description scene-panel__contents">
          {item.brief}
        </p>
      ))}
      {scene.creatures.map((creature) => (
        <p key={creature.id} className="scene-panel__description scene-panel__contents">
          {creature.description}
        </p>
      ))}
    </section>
  );
}
