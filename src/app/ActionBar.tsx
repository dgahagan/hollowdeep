import type { UIAction } from '../engine/types';

// Exit + context-verb buttons (design plan §6, T25; FR-2.7). Built entirely
// from `availableActions()` (src/engine/view.ts) — every `UIAction.command`
// round-trips through the real `step` (T22's acceptance criterion), so this
// component never second-guesses which buttons to show; it only renders and
// dispatches what the engine already vetted. `group` is what splits this
// component (`exit` + `item`) from `InventoryPanel` (`inventory`).
export interface ActionBarProps {
  actions: UIAction[];
  onAction: (command: string) => void;
}

export function ActionBar({ actions, onAction }: ActionBarProps) {
  const exits = actions.filter((action) => action.group === 'exit');
  const items = actions.filter((action) => action.group === 'item');

  return (
    <section className="action-bar" aria-label="Actions">
      {exits.length === 0 && items.length === 0 ? (
        <p className="action-bar__hint">Nothing to click here — try typing.</p>
      ) : (
        <>
          {exits.length > 0 && (
            <div className="action-bar__group">
              <h3>Exits</h3>
              <div className="action-bar__buttons">
                {exits.map((action) => (
                  <button
                    key={`${action.group}:${action.command}`}
                    type="button"
                    onClick={() => {
                      onAction(action.command);
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {items.length > 0 && (
            <div className="action-bar__group">
              <h3>Here</h3>
              <div className="action-bar__buttons">
                {items.map((action) => (
                  <button
                    key={`${action.group}:${action.command}`}
                    type="button"
                    onClick={() => {
                      onAction(action.command);
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
