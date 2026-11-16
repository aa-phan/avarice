// Index facts for spec derivation at start (plan 03-17; D-07 stage 1, RC-7, S-50). Before the start transaction the start command asks the
// onboarded indexes (graph and intel, through the same reader `context` uses) about the files and identifiers each item names, and hands
// what they answer to the compiler as IndexFacts. This module only reads: it writes nothing to the ledger or to any file, so a start killed
// after derivation and before its transaction leaves nothing behind, and a start killed after the transaction leaves a whole run
// (createRunWithContract is one transaction).
//
// An index that is absent, stale or unreadable gives no facts and says so in the note; it never blocks a start (a Phase 1 rule), and the
// compiler then derives from the brief and the write set. Index text is data: only repository paths and identifiers are taken from it, and
// the compiler keeps a derived file only when it is inside the run's write set, so an index can narrow an item's files but never widen them
// (T-03-32).
import { resolve } from 'node:path';
import { parseBrief } from '../domain/brief.ts';
import { itemCandidateTerms } from '../domain/run-contract.ts';
import type { IndexFacts } from '../domain/run-contract.ts';
import { queryContext } from './context.ts';
import type { PackItem } from './context.ts';
import type { AppDeps } from './deps.ts';
import { findProject, readBriefFile } from './run-start.ts';
import type { RunStartRequest } from './run-start.ts';

// At most this many terms are asked (each is one query of each index) and each answer may use this many tokens.
export const MAX_DERIVE_TERMS = 24;
const TERM_BUDGET = 400;

export interface IndexFactsResult {
  facts?: IndexFacts;
  // One line for the start summary: whether the indexes were used, and why not when they were not.
  note: string;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const MISSING_NOTE = /is not in the project record|source is configured|no context sources/;
const TROUBLE_NOTE = /cannot answer|cannot be read/;

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

// The repository file and symbol an index answer cites, or nothing. A graph code node cites the file it was extracted from and is named by
// its label (graphify writes `name()` for functions); an intel file-roles entry is a file; an intel API entry names its file in the entry.
function cited(item: PackItem): { file: string; symbol?: string } | undefined {
  if (item.untrusted === true) return undefined;
  if (item.source === 'gsd-graph') {
    if (item.ref.scope.startsWith('.planning/')) return undefined;
    const label = item.title.replace(/\(\)$/, '');
    return { file: item.ref.scope, ...(IDENTIFIER.test(label) ? { symbol: label } : {}) };
  }
  if (item.ref.scope.endsWith('/file-roles.json')) return { file: item.title };
  if (item.ref.scope.endsWith('/api-map.json')) {
    try {
      const entry: unknown = JSON.parse(item.excerpt);
      const file = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>)['file'] : undefined;
      if (typeof file === 'string') return { file, ...(IDENTIFIER.test(item.title) ? { symbol: item.title } : {}) };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// An answer is used when its index is fresh, or stale but the cited path is still at the repository's HEAD.
const usable = (item: PackItem): boolean => item.freshness === 'fresh' || (item.freshness === 'stale' && item.confirmed === true);

// Asks the indexes about each term and returns the files and the symbols of those files they know. Never throws.
export async function collectIndexFacts(deps: AppDeps, projectId: string, terms: readonly string[]): Promise<IndexFactsResult> {
  if (terms.length === 0) return { note: 'index: not queried (no item names a file or a symbol)' };
  const files = new Set<string>();
  const symbolsByFile = new Map<string, Set<string>>();
  let absent = false;
  let stale = 0;
  let trouble = 0;
  for (const term of terms.slice(0, MAX_DERIVE_TERMS)) {
    let report: Awaited<ReturnType<typeof queryContext>>;
    try {
      report = await queryContext(deps, { projectId, term, budget: TERM_BUDGET });
    } catch {
      trouble += 1;
      continue;
    }
    if (!report.ok) {
      if (report.error.kind === 'not_found' || report.error.kind === 'unavailable') {
        absent = true;
        break;
      }
      trouble += 1;
      continue;
    }
    // Neither index is recorded for this project: every other term would be told the same.
    if (report.value.notes.filter((n) => MISSING_NOTE.test(n)).length >= 2) {
      absent = true;
      break;
    }
    trouble += report.value.notes.filter((n) => TROUBLE_NOTE.test(n)).length;
    for (const item of report.value.items) {
      const found = cited(item);
      if (found === undefined) continue;
      if (!usable(item)) {
        stale += 1;
        continue;
      }
      files.add(found.file);
      if (found.symbol !== undefined) {
        const symbols = symbolsByFile.get(found.file) ?? new Set<string>();
        symbols.add(found.symbol);
        symbolsByFile.set(found.file, symbols);
      }
    }
  }
  if (files.size > 0) {
    const sorted = [...files].sort();
    const byFile: Record<string, string[]> = {};
    let symbolCount = 0;
    for (const file of sorted) {
      const symbols = [...(symbolsByFile.get(file) ?? [])].sort();
      if (symbols.length > 0) byFile[file] = symbols;
      symbolCount += symbols.length;
    }
    return { facts: { files: sorted, symbolsByFile: byFile }, note: `index: used (${plural(sorted.length, 'file')}, ${plural(symbolCount, 'symbol')})` };
  }
  if (absent) return { note: 'index: not used (absent)' };
  if (stale > 0) return { note: 'index: not used (stale)' };
  if (trouble > 0) return { note: 'index: not used (unreadable)' };
  return { note: 'index: used, but nothing in it names these files or symbols' };
}

// The project and the terms of the brief a start request names, read the way startRun reads them, or nothing when the brief cannot be read
// or no project matches (startRun then refuses with the real reason, and no index is asked). Pure reading: nothing is created.
export function startTerms(deps: AppDeps, request: RunStartRequest): { projectId: string; terms: string[] } | undefined {
  const read = readBriefFile(resolve(request.cwd, request.briefPath));
  if (!read.ok) return undefined;
  const brief = parseBrief(read.text, { kind: 'file', id: request.briefPath.split(/[\\/]/).pop() ?? 'brief' });
  if (!brief.ok) return undefined;
  const found = findProject(deps, request);
  if (!('project' in found)) return undefined;
  const terms = [...new Set([...itemCandidateTerms(brief.value).values()].flat())];
  return { projectId: found.project.projectId, terms };
}
