import type { AdventureModule } from '../engine/schema';
import type { SceneView } from '../engine/types';

// Placeholder art panel (design plan §6, T25). Renders the SVG committed
// under `adventures/<id>/art/<artId>.svg` (T10), published to
// `/adventures/<id>/art/<artId>.svg` by `vite.config.ts`'s copy-adventures
// plugin. Every file in `adventures/test-cave/art/` is `.svg` — the extension
// is hardcoded on that basis, same as T10's generator hardcodes it on the
// write side.
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

export interface ScenePanelProps {
  module: AdventureModule;
  scene: SceneView;
}

export function ScenePanel({ module, scene }: ScenePanelProps) {
  const location = module.locations.find((candidate) => candidate.id === scene.locationId);
  const altText = location?.brief ?? scene.description;

  return (
    <section className="scene-panel" aria-label="Scene">
      {scene.artId === undefined ? (
        <div className="scene-panel__art scene-panel__art--dark" role="img" aria-label={scene.description} />
      ) : (
        <img
          className="scene-panel__art"
          src={`/adventures/${module.manifest.id}/art/${scene.artId}.svg`}
          alt={altText}
          width={512}
          height={288}
        />
      )}
      <h2 className="scene-panel__name">{scene.name}</h2>
      <p className="scene-panel__description">{scene.description}</p>
    </section>
  );
}
