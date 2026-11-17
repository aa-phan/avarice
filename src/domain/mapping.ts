// Mapping modes, the GSD map file sets and completeness labels
// (docs/repository-onboarding.md "Mapping-mode decision table", "Validation").
import { err, ok } from './result.ts';
import type { Result } from './result.ts';
import type { ExistingMapClass, ExistingMapOutcome } from './preflight.ts';
import type { RefreshPlan } from './refresh-plan.ts';
import { normalizedAbsoluteRoot } from './normalized-root.ts';

export const MAPPING_MODES = ['skip', 'adopt', 'fast', 'full', 'paths'] as const;
export type MappingMode = (typeof MAPPING_MODES)[number];

export type Completeness = 'complete' | 'partial' | 'none';

export interface MappingPlan {
  mode: MappingMode;
  paths?: readonly string[];
  existingMapAnswer?: 'refresh' | 'update' | 'skip';
}

const DIR = '.planning/codebase/';
const file = (name: string): string => `${DIR}${name}.md`;

// GSD 1.17 map completeness is checked by file existence (onboard-projection.cjs:29-35):
// seven files for a complete map, four for a fast map (workflows/scan.md `tech+arch`).
export const FULL_MAP_FILES: readonly string[] = [
  'STACK',
  'ARCHITECTURE',
  'STRUCTURE',
  'CONVENTIONS',
  'TESTING',
  'INTEGRATIONS',
  'CONCERNS',
].map(file);

export const FAST_MAP_FILES: readonly string[] = ['STACK', 'INTEGRATIONS', 'ARCHITECTURE', 'STRUCTURE'].map(file);

// Files a mode must produce. `adopt` takes an existing map, which GSD recognises from four files up;
// plan 01-10 adds the remaining rules. `skip` maps nothing, so nothing is required.
export function requiredFilesFor(mode: MappingMode): readonly string[] {
  switch (mode) {
    case 'skip':
      return [];
    case 'fast':
    case 'adopt':
      return FAST_MAP_FILES;
    case 'full':
    case 'paths':
      return FULL_MAP_FILES;
    default:
      throw new TypeError(`unknown mapping mode ${String(mode)}`);
  }
}

// Completeness is never above what the evidence supports (ONB-7): only a full map is `complete`.
// An adopted map is `complete` only when every full-map file is present; without that
// evidence it is `partial`.
export function completenessFor(mode: MappingMode, filesPresent?: readonly string[]): Completeness {
  switch (mode) {
    case 'full':
      return 'complete';
    case 'fast':
    case 'paths':
      return 'partial';
    case 'skip':
      return 'none';
    case 'adopt': {
      const present = new Set(filesPresent ?? []);
      return FULL_MAP_FILES.every((f) => present.has(f)) ? 'complete' : 'partial';
    }
    default:
      throw new TypeError(`unknown mapping mode ${String(mode)}`);
  }
}

// The prompt of a restricted onboarding's map. The restricted host has no shell, so the model cannot resolve a home directory and, left to guess, reads a path that
// does not exist and that the hook refuses (the first live restricted onboarding, plan 04-34). The prompt therefore names the absolute workflow files the skill loads,
// under the same gsd-core root the hook policy holds as a read root (the caller passes that value; nothing here reads the environment). A root that is not a
// normalized absolute path throws a RootRefusedError, so a guess never reaches the model. The text names no home-directory form.
export function restrictedMapPrompt(prompt: string, gsdCoreDir: string): string {
  const root = normalizedAbsoluteRoot(gsdCoreDir, 'the gsd-core directory');
  return [
    prompt,
    'This session has no shell, so no path can be looked up or expanded, and none may be guessed. GSD lives at one absolute path:',
    `- gsd-core root: ${root}`,
    `- map workflow: ${root}/workflows/map-codebase.md`,
    `- fast scan workflow: ${root}/workflows/scan.md`,
    'Read a workflow spec from the absolute path above with the Read tool, wherever the skill says it is. Any other file the specs name under gsd-core is under that root.',
  ].join('\n');
}

// GSD's default `workflow.drift_threshold`; the refresh planner (refresh-plan.ts) reuses it as the number of new top-level directories that sends a
// refresh to a full map.
export const DEFAULT_DRIFT_THRESHOLD = 3;

// A path a scoped map may be asked for: relative, plain characters, no `..` segment, not option-shaped. The list is passed to the mapper as the
// one comma-separated value of `--paths`, so a comma, a space or a leading dash would change what it means (T-04-27).
const SCOPE_PATH = /^[A-Za-z0-9_@+][A-Za-z0-9._@+/-]*$/;

export function isScopePath(path: string): boolean {
  return SCOPE_PATH.test(path) && !path.split('/').some((segment) => segment === '' || segment === '..' || segment === '.');
}

// Dependency and workspace manifests: a drift that touches one changes what the whole map says, so it is mapped in full (refresh-plan.ts exports the
// list as REFRESH_MANIFEST_NAMES).
export const MANIFEST_NAMES: ReadonlySet<string> = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'yarn.lock',
  'bun.lockb',
  'turbo.json',
  'nx.json',
  'lerna.json',
  'rush.json',
  'Cargo.toml',
  'Cargo.lock',
  'go.mod',
  'go.sum',
  'go.work',
  'pyproject.toml',
  'poetry.lock',
  'requirements.txt',
  'Pipfile',
  'Gemfile',
  'Gemfile.lock',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'composer.json',
  'mix.exs',
]);

const GLOB_CHARS = /[*?[\]{}!\\]/;

