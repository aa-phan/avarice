// Map artifact validation (docs/repository-onboarding.md "Validation"). An artifact set is accepted only when
// every check holds, run in this order: presence, stamp, scope of writes, path references, secrets, size and
// structure, and the coverage label (ONB-7). Pure: the caller gathers the facts (documents, the staging diff,
// the pinned tracked paths) and this module judges them. Findings name paths, pattern kinds and line numbers,
// never document text.
import { FAST_MAP_FILES, completenessFor, requiredFilesFor } from './mapping.ts';
import type { Completeness, MappingPlan } from './mapping.ts';
import { matchesAny } from './glob.ts';
import { danglingShare, extractPathReferences } from './path-references.ts';
import { findSecrets } from './secret-patterns.ts';
import type { OnboardingContract } from './onboarding-contract.ts';

export const VALIDATION_LIMITS = { danglingShare: 0.05, maxBytes: 262144 } as const;
export type ValidationLimits = { danglingShare: number; maxBytes: number };

const MAP_DIR = '.planning/codebase/';

// H2 headings of the two document templates GSD 1.17.0 ships under gsd-core/templates/codebase/ (stack.md and
// architecture.md; the other five map documents have no template). Compared case-insensitively.
export const TEMPLATE_HEADINGS: Readonly<Record<string, readonly string[]>> = {
  [`${MAP_DIR}STACK.md`]: ['Languages', 'Runtime', 'Frameworks', 'Key Dependencies', 'Configuration', 'Platform Requirements'],
  [`${MAP_DIR}ARCHITECTURE.md`]: [
    'Pattern Overview',
    'Layers',
    'Data Flow',
    'Key Abstractions',
    'Entry Points',
    'Error Handling',
    'Cross-Cutting Concerns',
  ],
};

// Written by AVARICE's own executor (and the knowledge pass's working directory), never promoted:
// docs/repository-onboarding.md "Onboarding contract" files.write and the Validation scope row.
export const AVARICE_WRITE_SET: readonly string[] = ['.planning/config.json', '.planning/graphs/**', '.avarice-knowledge/**', 'graphify-out/**'];

const CONFIG_JSON = '.planning/config.json';

// Where AVARICE's own index steps regenerate a file a repository may already track (a committed GSD graph). The
// map validation never allows a tracked change here, because no invocation writes it; the check before activation
// does, because the index steps run in between and write exactly these files.
export const AVARICE_TRACKED_WRITABLE: readonly string[] = ['.planning/graphs/**'];

// Staging entries that exist while a map is validated yet are never tracked at the pin: the clone's own git
// metadata and the empty scaffold directory the host creates in its working directory (live-harness S0 finding).
// Together with AVARICE_WRITE_SET and AVARICE_TRACKED_WRITABLE they are known to the path-reference check.
export const STAGING_SCAFFOLD: readonly string[] = ['.git/**', '.claude/.cc-writes/**'];

export interface WriteSets {
  // Globs the staging diff may touch.
  allowedWrite: string[];
  // Globs under which an already-tracked file may be modified or deleted, besides `.planning/config.json`.
  trackedWritable: string[];
}

// The agent write sets of the invocation purposes that ran, plus the AVARICE write set. A tracked file may be
// rewritten only where an invocation was allowed to write (a Refresh regenerates a committed map in staging)
// and in `.planning/config.json`; the AVARICE-only directories are never a place to change a tracked file.
export function writeSetsFor(files: OnboardingContract['files'], purposesRun: readonly string[]): WriteSets {
  const agent: string[] = [];
  for (const purpose of new Set(purposesRun)) {
    if (purpose !== 'map' && purpose !== 'intel' && purpose !== 'knowledge') continue;
    agent.push(...files.write[purpose], ...files.create[purpose]);
  }
  const agentSets = [...new Set(agent)];
  return {
    allowedWrite: [...new Set([...agentSets, ...files.avariceWrite, ...AVARICE_WRITE_SET])],
    trackedWritable: [...new Set([CONFIG_JSON, ...agentSets])],
  };
}

// The paths of a staging diff that lie outside the write sets, sorted. A modified or deleted path must be inside the
// write set and in a place where a tracked file may change; an added path must be inside the write set, and must not
// be a tracked path outside the places where a tracked file may change (a deleted-and-recreated file). Shared by the
// validation stage and the check before activation, so both judge the diff the same way.
export function scopeViolationsOf(
  changes: { modified: readonly string[]; added: readonly string[]; deleted: readonly string[] },
  knownPaths: readonly string[],
  allowedWrite: readonly string[],
  trackedWritable: readonly string[],
): string[] {
  const known = new Set(knownPaths);
  const violations = new Set<string>();
  for (const path of [...changes.modified, ...changes.deleted]) {
    if (!(matchesAny(path, trackedWritable) && matchesAny(path, allowedWrite))) violations.add(path);
  }
  for (const path of changes.added) {
    if (!matchesAny(path, allowedWrite)) violations.add(path);
    else if (known.has(path) && !matchesAny(path, trackedWritable)) violations.add(path);
  }
  return [...violations].sort();
}

