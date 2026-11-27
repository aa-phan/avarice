// The context sources a profile selects (plan 04-26; FR-3, FR-18). The profile config's `adapters.context` is a list of source names from a closed set; an
// absent key means all four local adapters. Composition builds exactly the listed sources and records each one's descriptor, so a pack's items always name a
// source the profile asked for. This module only parses the list and holds the default read scope a search may look in; it builds nothing.
import { err, ok } from './result.ts';
import type { Result } from './result.ts';
import { ROUTINE_PRESET } from './run-contract.ts';

export const CONTEXT_ADAPTER_NAMES = ['gsd-intel', 'gsd-graph', 'gsd-planning', 'git-files'] as const;
export type ContextAdapterName = (typeof CONTEXT_ADAPTER_NAMES)[number];

export const DEFAULT_CONTEXT_ADAPTERS: readonly ContextAdapterName[] = CONTEXT_ADAPTER_NAMES;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const shown = (value: unknown): string => (typeof value === 'string' ? JSON.stringify(value.slice(0, 40)) : typeof value);

// The `adapters` section of the profile config as far as this module reads it: its `context` list. Other keys of the section belong to other readers and are
// left alone. An unknown name, a name twice and a value that is not a list of strings are refused, naming `adapters.context`. An empty list selects no source.
export function parseContextAdapters(section: unknown): Result<ContextAdapterName[]> {
  if (section === undefined) return ok([...DEFAULT_CONTEXT_ADAPTERS]);
  if (!isRecord(section)) return err({ kind: 'invalid', field: 'adapters', reason: 'expected an object' });
  const raw = section['context'];
  if (raw === undefined) return ok([...DEFAULT_CONTEXT_ADAPTERS]);
  if (!Array.isArray(raw)) return err({ kind: 'invalid', field: 'adapters.context', reason: `expected a list of source names (${CONTEXT_ADAPTER_NAMES.join(', ')})` });
  // An empty list selects no source: the profile asks for no AVARICE pack at all (plan 04-31; the baseline arm of the AC-8 evaluation, D-06). Leaving the key out selects all four.
  if (raw.length === 0) return ok([]);
  const names: ContextAdapterName[] = [];
  for (const entry of raw) {
    const name = CONTEXT_ADAPTER_NAMES.find((candidate) => candidate === entry);
    if (name === undefined) return err({ kind: 'invalid', field: 'adapters.context', reason: `unknown source ${shown(entry)}; expected ${CONTEXT_ADAPTER_NAMES.join(', ')}` });
    if (names.includes(name)) return err({ kind: 'invalid', field: 'adapters.context', reason: `source ${name} is listed twice` });
    names.push(name);
  }
  return ok(names);
}

// Whether onboarding runs the knowledge pass (plan 04-31; D-08): the profile config's `adapters.knowledgePass`, a boolean. An absent key, and an absent section, mean true. Any
// other value is refused naming `adapters.knowledgePass`. False records the knowledge step as disabled and starts no knowledge invocation.
export function parseKnowledgePass(section: unknown): Result<boolean> {
  if (section === undefined) return ok(true);
  if (!isRecord(section)) return err({ kind: 'invalid', field: 'adapters', reason: 'expected an object' });
  const raw = section['knowledgePass'];
  if (raw === undefined) return ok(true);
  if (typeof raw !== 'boolean') return err({ kind: 'invalid', field: 'adapters.knowledgePass', reason: 'expected true or false' });
  return ok(raw);
}

// The paths a search may return a hit from: `read` globs, minus `readExclude` (directories or globs) and `secretGlobs`, the same three lists a run contract's
// `files` holds. A contract's own lists replace the default.
export interface ContextReadScope {
  read: readonly string[];
  readExclude: readonly string[];
  secretGlobs: readonly string[];
}

export function defaultContextReadScope(): ContextReadScope {
  return { read: ['**'], readExclude: [...ROUTINE_PRESET.readExclude], secretGlobs: [...ROUTINE_PRESET.secretGlobs] };
}
