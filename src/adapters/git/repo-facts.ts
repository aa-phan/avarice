// Read-only repository facts for preflight (ONB-3, ONB-6, T-01-16). Everything comes from `runGit` (safe git:
// no hooks, no fsmonitor, filters neutralized for the one call that compares working-tree files) and from
// git objects at the pinned commit. A file of the checkout is never opened: uncommitted and untracked files
// are known by name only, and committed content (a map file's frontmatter, `package.json`, `.nvmrc`) is read
// with `git cat-file blob {pin}:{path}`, so an edit in the working tree cannot change what is reported.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { MapFileFacts, RepoFacts } from '../../domain/preflight.ts';
import { runGit } from './safe-git.ts';

const LISTING_TIMEOUT_MS = 60_000;
// Committed files larger than this are not read for their content.
const MAX_CONTENT_BYTES = 256 * 1024;
const MAX_RUNTIME_TEXT = 200;

const ADR_DIRECTORIES = ['docs/decisions', 'docs/adr', 'adr', 'doc/adr'];
const ROOT_MANIFESTS = ['pnpm-workspace.yaml', 'lerna.json', 'turbo.json', 'nx.json'];
const ROOT_RUNTIME_FILES = ['.nvmrc', '.node-version', '.tool-versions'];
const MAP_DIRECTORY = '.planning/codebase/';

export function stripCredentials(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1');
}

export interface StatusEntries {
  modified: string[];
  untracked: string[];
}

// `git status --porcelain=v2 -z`: records are NUL separated; a rename or copy record (`2`) is followed by
// one extra NUL-separated field, its original path.
export function parseStatus(stdout: string): StatusEntries {
  const modified: string[] = [];
  const untracked: string[] = [];
  const fields = stdout.split('\0');
  const pathAfter = (record: string, spaces: number): string => {
    let from = 0;
    for (let i = 0; i < spaces; i++) from = record.indexOf(' ', from) + 1;
    return record.slice(from);
  };
  for (let i = 0; i < fields.length; i++) {
    const record = fields[i] as string;
    if (record.length === 0) continue;
    switch (record[0]) {
      case '1':
        modified.push(pathAfter(record, 8));
        break;
      case '2':
        modified.push(pathAfter(record, 9));
        i++;
        break;
      case 'u':
        modified.push(pathAfter(record, 10));
        break;
      case '?':
        untracked.push(record.slice(2));
        break;
      default:
        break;
    }
  }
  return { modified: modified.sort(), untracked: untracked.sort() };
}

interface TreeEntry {
  mode: string;
  type: string;
  path: string;
  size: number;
}

// `git ls-tree -r -l -z`: `<mode> <type> <object> <size>\t<path>`, size `-` for a gitlink.
function parseTree(stdout: string): TreeEntry[] {
  const entries: TreeEntry[] = [];
  for (const record of stdout.split('\0')) {
    const tab = record.indexOf('\t');
    if (tab === -1) continue;
    const [mode, type, , size] = record.slice(0, tab).split(/\s+/);
    if (mode === undefined || type === undefined) continue;
    entries.push({ mode, type, path: record.slice(tab + 1), size: size === undefined || size === '-' ? 0 : Number(size) });
  }
  return entries;
}

const sortedUnique = (values: Iterable<string>): string[] => [...new Set(values)].sort();

function optional(args: readonly string[], cwd: string): string | null {
  const result = runGit(args, { cwd });
  if (!result.ok) return null;
  const text = result.value.stdout.trim();
  return text.length > 0 ? text : null;
}

function defaultBranchOf(cwd: string): string | null {
  const remoteHead = optional(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd);
  if (remoteHead !== null) return remoteHead.replace(/^origin\//, '');
  for (const name of ['main', 'master']) {
    if (optional(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], cwd) !== null) return name;
  }
  return null;
}