export interface MapFileFact {
  path: string;
  // null when the frontmatter has no stamp.
  lastMappedCommit: string | null;
  text: string;
  bytes: number;
  // The file was above the read limit; its text is empty.
  oversize?: boolean;
}

export interface MapArtifactFacts {
  stagingHead: string;
  // One entry per map file found in staging.
  files: ReadonlyArray<MapFileFact>;
  // The staging diff against the pin, as names.
  changes: { modified: readonly string[]; added: readonly string[]; deleted: readonly string[] };
  allowedWrite: readonly string[];
  trackedWritable: readonly string[];
  // Tracked paths at the pin; the documents' own paths count as known too.
  knownPaths: readonly string[];
  // The references the repository's own committed .gitignore rules ignore at the pin (declared build output, local config); they
  // count as known, not dangling.
  ignoredReferences?: readonly string[];
}

export interface ValidationCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface MapValidation {
  accepted: boolean;
  // A secret hit: blocks the onboarding with a decision, no retry (T-01-21).
  block: boolean;
  checks: ValidationCheck[];
  completeness: Completeness;
  scope: string[];
  // Staging paths outside the allowed write sets; secret hits as path, pattern kind and line.
  scopeViolations: string[];
  secretHits: Array<{ path: string; pattern: string; line: number }>;
}

const bare = (commit: string): string => (commit.startsWith('git:') ? commit.slice(4) : commit);

const listed = (items: readonly string[], max = 5): string =>
  items.length <= max ? items.join(', ') : `${items.slice(0, max).join(', ')} (+${items.length - max} more)`;

const percent = (share: number): string => `${Math.round(share * 1000) / 10}%`;

function stripFrontmatter(text: string): string {
  const normalized = text.replaceAll('\r\n', '\n');
  if (!normalized.startsWith('---\n')) return normalized;
  const end = normalized.indexOf('\n---', 4);
  return end === -1 ? normalized : normalized.slice(normalized.indexOf('\n', end + 1) + 1);
}

// H2 headings outside fenced code blocks, lower-cased.
function h2Headings(body: string): Set<string> {
  const found = new Set<string>();
  let fenced = false;
  for (const line of body.split('\n')) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^##[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    if (match) found.add((match[1] as string).trim().toLowerCase());
  }
  return found;
}

function coverageFor(plan: MappingPlan, present: readonly string[]): { completeness: Completeness; scope: string[] } {
  const completeness = completenessFor(plan.mode, present);
  switch (plan.mode) {
    case 'full':
      return { completeness, scope: ['.'] };
    case 'fast':
      return { completeness, scope: [...FAST_MAP_FILES] };
    case 'adopt':
      return { completeness, scope: [...present] };
    case 'paths':
      return { completeness, scope: [...(plan.paths ?? [])] };
    case 'skip':
      return { completeness, scope: [] };
    default:
      throw new TypeError(`unknown mapping mode ${String(plan.mode)}`);
  }
}

