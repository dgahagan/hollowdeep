import type { AdventureModule } from '../engine/schema';
import type { GameState, SceneView } from '../engine/types';

// Location, score, turn, and a lamp gauge (design plan §6, T25). Reads
// `module.manifest.lamp.startFuel` as the gauge's maximum and
// `module.manifest.lamp.warnAt` for its warning threshold — both are
// manifest-level (design plan §4.1: one lamp per adventure by construction,
// `GameState` tracks a single `lampFuel` number), and `module.manifest.maxScore`
// as the score denominator.
export interface StatusBarProps {
  module: AdventureModule;
  state: GameState;
  scene: SceneView;
}

export function StatusBar({ module, state, scene }: StatusBarProps) {
  const { lamp, maxScore } = module.manifest;
  const lampMax = lamp.startFuel;
  const lampFuel = Math.max(0, state.lampFuel);
  const lampPercent = lampMax > 0 ? Math.min(100, Math.round((lampFuel / lampMax) * 100)) : 0;
  const warnThreshold = lamp.warnAt.length > 0 ? Math.max(...lamp.warnAt) : 0;
  const lampStatus = lampFuel <= 0 ? 'out' : lampFuel <= warnThreshold ? 'low' : 'ok';

  return (
    <section className="status-bar" aria-label="Status">
      <span className="status-bar__item">
        <span className="status-bar__label">Location</span>
        {scene.name}
      </span>
      <span className="status-bar__item">
        <span className="status-bar__label">Score</span>
        {state.score} / {maxScore}
      </span>
      <span className="status-bar__item">
        <span className="status-bar__label">Turn</span>
        {state.turn}
      </span>
      <span className={`status-bar__item status-bar__lamp status-bar__lamp--${lampStatus}`}>
        <span className="status-bar__label">Lamp</span>
        <span
          className="status-bar__lamp-gauge"
          role="img"
          aria-label={`Lamp fuel: ${lampFuel} of ${lampMax}, ${lampStatus}`}
        >
          <span className="status-bar__lamp-fill" style={{ width: `${lampPercent}%` }} />
        </span>
      </span>
    </section>
  );
}
