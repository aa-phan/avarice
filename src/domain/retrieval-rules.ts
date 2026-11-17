import { err, ok } from './result.ts';
import type { Result } from './result.ts';

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

// ---------------------------------------------------------------------------------------------------------------
// Retrieval caps (plan 04-28; CON-10, CON-11, D-09; docs/containment.md "Retrieval and resource safeguards"). Context retrieval is progressive and every step has its
// own cap. These are the defaults: the profile config's `retrieval` section may lower any of them, and a run contract may lower the three that are counted per run
// (`searches`, `fullReads`, `fullReadBytes`). Nothing raises one.
// ---------------------------------------------------------------------------------------------------------------

export interface RetrievalCaps {
  // Index and metadata: the most entries one source's `find` may return, and the most bytes of text one source's answer may carry.
  indexEntries: number;
  returnedBytes: number;
  // Scoped search: the most hits, and how long one query may run before it is aborted.
  searchHits: number;
  queryTimeoutMs: number;
  // Bounded snippets: lines in one, and snippets in one pack.
  snippetLines: number;
  snippets: number;
  // Full file reads, counted per run: files and bytes in total.
  fullReads: number;
  fullReadBytes: number;
  // A paged source is never paged past this many pages (remote adapters, Phase 7).
  maxPages: number;
}

export const RETRIEVAL_CAPS: Readonly<RetrievalCaps> = Object.freeze({
  indexEntries: 2000,
  returnedBytes: 64 * 1024,
  searchHits: 200,
  queryTimeoutMs: 10_000,
  snippetLines: 40,
  snippets: 30,
  fullReads: 20,
  fullReadBytes: 256 * 1024,
  maxPages: 5,
});

// Broad discovery (the whole repository, the whole corpus) happens once per run, and only when the contract says so.
export const BROAD_DISCOVERY_PER_RUN = 1;

// The budget rows the retrieval counters live in (the ledger's `budgets` table), one per counted cap.
export const RETRIEVAL_ROWS = Object.freeze({
  searches: 'retrieval.searches',
  fullReads: 'retrieval.fullReads',
  fullReadBytes: 'retrieval.fullReadBytes',
  broadDiscovery: 'retrieval.broadDiscovery',
} as const);

export const RETRIEVAL_CAP_KEYS: readonly (keyof RetrievalCaps)[] = Object.freeze(Object.keys(RETRIEVAL_CAPS) as Array<keyof RetrievalCaps>);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
// A key from a hand-edited file goes into a field path that a terminal prints: drop control characters and cap it.
// eslint-disable-next-line no-control-regex
const shownKey = (key: string): string => key.replace(/[\u0000-\u001f\u007f-\u009f]/g, '?').slice(0, 40);

// The profile config's `retrieval` section: an object of cap names to positive whole numbers, each at most the default. An absent section is the defaults. An
// unknown name, a value that is not a positive whole number and a value above the default are refused, naming `retrieval.<key>`.
export function parseRetrievalSection(raw: unknown): Result<RetrievalCaps> {
  const caps: RetrievalCaps = { ...RETRIEVAL_CAPS };
  if (raw === undefined) return ok(caps);
  if (!isRecord(raw)) return err({ kind: 'invalid', field: 'retrieval', reason: `expected an object of cap names (${RETRIEVAL_CAP_KEYS.join(', ')}) to numbers` });
  for (const [key, value] of Object.entries(raw)) {
    const field = `retrieval.${shownKey(key)}`;
    const name = RETRIEVAL_CAP_KEYS.find((candidate) => candidate === key);
    if (name === undefined) return err({ kind: 'invalid', field, reason: `unknown cap; expected ${RETRIEVAL_CAP_KEYS.join(', ')}` });
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return err({ kind: 'invalid', field, reason: 'expected a whole number above 0' });
    if (value > RETRIEVAL_CAPS[name]) return err({ kind: 'invalid', field, reason: `caps can only be lowered: ${value} is above the default ${RETRIEVAL_CAPS[name]}` });
    caps[name] = value;
  }
  return ok(caps);
}

// What a run contract holds of the retrieval caps (`budgets.retrieval`); absent on a contract compiled before plan 04-28. `broadDiscovery` is the owner's authorization
// of one whole-repository discovery per run (docs/containment.md: contract flag `broadDiscovery: true`).
export interface ContractRetrieval {
  searches: number;
  fullReads: number;
  fullReadBytes: number;
  broadDiscovery: boolean;
}

// What one query may do: the profile's caps, narrowed by the run's contract where it has one. The counted caps are the smaller of the two; `searches` is the contract's
// own (a profile has no per-run search count, so null means uncounted); broad discovery is allowed only when the contract says so.
export interface EffectiveCaps extends RetrievalCaps {
  searches: number | null;
  broadDiscovery: boolean;
}

export function effectiveCaps(profileCaps: RetrievalCaps, contractBudgets?: Partial<ContractRetrieval>): EffectiveCaps {
  const lowest = (a: number, b: number | undefined): number => (b === undefined ? a : Math.min(a, b));
  return {
    ...profileCaps,
    fullReads: lowest(profileCaps.fullReads, contractBudgets?.fullReads),
    fullReadBytes: lowest(profileCaps.fullReadBytes, contractBudgets?.fullReadBytes),
    searches: contractBudgets?.searches ?? null,
    broadDiscovery: contractBudgets?.broadDiscovery === true,
  };
}
