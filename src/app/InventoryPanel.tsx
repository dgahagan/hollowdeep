import type { UIAction } from '../engine/types';

// Inventory rows (design plan §6, T25; FR-2.7). Same source as `ActionBar` —
// `availableActions()` — filtered to `group === 'inventory'`, the other half
// of the exit/item vs. inventory split.
//
// One ROW per carried item — the item's name, then a bare-verb button per
// available action ("Examine", "Drop", "Light") — instead of a flat pile of
// full-sentence buttons ("Examine brass lantern", "Drop brass lantern", …),
// which repeated every noun as many times as it had verbs. The engine
// supplies the split (`UIAction.verbLabel`/`noun`, view.ts) so nothing here
// parses labels. Buttons keep the full command as their aria-label — a
// screen reader hears "Drop brass lantern", not a bare "Drop" torn from its
// row's context.
export interface InventoryPanelProps {
  actions: UIAction[];
  onAction: (command: string) => void;
}

interface InventoryRow {
  key: string;
  name: string;
  actions: UIAction[];
}

function toRows(inventory: UIAction[]): InventoryRow[] {
  const rows = new Map<string, InventoryRow>();
  for (const action of inventory) {
    const key = action.targetId ?? action.command;
    const existing = rows.get(key);
    if (existing !== undefined) {
      existing.actions.push(action);
    } else {
      rows.set(key, { key, name: action.noun ?? action.label, actions: [action] });
    }
  }
  return [...rows.values()];
}

export function InventoryPanel({ actions, onAction }: InventoryPanelProps) {
  const inventory = actions.filter((action) => action.group === 'inventory');

  return (
    <section className="inventory-panel" aria-label="Inventory">
      <h3>Inventory</h3>
      {inventory.length === 0 ? (
        <p className="inventory-panel__hint">You are carrying nothing.</p>
      ) : (
        <ul className="inventory-panel__rows">
          {toRows(inventory).map((row) => (
            <li key={row.key} className="inventory-panel__row">
              <span className="inventory-panel__item-name">{row.name}</span>
              <span className="inventory-panel__row-actions">
                {row.actions.map((action) => (
                  <button
                    key={action.command}
                    type="button"
                    aria-label={action.label}
                    onClick={() => {
                      onAction(action.command);
                    }}
                  >
                    {action.verbLabel ?? action.label}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
