// What the repository's own committed files say a path-looking token is (deferred item 10, second owner decision). A token such as
// `motion/react` or `react/rules-of-hooks` names a module or a lint rule when its first segment is a dependency of a committed
// package.json; `actions/checkout` names an action when a committed workflow `uses:` it. Pure: the caller reads the files from git
// objects at the pin (never a checkout) and passes their text.
import { matchesAny } from './glob.ts';

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;
const MAX_PACKAGE_FILES = 50;
const MAX_WORKFLOW_FILES = 50;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function parse(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

// The names listed under dependencies, devDependencies, peerDependencies and optionalDependencies of each package.json text,
// scoped names whole (`@scope/name`). Nothing else in the file (scripts, engines, workspaces, its own name) is a dependency.
export function dependencyNamesOf(texts: Iterable<string>): string[] {
  const names = new Set<string>();
  for (const text of texts) {
    const manifest = parse(text);
    if (manifest === null) continue;
    for (const field of DEPENDENCY_FIELDS) {
      const section = manifest[field];
      if (!isObject(section)) continue;
      for (const [name, version] of Object.entries(section)) if (typeof version === 'string') names.add(name);
    }
  }
  return [...names];
}

const USES_LINE = /^\s*(?:-\s*)?uses:\s*(['"]?)([^\s'"#]+)\1/;
const OWNER_NAME = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

// `owner/name` of every `uses: owner/name[@ref]` line of the workflow texts. A local action (`./x`), a docker image and a
// reusable workflow or action with a path below `owner/name` are not named here.
export function actionRefsOf(texts: Iterable<string>): string[] {
  const refs = new Set<string>();
  for (const text of texts) {
    for (const line of text.split('\n')) {
      const match = USES_LINE.exec(line);
      if (match === null) continue;
      const ref = (match[2] as string).split('@')[0] as string;
      if (OWNER_NAME.test(ref)) refs.add(ref);
    }
  }
  return [...refs];
}

// The package.json files to read: the root one when it is tracked, plus the packages the root's `workspaces` field (an array or
// `{ packages }`) declares. pnpm-workspace.yaml is not read. A package.json that is not the root and not a declared workspace is
// not read, and nothing under node_modules is.
export function packageJsonPathsFor(tracked: readonly string[], rootText: string | null): string[] {
  if (!tracked.includes('package.json')) return [];
  const root = rootText === null ? null : parse(rootText);
  const declared = root === null ? undefined : root['workspaces'];
  const patterns = Array.isArray(declared) ? declared : isObject(declared) && Array.isArray(declared['packages']) ? declared['packages'] : [];
  const globs = patterns.filter((p): p is string => typeof p === 'string' && p !== '' && !p.startsWith('/') && !p.includes('..')).map((p) => `${p.replace(/\/+$/, '')}/package.json`);
  const nested =
    globs.length === 0
      ? []
      : tracked.filter((path) => path !== 'package.json' && path.endsWith('/package.json') && !path.split('/').includes('node_modules') && matchesAny(path, globs));
  return ['package.json', ...nested.sort()].slice(0, MAX_PACKAGE_FILES);
}

// The workflow files to read: top-level `.github/workflows/*.yml` and `*.yaml`.
export function workflowPathsFor(tracked: readonly string[]): string[] {
  return tracked.filter((path) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)).sort().slice(0, MAX_WORKFLOW_FILES);
}
