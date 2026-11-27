// Refresh planning (docs/repository-onboarding.md "Mapping-mode decision table", ONB-11). Pure: given what GSD's drift check said about the existing map and
// what changed in the repository since, choose how much of the map to rebuild.
//
//   incremental  nothing structural changed (GSD reports no drift): no mapper runs and the indexes are brought up to date from the changed paths;
//   paths        GSD reports drift confined to named paths: the mapper reads those paths only;
//   full         a manifest or workspace-structure change, a drift GSD could not judge, no stamp to measure from, or at least FULL_REMAP_DRIFT_THRESHOLD
//                new top-level directories: the whole repository is mapped again, in staging.
import { DEFAULT_DRIFT_THRESHOLD, MANIFEST_NAMES, isScopePath } from './mapping.ts';

// The number of new top-level directories at which a refresh stops being a scoped one. The documentation gives no number; this is GSD's own default for
// `workflow.drift_threshold` (the count of drifting elements that blocks), reused here as a count of directories. Integers only, compared with `>=`:
// 2 new directories plan `paths`, 3 plan `full`. No ratio, no rounding.
export const FULL_REMAP_DRIFT_THRESHOLD = DEFAULT_DRIFT_THRESHOLD;

// Files whose change alters what the whole map says (dependencies and workspace layout), matched by basename at any depth.
export const REFRESH_MANIFEST_NAMES: readonly string[] = [...MANIFEST_NAMES];

// More affected paths than this are not a scoped refresh.
const MAX_SCOPE_PATHS = 50;

export type RefreshDrift = 'pass' | 'block' | 'unreadable';
export type RefreshMode = 'incremental' | 'paths' | 'full';

export interface RefreshFacts {
  // `last_mapped_commit` GSD read from the existing map; null when the map carries no stamp, so nothing can be measured from it.
  stamp: string | null;
  // GSD's own `verify codebase-drift` verdict in staging; anything that is not a clean pass or block (skipped, unresolvable stamp, a failed run) is `unreadable`.
  drift: RefreshDrift;
  // The paths GSD names when it blocks.
  affectedPaths: readonly string[];
  // The repository paths that changed between the revision the map describes and the new HEAD, outside `.planning/`.
  changedPaths: readonly string[];
  // The top-level directories the new HEAD has that the earlier revision did not, by name.
  newTopLevelDirs: readonly string[];
  // A manifest or workspace file is among the changed paths.
  manifestChanged: boolean;
}

export interface RefreshPlan {
  mode: RefreshMode;
  // Only for `paths`: the scope the mapper is asked for, sorted and unique.
  scope?: string[];
  reason: string;
}

export interface RefreshOptions {
  // A positive integer; the new top-level directory count at which the plan is `full`.
  threshold?: number;
}

const basenameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

// Whether any path is a manifest or workspace file (REFRESH_MANIFEST_NAMES, by basename at any depth).
export function touchesManifest(paths: readonly string[]): boolean {
  return paths.some((path) => REFRESH_MANIFEST_NAMES.includes(basenameOf(path)));
}

// The top-level directories among `changedPaths` that the earlier revision did not have: an entry before the first slash of a path with a slash,
// absent from the earlier revision's top-level entries. A file at the repository root is not a directory. Sorted, unique.
export function newTopLevelDirsOf(changedPaths: readonly string[], earlierTopLevel: readonly string[]): string[] {
  const known = new Set(earlierTopLevel);
  const found = new Set<string>();
  for (const path of changedPaths) {
    const slash = path.indexOf('/');
    if (slash <= 0) continue;
    const top = path.slice(0, slash);
    if (!known.has(top)) found.add(top);
  }
  return [...found].sort();
}

// The scope of a paths refresh over GSD's affected paths, or null when they cannot be scoped: none, too many, a path that cannot travel as one
// `--paths` value (T-04-27) or a manifest.
function scopeOf(affectedPaths: readonly string[]): string[] | null {
  const unique = [...new Set(affectedPaths)].sort();
  if (unique.length === 0 || unique.length > MAX_SCOPE_PATHS) return null;
  return unique.every((path) => isScopePath(path) && !REFRESH_MANIFEST_NAMES.includes(basenameOf(path))) ? unique : null;
}

// The decision table, in order. Each row that sends the refresh to `full` names why.
//   1. no stamp: full (nothing says what the map described);
//   2. drift unreadable: full (GSD could not judge the map);
//   3. a manifest or workspace file changed: full, whatever GSD said;
//   4. at least `threshold` new top-level directories: full;
//   5. drift pass: incremental (`no-change` when no path changed at all);
//   6. drift block over affected paths that can be scoped: paths; over none or paths that cannot be scoped: full.
export function planRefresh(facts: RefreshFacts, options: RefreshOptions = {}): RefreshPlan {
  const threshold = options.threshold ?? FULL_REMAP_DRIFT_THRESHOLD;
  if (!Number.isInteger(threshold) || threshold < 1) throw new TypeError(`refresh threshold must be a positive integer, got ${String(threshold)}`);
  const newDirs = new Set(facts.newTopLevelDirs).size;
  if (facts.stamp === null) return { mode: 'full', reason: 'no-stamp: the existing map carries no last_mapped_commit' };
  if (facts.drift === 'unreadable') return { mode: 'full', reason: 'drift-unreadable: GSD could not judge the existing map' };
  if (facts.manifestChanged) return { mode: 'full', reason: 'manifest-change: a manifest or workspace file changed' };
  if (newDirs >= threshold) return { mode: 'full', reason: `new-top-level-dirs: ${newDirs} new top-level directories, threshold ${threshold}` };
  if (facts.drift === 'pass') {
    return { mode: 'incremental', reason: facts.changedPaths.length === 0 ? 'no-change: nothing changed since the map' : 'no-structural-change: GSD reports no drift' };
  }
  const scope = scopeOf(facts.affectedPaths);
  if (scope === null) return { mode: 'full', reason: 'drift-block: the affected paths are none, too many, a manifest or cannot be scoped' };
  return { mode: 'paths', scope, reason: `drift-block: ${newDirs} new top-level directories, below ${threshold}` };
}
