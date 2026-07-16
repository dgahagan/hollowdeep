import type { UIAction } from '../engine/types';

// Inventory item buttons (design plan §6, T25; FR-2.7). Same source as
// `ActionBar` — `availableActions()` — filtered to `group === 'inventory'`,
// the other half of the exit/item vs. inventory split.
export interface InventoryPanelProps {
  actions: UIAction[];
  onAction: (command: string) => void;
}

export function InventoryPanel({ actions, onAction }: InventoryPanelProps) {
  const inventory = actions.filter((action) => action.group === 'inventory');

  return (
    <section className="inventory-panel" aria-label="Inventory">
      <h3>Inventory</h3>
      {inventory.length === 0 ? (
        <p className="inventory-panel__hint">You are carrying nothing.</p>
      ) : (
        <div className="inventory-panel__buttons">
          {inventory.map((action) => (
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
      )}
    </section>
  );
}
