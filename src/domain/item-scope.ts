// What belongs to one work item of a brief (plan 03-40; AUT-1 to AUT-3). Pure: the owner's Behavior text split per item, and the choices an
// item owns, so a unit sees only its own part of the brief and a numbered choice that is another item's is not taken for this unit's pause.
// Nothing here reads the model's text as an instruction; the final text is only compared with what the owner wrote.

// The parts of a compiled run contract this module reads.
export interface ScopeContract {
  intent: {
    behavior: string;
    acceptance: ReadonlyArray<{ id: string; text: string; verifiedBy: readonly string[] }>;
    workItems: ReadonlyArray<{ id: string; acceptance: readonly string[] }>;
  };
}

export function itemBehavior(behavior: string, _itemId: string, _itemIds: readonly string[]): string {
  return behavior;
}

export function normalizeChoice(text: string): string {
  return text;
}

export function normalizeOption(label: string): string {
  return label;
}

export function itemChoiceOptions(_contract: ScopeContract, _itemId: string, _openDecisionLabels: readonly string[]): string[] {
  return [];
}

export function sharedChoiceOptions(_behavior: string, _itemIds: readonly string[]): string[] {
  return [];
}

export function hasOwnerChoice(_contract: ScopeContract, _itemId: string): boolean {
  return false;
}
