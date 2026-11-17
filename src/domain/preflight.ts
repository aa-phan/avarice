// Preflight classification (docs/repository-onboarding.md "Existing state and migration", ONB-6). Pure: the
// facts come from the staging port (names of uncommitted and untracked files, committed content only), the
// ledger's view is an argument, and the result is either findings for `preflight_json` or a refusal.
import { FULL_MAP_FILES } from './mapping.ts';
import { isStopState } from './onboarding-lifecycle.ts';
import type { OnboardingState } from './onboarding-lifecycle.ts';
import { err, ok } from './result.ts';
import type { Result } from './result.ts';

export interface MapFileFacts {
  // Repository-relative path, for example `.planning/codebase/STACK.md`.
  path: string;
  // `last_mapped_commit` from the frontmatter of the committed file; null when absent or not a commit SHA.
  lastMappedCommit: string | null;
  // Most recent commit at or before the pin that introduced that stamp value into the file.
  stampCommit: string | null;
  // Most recent commit at or before the pin that touched the file.
  lastCommit: string | null;
}

export interface RepoFacts {
  gitRoot: string;
  rootCommit: string;
  // Remote URL of `origin` with any credentials removed.
  remote?: string;
  pin: string;
  // Empty string when HEAD is detached.
  branch: string;
  defaultBranch: string | null;
  // Names of tracked files with uncommitted changes.
  modified: string[];
  // Names of untracked files (not ignored); a nested repository appears as `dir/`.
  untracked: string[];
  // Tracked files under `.planning/` at the pin.
  planningFiles: string[];
  // Tracked files directly under `.planning/codebase/` at the pin.
  codebaseMapFiles: MapFileFacts[];
  submodules: string[];
  nestedRepos: string[];
  workspaceManifests: string[];
  instructionFiles: string[];
  adrDirs: string[];
  runtimes: string[];
  trackedFiles: number;
  trackedBytes: number;
}

export type ExistingMapClass = 'none' | 'stamped-complete' | 'stamped-partial' | 'unstamped' | 'unknown-format' | 'user-edited';

// What happens to the map a repository already has (docs/repository-onboarding.md "Repositories already using GSD"). Every outcome
// other than `adopt` writes only in staging; the user's `.planning/` is never touched (docs "Migration steps").
export type ExistingMapOutcome = 'adopt' | 'refresh' | 'full-in-staging' | 'isolated-regeneration' | 'map';

// What GSD's `verify codebase-drift` said in staging about a stamped-complete map. `unreadable` covers a verdict GSD could not give: an
// unresolvable stamp, no stamp, no STRUCTURE.md, a failed run.
export type DriftVerdict = 'pass' | 'block' | 'unreadable';

// The outcome per class. The stamp alone never makes a map adoptable (T-04-26): a stamped-complete map is adopted on a drift `pass`, refreshed on a
// `block`, and mapped in full in staging on anything else, including a drift check that has not run (`null`).
export function existingMapOutcome(cls: ExistingMapClass, drift: DriftVerdict | null): ExistingMapOutcome {
  switch (cls) {
    case 'none':
      return 'map';
    case 'stamped-complete':
      return drift === 'pass' ? 'adopt' : drift === 'block' ? 'refresh' : 'full-in-staging';
    case 'stamped-partial':
    case 'unstamped':
      return 'full-in-staging';
    case 'unknown-format':
    case 'user-edited':
      return 'isolated-regeneration';
    default:
      throw new TypeError(`unknown existing-map class ${String(cls)}`);
  }
}

// Lists in `preflight_json` are bounded; a cut is recorded under `truncated`, never silent.
const MAX_LIST = 1000;

const KNOWN_MAP_FILES: ReadonlySet<string> = new Set(FULL_MAP_FILES);

const sortedUnique = (values: Iterable<string>): string[] => [...new Set(values)].sort();

function editedAfterStamp(file: MapFileFacts): boolean {
  // Without the commit that wrote the stamp there is no evidence of an edit, so none is claimed.
  return file.lastMappedCommit !== null && file.stampCommit !== null && file.lastCommit !== null && file.stampCommit !== file.lastCommit;
}

// Decision table, in order: no map; a file set that is not GSD's (leave it, regenerate in isolation); user
// edits (a commit touching a file after the commit that wrote its stamp, or uncommitted changes under
// `.planning/`); a file without a stamp; a complete stamped map (all seven files); any other stamped set.
export function classifyExistingMap(facts: Pick<RepoFacts, 'codebaseMapFiles' | 'modified' | 'untracked'>): ExistingMapClass {
  const dirty = [...facts.modified, ...facts.untracked];
  const files = facts.codebaseMapFiles;
  if (files.length === 0) return dirty.some((name) => name.startsWith('.planning/codebase/')) ? 'user-edited' : 'none';
  if (files.some((file) => !KNOWN_MAP_FILES.has(file.path))) return 'unknown-format';
  if (dirty.some((name) => name.startsWith('.planning/')) || files.some(editedAfterStamp)) return 'user-edited';
  if (files.some((file) => file.lastMappedCommit === null)) return 'unstamped';
  const present = new Set(files.map((file) => file.path));
  return FULL_MAP_FILES.every((path) => present.has(path)) ? 'stamped-complete' : 'stamped-partial';
}

