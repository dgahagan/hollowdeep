import type { AdventureModule } from '../engine/schema';
import type { GameState, SceneView } from '../engine/types';
import { getItemState } from '../engine/state';
import { useSettings } from './App';

// Location, score, turn, and a lamp gauge (design plan §6, T25). Reads
// `module.manifest.lamp.startFuel` as the gauge's maximum and
// `module.manifest.lamp.warnAt` for its warning threshold — both are
// manifest-level (design plan §4.1: one lamp per adventure by construction,
// `GameState` tracks a single `lampFuel` number), and `module.manifest.maxScore`
// as the score denominator.
//
// The gauge also says whether the lamp is BURNING — "Lamp · lit" plus the
// warm fill (a gentle pulse unless motion is reduced) versus a plain "Lamp"
// over a dimmed fill. Fuel burns only while lit (systems/light.ts), so
// lit-ness is the single fact that decides whether the number is falling;
// hiding it made extinguish-discipline unlearnable. Information, not
// difficulty: the character holding the lamp can see the flame.
export interface StatusBarProps {
  module: AdventureModule;
  state: GameState;
  scene: SceneView;
}

export function StatusBar({ module, state, scene }: StatusBarProps) {
  const { settings } = useSettings();
  const { lamp, maxScore } = module.manifest;
  const lampMax = lamp.startFuel;
  const lampFuel = Math.max(0, state.lampFuel);
  const lampPercent = lampMax > 0 ? Math.min(100, Math.round((lampFuel / lampMax) * 100)) : 0;
  const warnThreshold = lamp.warnAt.length > 0 ? Math.max(...lamp.warnAt) : 0;
  const lampStatus = lampFuel <= 0 ? 'out' : lampFuel <= warnThreshold ? 'low' : 'ok';
  const lampLit = getItemState(state, lamp.itemId).lit === true;
  const lampClassName = [
    'status-bar__item',
    'status-bar__lamp',
    `status-bar__lamp--${lampStatus}`,
    lampLit ? 'status-bar__lamp--lit' : 'status-bar__lamp--unlit',
    lampLit && !settings.reduceMotion ? 'status-bar__lamp--pulse' : '',
  ]
    .filter((token) => token !== '')
    .join(' ');

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
      <span className={lampClassName}>
        <span className="status-bar__label">{lampLit ? 'Lamp · lit' : 'Lamp'}</span>
        <span
          className="status-bar__lamp-gauge"
          role="img"
          aria-label={`Lamp fuel: ${lampFuel} of ${lampMax}, ${lampStatus}, ${lampLit ? 'lit' : 'unlit'}`}
        >
          <span className="status-bar__lamp-fill" style={{ width: `${lampPercent}%` }} />
        </span>
      </span>
    </section>
  );
}