// `last_mapped_commit` from YAML frontmatter at the top of a document; null when absent or not a SHA.
export function readStamp(content: string): string | null {
  const lines = content.split('\n');
  if ((lines[0] ?? '').trim() !== '---') return null;
  for (let i = 1; i < Math.min(lines.length, 60); i++) {
    const line = (lines[i] as string).trim();
    if (line === '---') return null;
    const match = /^last_mapped_commit:\s*["']?([0-9a-fA-F]{7,64})["']?$/.exec(line);
    if (match?.[1] !== undefined) return match[1].toLowerCase();
  }
  return null;
}

export function collectRepoFacts(repoPath: string): Result<RepoFacts> {
  const cwd = repoPath;
  const top = runGit(['rev-parse', '--show-toplevel'], { cwd });
  if (!top.ok) return top;
  const roots = runGit(['rev-list', '--max-parents=0', 'HEAD'], { cwd });
  if (!roots.ok) return roots;
  const pinned = runGit(['rev-parse', 'HEAD'], { cwd });
  if (!pinned.ok) return pinned;
  const branch = runGit(['branch', '--show-current'], { cwd });
  if (!branch.ok) return branch;
  const status = runGit(['status', '--porcelain=v2', '-z', '--untracked-files=all'], { cwd, neutralizeFilters: true });
  if (!status.ok) return status;
  const pin = pinned.value.stdout.trim();
  const tree = runGit(['ls-tree', '-r', '-l', '-z', pin], { cwd, timeoutMs: LISTING_TIMEOUT_MS });
  if (!tree.ok) return tree;

  // A repository can have several root commits; the lowest SHA is a stable, deterministic choice.
  const rootCommit = roots.value.stdout.split('\n').filter((line) => line.length > 0).sort()[0];
  if (rootCommit === undefined) return err({ kind: 'internal', cause: 'repository has no root commit' });

  const entries = parseTree(tree.value.stdout);
  const blobs = entries.filter((entry) => entry.type === 'blob');
  const sizeOf = new Map(blobs.map((entry) => [entry.path, entry.size]));
  const modeOf = new Map(blobs.map((entry) => [entry.path, entry.mode]));

  // Committed content only, through git objects, regular files only, size-bounded.
  const committed = (path: string): string | null => {
    const mode = modeOf.get(path);
    if (mode !== '100644' && mode !== '100755') return null;
    if ((sizeOf.get(path) ?? 0) > MAX_CONTENT_BYTES) return null;
    const blob = runGit(['cat-file', 'blob', `${pin}:${path}`], { cwd });
    return blob.ok ? blob.value.stdout : null;
  };

  const trackedPaths = blobs.map((entry) => entry.path);
  const parsed = parseStatus(status.value.stdout);

  const planningFiles = trackedPaths.filter((path) => path.startsWith('.planning/')).sort();

  const codebaseMapFiles: MapFileFacts[] = trackedPaths
    .filter((path) => path.startsWith(MAP_DIRECTORY) && !path.slice(MAP_DIRECTORY.length).includes('/'))
    .sort()
    .map((path) => {
      const stamp = readStamp(committed(path) ?? '');
      const lastCommit = optional(['log', '-1', '--format=%H', '--no-ext-diff', '--no-textconv', pin, '--', path], cwd);
      const stampCommit =
        stamp === null ? null : optional(['log', '-1', '--format=%H', '--no-ext-diff', '--no-textconv', `-S${stamp}`, pin, '--', path], cwd);
      return { path, lastMappedCommit: stamp, stampCommit, lastCommit };
    });

  const instructionFiles = new Set<string>();
  for (const path of trackedPaths) {
    const segments = path.split('/');
    const name = segments[segments.length - 1] as string;
    if (name === 'CLAUDE.md' || name === 'AGENTS.md') instructionFiles.add(path);
    const claude = segments.indexOf('.claude');
    if (claude !== -1 && claude < segments.length - 1) instructionFiles.add(`${segments.slice(0, claude + 1).join('/')}/`);
  }

  const workspaceManifests = ROOT_MANIFESTS.filter((name) => sizeOf.has(name));
  const runtimes: string[] = [];
  const packageJson = committed('package.json');
  if (packageJson !== null) {
    try {
      const manifest = JSON.parse(packageJson) as { workspaces?: unknown; engines?: unknown };
      if (manifest.workspaces !== undefined && manifest.workspaces !== null) workspaceManifests.push('package.json');
      if (typeof manifest.engines === 'object' && manifest.engines !== null && !Array.isArray(manifest.engines)) {
        for (const [engine, range] of Object.entries(manifest.engines)) {
          if (typeof range === 'string') runtimes.push(`package.json engines.${engine}:${range}`.slice(0, MAX_RUNTIME_TEXT));
        }
      }
    } catch {
      // A package.json that does not parse contributes no facts; preflight is not a validator.
    }
  }
  for (const name of ROOT_RUNTIME_FILES) {
    const text = committed(name);
    if (text === null) continue;
    const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith('#'));
    if (lines.length > 0) runtimes.push(`${name}:${lines.join('; ')}`.slice(0, MAX_RUNTIME_TEXT));
  }

  const adrDirs = ADR_DIRECTORIES.filter((dir) => trackedPaths.some((path) => path.startsWith(`${dir}/`)));

  const facts: RepoFacts = {
    gitRoot: top.value.stdout.trim(),
    rootCommit,
    pin,
    branch: branch.value.stdout.trim(),
    defaultBranch: defaultBranchOf(cwd),
    modified: parsed.modified,
    untracked: parsed.untracked,
    planningFiles,
    codebaseMapFiles,
    submodules: entries.filter((entry) => entry.mode === '160000').map((entry) => entry.path).sort(),
    // git lists a nested repository that is not a submodule as one untracked directory entry.
    nestedRepos: parsed.untracked.filter((name) => name.endsWith('/')),
    workspaceManifests: sortedUnique(workspaceManifests),
    instructionFiles: sortedUnique(instructionFiles),
    adrDirs,
    runtimes: sortedUnique(runtimes),
    trackedFiles: blobs.length,
    trackedBytes: blobs.reduce((sum, entry) => sum + entry.size, 0),
  };
  const remote = optional(['remote', 'get-url', 'origin'], cwd);
  if (remote !== null) facts.remote = stripCredentials(remote);
  return ok(facts);
}
