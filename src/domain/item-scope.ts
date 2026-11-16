// What belongs to one work item of a brief (plan 03-40; AUT-1 to AUT-3). Pure: the owner's Behavior text split per item, and the choices an
// item owns, so a unit sees only its own part of the brief and a numbered choice that is another item's is not taken for this unit's pause.
// Nothing here reads the model's text as an instruction; the final text is only compared with what the owner wrote.
//
// A Behavior is split into paragraphs by blank lines. A paragraph is labelled for an item when its first non-empty line starts with `Item <id>:` or
// `Work item <id>:` for an item ID of the brief. An unlabelled paragraph is shared. A Behavior that labels no paragraph is given whole, to every item:
// text that cannot be attributed is never hidden.

// The parts of a compiled run contract this module reads.
export interface ScopeContract {
  intent: {
    behavior: string;
    acceptance: ReadonlyArray<{ id: string; text: string; verifiedBy: readonly string[] }>;
    workItems: ReadonlyArray<{ id: string; acceptance: readonly string[] }>;
  };
}

const PARAGRAPH_BREAK = /(?:\r?\n[ \t]*){2,}/;
const LABEL = /^(?:work\s+)?item\s+([^\s:]+)\s*:/i;
const NUMBERED_LINE = /^\s*\d+\.\s+\S/;
const NUMBER_PREFIX = /^\s*\d+\.\s*/;
const QUOTES_AND_TICKS = /[`'’‘"“”]/g;
const DECISION_REF = 'decision:';

interface Paragraph {
  text: string;
  // The item the paragraph is labelled for; null when it is shared.
  label: string | null;
}

function paragraphsOf(behavior: string, itemIds: readonly string[]): Paragraph[] {
  return behavior
    .split(PARAGRAPH_BREAK)
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .map((text) => {
      const first = text.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
      const id = LABEL.exec(first.trim())?.[1];
      return { text, label: id !== undefined && itemIds.includes(id) ? id : null };
    });
}

// The Behavior one item's unit is shown: the paragraphs labelled for it and every unlabelled paragraph, in their original order, joined by a blank line.
// A Behavior with no labelled paragraph is returned unchanged.
export function itemBehavior(behavior: string, itemId: string, itemIds: readonly string[]): string {
  const paragraphs = paragraphsOf(behavior, itemIds);
  if (!paragraphs.some((p) => p.label !== null)) return behavior;
  return paragraphs
    .filter((p) => p.label === null || p.label === itemId)
    .map((p) => p.text)
    .join('\n\n');
}

// An option label as it is compared: backticks and every straight or typographic quote removed, whitespace collapsed, lowercased, one trailing period removed.
export function normalizeOption(label: string): string {
  const flat = label.replace(QUOTES_AND_TICKS, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return (flat.endsWith('.') ? flat.slice(0, -1) : flat).trim();
}

// A choice line as it is compared: its number and dot removed, then normalized as an option.
export function normalizeChoice(text: string): string {
  return normalizeOption(text.replace(NUMBER_PREFIX, ''));
}

const numberedOptions = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .filter((line) => NUMBERED_LINE.test(line))
    .map(normalizeChoice)
    .filter((option) => option !== '');

const unique = (options: readonly string[]): string[] => [...new Set(options)];

const decisionCriteria = (contract: ScopeContract, itemId: string): ScopeContract['intent']['acceptance'] => {
  const owned = new Set(contract.intent.workItems.find((i) => i.id === itemId)?.acceptance ?? []);
  return contract.intent.acceptance.filter((c) => owned.has(c.id) && c.verifiedBy.some((ref) => ref.startsWith(DECISION_REF)));
};

// The item's own choice has an owner: one of its own criteria names a `decision:` reference.
export function hasOwnerChoice(contract: ScopeContract, itemId: string): boolean {
  return decisionCriteria(contract, itemId).length > 0;
}

// The normalized options an item owns: the numbered lines of the paragraphs labelled for it, the numbered lines of its own criteria that name a
// `decision:` reference, and the labels of its open decisions (`openDecisionLabels`, as the ledger stores them).
export function itemChoiceOptions(contract: ScopeContract, itemId: string, openDecisionLabels: readonly string[]): string[] {
  const ids = contract.intent.workItems.map((i) => i.id);
  const fromParagraphs = paragraphsOf(contract.intent.behavior, ids)
    .filter((p) => p.label === itemId)
    .flatMap((p) => numberedOptions(p.text));
  const fromCriteria = decisionCriteria(contract, itemId).flatMap((c) => numberedOptions(c.text));
  const fromDecisions = openDecisionLabels.map(normalizeOption).filter((option) => option !== '');
  return unique([...fromParagraphs, ...fromCriteria, ...fromDecisions]);
}

// The normalized numbered lines of the paragraphs no item is labelled for. A Behavior that labels nothing is all shared.
export function sharedChoiceOptions(behavior: string, itemIds: readonly string[]): string[] {
  return unique(
    paragraphsOf(behavior, itemIds)
      .filter((p) => p.label === null)
      .flatMap((p) => numberedOptions(p.text)),
  );
}
