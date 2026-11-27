// The guard every context find and read passes through (plan 04-28; CON-10, CON-11, D-09; docs/containment.md "Retrieval and resource safeguards"). It holds the
// effective caps of one query (the profile's caps, narrowed by the run's contract) and the counters that are cumulative over a run: searches, whole-file reads and
// their bytes, and the one broad discovery a contract may authorize. For a run the counters are budget rows (`retrieval.*`) spent with the ledger's all-or-nothing
// `spendBudgets`, so processes that retrieve at once can never spend more than a row's limit, and a refusal leaves every row as it was. With no run (the attended
// `avarice context`) the counters are in memory and last one query, against the profile's caps.
//
// The agent's own Read calls in a run are not charged here: the PreToolUse hook (src/hook/pre-tool-use.ts) charges each one to `retrieval.fullReads` and
// `retrieval.fullReadBytes` in the transaction that charges its searches and `toolCalls` (WR-11). `beginRead` is for a caller in this process that reads whole files
// for a run; none exists yet, and it keeps its own tests.
//
// Nothing here refunds: a search that was started counts, whatever the source answered. A contract compiled before the retrieval budgets existed has no rows; a run on
// it is counted in memory against the profile's caps, which is all it was ever bound by.
import { BROAD_DISCOVERY_PER_RUN, RETRIEVAL_ROWS, effectiveCaps, parseRetrievalSection } from '../domain/retrieval-rules.ts';
import type { EffectiveCaps, RetrievalCaps } from '../domain/retrieval-rules.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { RunContract } from '../domain/run-contract.ts';
import type { Ledger } from '../ports/ledger.ts';
import { retrievalRowsOfRun } from './budget.ts';
import type { AppDeps } from './deps.ts';

export type GuardVerdict = { granted: true } | { granted: false; rule: string };

type Counter = keyof typeof RETRIEVAL_ROWS;

// The refusal a spent counter gives. `broadDiscovery` is spoken of as `broad-discovery`, the rest by their counter name.
const SPENT_RULE: Readonly<Record<Counter, string>> = {
  searches: 'retrieval:searches-spent',
  fullReads: 'retrieval:fullReads-spent',
  fullReadBytes: 'retrieval:fullReadBytes-spent',
  broadDiscovery: 'retrieval:broad-discovery-spent',
};

export const BROAD_NOT_AUTHORIZED = 'retrieval:broad-discovery-not-authorized';

// The profile's retrieval caps (the `retrieval` section of its config, lower-only), or why the section cannot be used.
export function profileRetrievalCaps(deps: Pick<AppDeps, 'profile'>): Result<RetrievalCaps> {
  return parseRetrievalSection(deps.profile.config.sections.retrieval);
}

interface Store {
  ledger: Ledger;
  runId: string;
}

export class RetrievalGuard {
  readonly caps: EffectiveCaps;
  readonly #store: Store | null;
  // The counters of a guard with no run behind it.
  readonly #memory = new Map<Counter, number>();

  constructor(caps: EffectiveCaps, store: Store | null = null) {
    this.caps = caps;
    this.#store = store;
  }

  // The guard of an attended query: the profile's caps, no contract, counters in memory. It authorizes no broad discovery.
  static attended(profileCaps: RetrievalCaps): RetrievalGuard {
    return new RetrievalGuard(effectiveCaps(profileCaps));
  }

  // The guard of a run: its contract's retrieval budgets narrow the profile's caps, and their rows are the counters. The rows are made here when the store has none
  // (a store that predates them), never reset when it has.
  static forRun(deps: Pick<AppDeps, 'ledger' | 'profile'>, runId: string): Result<RetrievalGuard> {
    const profile = profileRetrievalCaps(deps);
    if (!profile.ok) return profile;
    const stored = deps.ledger.getRunContract(runId);
    if (!stored.ok) return stored;
    if (stored.value === null) return err({ kind: 'not_found', ref: `contract of run ${runId}` });
    const contract = stored.value.body as RunContract;
    const budgets = contract.budgets?.retrieval;
    if (budgets === undefined) return ok(new RetrievalGuard(effectiveCaps(profile.value)));
    const rows = deps.ledger.createBudgets(runId, stored.value.version, retrievalRowsOfRun(contract));
    if (!rows.ok) return rows;
    return ok(new RetrievalGuard(effectiveCaps(profile.value, budgets), { ledger: deps.ledger, runId }));
  }

  // One search of a source, or of a page of it. A broad one (the whole repository, no term to scope it) needs the contract's authorization and is counted once per run,
  // besides being a search.
  beginSearch(kind: 'scoped' | 'broad'): Result<GuardVerdict> {
    if (kind === 'broad') {
      if (!this.caps.broadDiscovery) return ok({ granted: false, rule: BROAD_NOT_AUTHORIZED });
      return this.#spend([
        ['broadDiscovery', 1],
        ['searches', 1],
      ]);
    }
    return this.#spend([['searches', 1]]);
  }

  // A read of whole files: `files` of them, `bytes` in all, each with the reason the caller records. A single read above the effective cap is refused whatever is left.
  beginRead(files: number, bytes: number): Result<GuardVerdict> {
    if (!Number.isSafeInteger(files) || files < 1 || !Number.isSafeInteger(bytes) || bytes < 0) return err({ kind: 'invalid', field: 'read', reason: 'a read names a whole number of files above 0 and a whole number of bytes' });
    if (files > this.caps.fullReads) return ok({ granted: false, rule: SPENT_RULE.fullReads });
    if (bytes > this.caps.fullReadBytes) return ok({ granted: false, rule: SPENT_RULE.fullReadBytes });
    return this.#spend([
      ['fullReads', files],
      ['fullReadBytes', bytes],
    ]);
  }

  // Bounded snippets are capped per pack, not counted per run: how many of `wanted` may be read, and whether the rest were cut.
  beginSnippets(wanted: number): { count: number; truncated: boolean } {
    const count = Math.max(0, Math.min(wanted, this.caps.snippets));
    return { count, truncated: count < wanted };
  }

  #limitOf(counter: Counter): number {
    switch (counter) {
      case 'searches':
        return this.caps.searches ?? Number.POSITIVE_INFINITY;
      case 'fullReads':
        return this.caps.fullReads;
      case 'fullReadBytes':
        return this.caps.fullReadBytes;
      case 'broadDiscovery':
        return this.caps.broadDiscovery ? BROAD_DISCOVERY_PER_RUN : 0;
    }
  }

  #spend(spends: ReadonlyArray<readonly [Counter, number]>): Result<GuardVerdict> {
    if (this.#store === null) {
      for (const [counter, amount] of spends) {
        if ((this.#memory.get(counter) ?? 0) + amount > this.#limitOf(counter)) return ok({ granted: false, rule: SPENT_RULE[counter] });
      }
      for (const [counter, amount] of spends) this.#memory.set(counter, (this.#memory.get(counter) ?? 0) + amount);
      return ok({ granted: true });
    }
    const spent = this.#store.ledger.spendBudgets(
      this.#store.runId,
      spends.map(([counter, amount]) => ({ name: RETRIEVAL_ROWS[counter], amount })),
    );
    if (!spent.ok) return spent;
    if (spent.value.spent) return ok({ granted: true });
    const stopped = (Object.keys(RETRIEVAL_ROWS) as Counter[]).find((counter) => RETRIEVAL_ROWS[counter] === (spent.value as { budget: string }).budget);
    return ok({ granted: false, rule: stopped === undefined ? 'retrieval:spent' : SPENT_RULE[stopped] });
  }
}
