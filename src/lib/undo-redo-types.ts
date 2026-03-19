export type EntityType =
  | "transactions"
  | "beneficiaries"
  | "categories"
  | "tags"
  | "accounts";

export interface UndoableAction {
  type: "field_update" | "status_change" | "tags_update" | "bulk_status_change";
  entityType: EntityType;
  entityId: string;
  /** For bulk operations, multiple entity IDs */
  entityIds?: string[];
  /** Previous values — sent to server on undo */
  oldValues: Record<string, unknown>;
  /** New values — sent to server on redo */
  newValues: Record<string, unknown>;
  /** Human-readable description for toast, e.g. "Categoria → Alimentação" */
  description: string;
  timestamp: number;
}

/** Compute the inverse of an action (swap old ↔ new) */
export function invertAction(action: UndoableAction): UndoableAction {
  return {
    ...action,
    oldValues: action.newValues,
    newValues: action.oldValues,
  };
}