// The directories a contract read scope confines the mapper to, or null when the scope is the whole repository (or cannot be written as
// directories, so the mapper is confined by the contract alone). A pattern gives its literal leading directories: `apps/web/**` gives `apps/web`.
export function readScopePaths(read: readonly string[]): string[] | null {
  if (read.length === 0) return null;
  const found = new Set<string>();
  for (const raw of read) {
    const pattern = raw.startsWith('./') ? raw.slice(2) : raw;
    const literal: string[] = [];
    for (const segment of pattern.split('/')) {
      if (segment === '' || GLOB_CHARS.test(segment)) break;
      literal.push(segment);
    }
    if (literal.length === 0) return null;
    const prefix = literal.join('/');
    if (!isScopePath(prefix)) return null;
    found.add(prefix);
  }
  const sorted = [...found].sort();
  // `apps` already covers `apps/web`.
  return sorted.filter((path) => !sorted.some((other) => other !== path && path.startsWith(`${other}/`)));
}

export interface MappingModeInput {
  isBrownfield: boolean;
  requested?: string;
  existingMap?: ExistingMapClass;
  // What happens to the map the repository has (`existingMapOutcome`, from the class and GSD's drift verdict in staging). Absent: no existing map to adopt or refresh.
  outcome?: ExistingMapOutcome;
  // The refresh plan (`planRefresh`) for a map the repository already has: a stamped-complete map with GSD's drift verdict in staging, or any map of
  // an active project. It decides adopt (incremental), a path-scoped map or a full map; an explicit request still wins.
  refresh?: RefreshPlan;
  // The contract's `files.read` globs; narrower than the repository means a path-scoped map.
  readScope?: readonly string[];
}

export interface MappingModeDecision {
  mode: MappingMode;
  completeness: Completeness;
  existingMap: ExistingMapClass;
  outcome: ExistingMapOutcome;
  reason: string;
  // Only for `paths`: the scope the mapper is asked for and the record states.
  paths?: string[];
}

// The decision table of docs/repository-onboarding.md "Mapping-mode decision table". In order:
//   - not brownfield (GSD's own `is_brownfield`): skip mapping, completeness `none`;
//   - requested `skip`: skip; requested `fast`: fast (`partial`);
//   - requested `adopt`: adopt when the map is adoptable (drift pass), else unsupported with reduced mode `full`;
//   - requested `paths`: the directories of the contract read scope, or invalid when that scope is the whole repository;
//   - otherwise by the refresh plan when there is one (`planRefresh`: incremental takes the map with no mapper, paths maps its scope, full maps
//     everything), else by the outcome: `adopt` takes the map (no mapper; `complete`, because a stamped-complete map holds all seven files);
//     every other outcome maps in full in staging, or the directories of a narrower contract read scope.
// The existing map is never written in the user's checkout; every regeneration is in the staging workspace.
export function chooseMappingMode(input: MappingModeInput): Result<MappingModeDecision> {
  const existingMap: ExistingMapClass = input.existingMap ?? 'none';
  const outcome: ExistingMapOutcome = input.outcome ?? (existingMap === 'none' ? 'map' : 'full-in-staging');
  const requested = input.requested;
  if (requested !== undefined && !(MAPPING_MODES as readonly string[]).includes(requested)) {
    return err({ kind: 'invalid', field: 'mode', reason: `unknown mapping mode ${JSON.stringify(requested)}` });
  }
  const decide = (mode: MappingMode, reason: string, paths?: string[], filesPresent?: readonly string[]): Result<MappingModeDecision> =>
    ok({ mode, completeness: completenessFor(mode, filesPresent), existingMap, outcome, reason, ...(paths !== undefined ? { paths } : {}) });
  const scoped = (reason: string, paths: string[]): Result<MappingModeDecision> => decide('paths', `${reason}: ${paths.join(', ')}`, paths);

  if (!input.isBrownfield) return decide('skip', 'not brownfield: planning from the brief only');
  const narrower = input.readScope === undefined ? null : readScopePaths(input.readScope);
  switch (requested) {
    case 'skip':
      return decide('skip', 'mapping skipped on request');
    case 'fast':
      return decide('fast', 'fast map requested');
    case 'adopt':
      return outcome === 'adopt'
        ? decide('adopt', 'adoption requested; the stamped map passed the drift check', undefined, FULL_MAP_FILES)
        : err({ kind: 'unsupported', capability: 'adopt-map', reducedMode: 'full', detail: `the existing map (${existingMap}) is not adoptable (outcome ${outcome}); it is mapped in staging` });
    case 'paths':
      return narrower === null
        ? err({ kind: 'invalid', field: 'mode', reason: 'mode paths needs a contract read scope narrower than the repository' })
        : scoped('path-scoped map requested', narrower);
    default:
      break;
  }
  const refresh = input.refresh;
  if (refresh !== undefined) {
    if (refresh.mode === 'incremental') return decide('adopt', `refresh ${refresh.reason}: the map is kept, no remap`, undefined, FULL_MAP_FILES);
    if (refresh.mode === 'paths' && refresh.scope !== undefined) return scoped(`refresh ${refresh.reason}: path-scoped refresh in staging`, refresh.scope);
    if (narrower !== null) return scoped(`refresh ${refresh.reason}: contract read scope narrower than the repository`, narrower);
    return decide('full', `refresh ${refresh.reason}: full remap in staging`);
  }
  if (outcome === 'adopt') return decide('adopt', 'complete stamped map, drift pass: adopted, no remap', undefined, FULL_MAP_FILES);
  if (outcome === 'refresh') return decide('full', 'drift block with no refresh plan: full remap in staging');
  if (narrower !== null) return scoped('contract read scope narrower than the repository: path-scoped map', narrower);
  return decide('full', existingMap === 'none' ? 'brownfield repository, full map' : `existing map (${existingMap}) regenerated in staging, full map`);
}