// The paths of the user's checkout that stay as they are: for an edited map the files edited after their stamp commit and every changed
// file under `.planning/`; for a map of another format every file of it. Names only. Sorted.
export function userOwnedPaths(facts: Pick<RepoFacts, 'codebaseMapFiles' | 'modified' | 'untracked'>, cls: ExistingMapClass): string[] {
  if (cls === 'unknown-format') return sortedUnique(facts.codebaseMapFiles.map((file) => file.path));
  if (cls !== 'user-edited') return [];
  const dirty = [...facts.modified, ...facts.untracked].filter((name) => name.startsWith('.planning/'));
  return sortedUnique([...facts.codebaseMapFiles.filter(editedAfterStamp).map((file) => file.path), ...dirty]);
}

// The project's active record, as far as a refresh needs it: which version it is and the revision it describes (the commit SHA, no `git:` prefix).
export interface ActiveRecordView {
  recordVersion: number;
  onboardedRevision: string;
}

export interface LedgerView {
  // The project (same root commit and path) has an `active` record: the onboarding is a refresh of it (ONB-11), not a first onboarding. Null: it has none.
  activeRecord: ActiveRecordView | null;
  // Every onboarding of the project, oldest first.
  onboardings: ReadonlyArray<{ onboardingId: string; state: OnboardingState }>;
}

export interface PreflightRequest {
  promote?: string;
}

export interface PreflightClassification {
  // Keys of `preflight_json` other than `request`, `gitRoot`, `rootCommit`, `pin`, `branch` and `remote`.
  findings: Record<string, unknown>;
  // An onboarding of this project that is still in `discovered` (for example from `repo add`); the caller
  // continues it instead of creating a second one.
  continueOnboardingId: string | null;
}

export function classifyPreflight(facts: RepoFacts, view: LedgerView, request: PreflightRequest): Result<PreflightClassification> {
  // ONB-6: only promotion `none` exists until Phase 4.
  if (request.promote !== undefined && request.promote !== 'none') {
    return err({
      kind: 'invalid',
      field: 'request.promote',
      reason: `promotion ${JSON.stringify(request.promote)} is not authorized: the onboarding preset allows only "none"`,
    });
  }
  const live = view.onboardings.filter((onboarding) => !isStopState(onboarding.state));
  const running = live.find((onboarding) => onboarding.state !== 'discovered');
  if (running !== undefined) {
    return err({
      kind: 'conflict',
      expected: 'existing_state_conflict: no other onboarding of this repository in progress',
      actual: `onboarding ${running.onboardingId} is ${running.state}; continue it with: avarice resume ${running.onboardingId}`,
    });
  }

  const truncated: string[] = [];
  const bounded = (key: string, values: readonly string[]): string[] => {
    const sorted = sortedUnique(values);
    if (sorted.length <= MAX_LIST) return sorted;
    truncated.push(key);
    return sorted.slice(0, MAX_LIST);
  };

  const dirty = [...facts.modified, ...facts.untracked];
  const codebaseMap = classifyExistingMap(facts);
  const adrDirs = bounded('adrDirs', facts.adrDirs);
  const findings: Record<string, unknown> = {
    defaultBranch: facts.defaultBranch,
    // Names only (T-01-16): uncommitted and untracked files stay in the user's checkout, unmapped.
    notMapped: bounded('notMapped', dirty),
    untracked: bounded('untracked', facts.untracked),
    instructionFiles: bounded('instructionFiles', facts.instructionFiles),
    // Preflight reads the checkout only, so the drift of a stamped-complete map is not known yet (`drift: null`) and its outcome is the one
    // without a drift pass; the workspace stage runs GSD's drift check in staging and records the final outcome and the drift result in the
    // `mapping:plan` step and in the project record's `existingState`.
    existingState: {
      planningExists: facts.planningFiles.length > 0 || dirty.some((name) => name.startsWith('.planning/')),
      codebaseMap,
      outcome: existingMapOutcome(codebaseMap, null),
      drift: null,
      userOwned: bounded('userOwned', userOwnedPaths(facts, codebaseMap)),
    },
    // An active record makes this onboarding a refresh of it (ONB-11): the workspace stage plans how much of the map to rebuild from this revision.
    ...(view.activeRecord !== null ? { refreshOf: { recordVersion: view.activeRecord.recordVersion, onboardedRevision: view.activeRecord.onboardedRevision } } : {}),
    submodules: bounded('submodules', facts.submodules),
    nestedRepos: bounded('nestedRepos', facts.nestedRepos),
    workspaceManifests: bounded('workspaceManifests', facts.workspaceManifests),
    adrDirs,
    // The name the onboarding contract compiler reads for knowledge documents.
    adrDirectories: adrDirs,
    runtimes: bounded('runtimes', facts.runtimes),
    trackedFiles: facts.trackedFiles,
    trackedBytes: facts.trackedBytes,
  };
  if (truncated.length > 0) findings['truncated'] = truncated;

  return ok({ findings, continueOnboardingId: live[0]?.onboardingId ?? null });
}