export function validateMapArtifacts(facts: MapArtifactFacts, plan: MappingPlan, limits: ValidationLimits = VALIDATION_LIMITS): MapValidation {
  const required = requiredFilesFor(plan.mode);

  // 1. Presence.
  const stampsByPath = new Map<string, Array<string | null>>();
  for (const f of facts.files) {
    const list = stampsByPath.get(f.path);
    if (list) list.push(f.lastMappedCommit);
    else stampsByPath.set(f.path, [f.lastMappedCommit]);
  }
  const missing = required.filter((p) => !stampsByPath.has(p));
  const presence: ValidationCheck = {
    name: 'presence',
    passed: missing.length === 0,
    detail: missing.length === 0 ? `${required.length} required file(s) present` : `missing: ${missing.join(', ')}`,
  };

  // 2. Stamp.
  const head = bare(facts.stagingHead);
  const badStamps: string[] = [];
  for (const path of required) {
    const stamps = stampsByPath.get(path);
    if (!stamps) continue;
    for (const stamp of stamps) {
      const value = stamp === null ? '' : bare(stamp);
      if (head === '' || value === '' || value !== head) {
        badStamps.push(`${path} (${stamp === null || value === '' ? 'no stamp' : `stamped ${value}`})`);
      }
    }
  }
  const stamp: ValidationCheck = {
    name: 'stamp',
    passed: badStamps.length === 0,
    detail:
      badStamps.length === 0
        ? `last_mapped_commit equals the staging HEAD in ${required.length} file(s)`
        : `${head === '' ? 'staging HEAD is empty; ' : ''}not equal to staging HEAD ${head}: ${badStamps.join(', ')}`,
  };

  // 3. Scope of writes: the staging diff touches only the write sets; a tracked file changes only where allowed.
  const scopeViolations = scopeViolationsOf(facts.changes, facts.knownPaths, facts.allowedWrite, facts.trackedWritable);
  const scopeOfWrites: ValidationCheck = {
    name: 'scope-of-writes',
    passed: scopeViolations.length === 0,
    detail:
      scopeViolations.length === 0
        ? 'the staging diff is inside the write sets'
        : `${scopeViolations.length} path(s) outside the write sets: ${listed(scopeViolations)}`,
  };

  // 4. Path references, over the documents that could be read.
  const refs: string[] = [];
  for (const f of facts.files) refs.push(...extractPathReferences(f.text));
  // AVARICE's own staging files (the config and the index output are untracked at the pin) are known references.
  const ownGlobs = [...AVARICE_WRITE_SET, ...AVARICE_TRACKED_WRITABLE, ...STAGING_SCAFFOLD];
  const resolved = danglingShare(refs, [...facts.knownPaths, ...facts.files.map((f) => f.path), CONFIG_JSON], ownGlobs);
  const withinLimit = resolved.share <= limits.danglingShare;
  const counts = `${resolved.dangling.length} of ${resolved.total} named path(s) dangling (${percent(resolved.share)}, limit ${percent(limits.danglingShare)})`;
  const pathReferences: ValidationCheck = {
    name: 'path-references',
    passed: withinLimit,
    detail: withinLimit ? counts : `${counts}: ${listed(resolved.dangling)}`,
  };

  // 5. Secrets: GSD's scan plus AVARICE's redactor patterns. Names and lines only.
  const secretHits: MapValidation['secretHits'] = [];
  for (const f of facts.files) {
    for (const hit of findSecrets(f.text)) secretHits.push({ path: f.path, pattern: hit.pattern, line: hit.line });
  }
  const secrets: ValidationCheck = {
    name: 'secrets',
    passed: secretHits.length === 0,
    detail:
      secretHits.length === 0
        ? 'no secret pattern found'
        : `${secretHits.length} secret pattern hit(s): ${listed(secretHits.map((h) => `${h.path}:${h.line} ${h.pattern}`))}`,
  };

  // 6. Size and structure.
  const problems: string[] = [];
  for (const f of facts.files) {
    if (f.oversize === true || f.bytes > limits.maxBytes) {
      problems.push(`${f.path}: above the ${limits.maxBytes} byte cap`);
      continue;
    }
    if (f.bytes === 0 || f.text.trim() === '') {
      problems.push(`${f.path}: empty`);
      continue;
    }
    const body = stripFrontmatter(f.text);
    if (!/^#{1,2}[ \t]+\S/m.test(body)) {
      problems.push(`${f.path}: no Markdown heading (H1 or H2)`);
      continue;
    }
    const wanted = TEMPLATE_HEADINGS[f.path];
    if (wanted !== undefined) {
      const present = h2Headings(body);
      const absent = wanted.filter((h) => !present.has(h.toLowerCase()));
      if (absent.length > 0) problems.push(`${f.path}: missing template heading(s) ${absent.map((h) => `"${h}"`).join(', ')}`);
    }
  }
  const sizeAndStructure: ValidationCheck = {
    name: 'size-and-structure',
    passed: problems.length === 0,
    detail: problems.length === 0 ? `${facts.files.length} document(s) non-empty, under ${limits.maxBytes} bytes, with their headings` : problems.join('; '),
  };

  // 7. Coverage label: derived from the mode, never from what the documents claim.
  const coverage = coverageFor(plan, facts.files.map((f) => f.path));
  const coverageCheck: ValidationCheck = {
    name: 'coverage',
    passed: true,
    detail: `mode ${plan.mode}: completeness ${coverage.completeness}, scope ${coverage.scope.length === 0 ? 'none' : listed(coverage.scope, 4)}`,
  };

  const checks = [presence, stamp, scopeOfWrites, pathReferences, secrets, sizeAndStructure, coverageCheck];
  return {
    accepted: checks.every((c) => c.passed),
    block: !secrets.passed,
    checks,
    completeness: coverage.completeness,
    scope: coverage.scope,
    scopeViolations,
    secretHits,
  };
}
