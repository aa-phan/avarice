// Refresh facts (ONB-11): what the refresh planner (domain/refresh-plan.ts) needs, read in staging. GSD's own drift verdict, the paths that changed
// between the revision the existing map describes and the new HEAD, and the top-level directories the new HEAD added. Every git read goes through the
// staging port, so the paths are git output (names only) and reach the planner and then `--paths` only after the scope check (T-04-36).
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { newTopLevelDirsOf, touchesManifest } from '../domain/refresh-plan.ts';
import type { RefreshDrift, RefreshFacts } from '../domain/refresh-plan.ts';
import type { GsdOnboarding } from '../ports/gsd-onboarding.ts';
import type { AppDeps } from './deps.ts';

// What GSD's own `verify codebase-drift` said in staging, reduced to the verdict the planner reads. Only a clean answer is a `pass`: a verdict GSD
// skipped (no STRUCTURE.md, no stamp, not a repository), could not give (an unresolvable stamp, exit 69) or that failed to run is `unreadable`, so a
// stamp alone, forged or stale, never makes a map adoptable (T-04-26).
export interface DriftFinding {
  verdict: RefreshDrift;
  affectedPaths: string[];
  threshold: number | null;
  reason: string | null;
  // `last_mapped_commit` GSD read from the map; null when it found none.
  lastMappedCommit: string | null;
}

const MAX_RECORDED_PATHS = 50;

export async function driftOf(gsd: GsdOnboarding, staging: string): Promise<DriftFinding> {
  const drift = await gsd.checkDrift(staging);
  if (!drift.ok) return { verdict: 'unreadable', affectedPaths: [], threshold: null, reason: drift.error.kind, lastMappedCommit: null };
  const d = drift.value;
  const verdict: RefreshDrift = d.block ? 'block' : d.skipped ? 'unreadable' : 'pass';
  return { verdict, affectedPaths: d.affectedPaths.slice(0, MAX_RECORDED_PATHS), threshold: d.threshold, reason: d.reason, lastMappedCommit: d.lastMappedCommit };
}

// The active record an onboarding refreshes, as preflight stored it (`refreshOf`); null for a first onboarding.
export interface RefreshOf {
  recordVersion: number;
  onboardedRevision: string;
}

export function refreshOfPreflight(preflight: unknown): RefreshOf | null {
  const body = typeof preflight === 'object' && preflight !== null ? (preflight as Record<string, unknown>)['refreshOf'] : undefined;
  if (typeof body !== 'object' || body === null) return null;
  const { recordVersion, onboardedRevision } = body as Record<string, unknown>;
  return typeof recordVersion === 'number' && Number.isInteger(recordVersion) && typeof onboardedRevision === 'string' ? { recordVersion, onboardedRevision } : null;
}

export interface RefreshInput {
  // The revision the existing map describes: the active record's revision, or the stamp of a map the repository already has.
  fromRevision: string;
  // The new HEAD: the onboarding's pin.
  toRevision: string;
  // GSD's drift in staging; null where no drift question was asked (a map that is not a complete stamped one).
  drift: DriftFinding | null;
}

// Changes under `.planning/` are the map itself, not the code it describes.
const isPlanningPath = (path: string): boolean => path === '.planning' || path.startsWith('.planning/');

// The facts for `planRefresh`. A revision git cannot resolve, or a diff past the port's bound, is an error: the stage then plans a full map.
export function refreshFacts(deps: AppDeps, stagingPath: string, input: RefreshInput): Result<RefreshFacts> {
  const changed = deps.staging.changedBetween(stagingPath, input.fromRevision, input.toRevision);
  if (!changed.ok) return changed;
  const earlier = deps.staging.describe(stagingPath, input.fromRevision);
  if (!earlier.ok) return earlier;
  const changedPaths = changed.value.filter((path) => !isPlanningPath(path));
  if (changedPaths.some((path) => path.length === 0 || path.startsWith('/'))) return err({ kind: 'internal', cause: 'git reported a changed path that is not repository-relative' });
  return ok({
    stamp: input.drift?.lastMappedCommit ?? null,
    drift: input.drift?.verdict ?? 'unreadable',
    affectedPaths: input.drift?.affectedPaths ?? [],
    changedPaths,
    newTopLevelDirs: newTopLevelDirsOf(changedPaths, earlier.value.topLevelEntries),
    manifestChanged: touchesManifest(changedPaths),
  });
}
