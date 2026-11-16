// How much of a graph neighbour a read pulls in, chosen by the relation of the edge that leads to it (FR-22). The table
// is the one measured on three real graphs (a TypeScript graph with a knowledge pass, a Python graph and a Go graph);
// a relation it does not list, including one a later graphify adds, is `id-only`, so an unknown edge never pulls a
// neighbour's content into a pack. The ContextSource port takes its `readRule` type from here.
export type ReadRule = 'descendants' | 'one-hop' | 'id-only';

// - descendants: the target is a part of the source (parent and child); a read follows it down, to a bounded depth.
// - one-hop: the source needs the target to work (a dependency); a read adds the target's label and source file.
// - id-only: a reference, a citation, an explanation, or a concept a model inferred; a read adds the target's ID.
export const EDGE_READ_RULES: Readonly<Record<string, ReadRule>> = Object.freeze({
  contains: 'descendants',
  method: 'descendants',
  calls: 'one-hop',
  indirect_call: 'one-hop',
  imports: 'one-hop',
  imports_from: 'one-hop',
  extends: 'one-hop',
  inherits: 'one-hop',
  implements: 'one-hop',
  re_exports: 'one-hop',
  dynamic_import: 'one-hop',
  references: 'id-only',
  uses: 'id-only',
  cites: 'id-only',
  rationale_for: 'id-only',
  conceptually_related_to: 'id-only',
});

// Own properties only: a relation named `constructor` or `__proto__` in an untrusted graph is unmapped, not inherited.
export function ruleFor(relation: string | null): ReadRule {
  if (relation === null || !Object.hasOwn(EDGE_READ_RULES, relation)) return 'id-only';
  return EDGE_READ_RULES[relation] ?? 'id-only';
}

const WIDTH: Readonly<Record<ReadRule, number>> = { 'id-only': 0, 'one-hop': 1, descendants: 2 };

// The rule that pulls in the most; no rule at all is `id-only`.
export function widestRule(rules: readonly ReadRule[]): ReadRule {
  let widest: ReadRule = 'id-only';
  for (const rule of rules) if (WIDTH[rule] > WIDTH[widest]) widest = rule;
  return widest;
}
