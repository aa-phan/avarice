// Scratch git repositories for integration tests. Every repository lives under os.tmpdir(); a test never
// points git at the AVARICE checkout or at the user's repositories. The helper runs git with a clean
// global configuration (no signing, no user hooks) so results do not depend on the machine.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

export interface ScratchRepoOptions {
  // Tracked files of the first commit, relative path to content.
  files?: Readonly<Record<string, string>>;
  // Further commits, oldest first; each map is written and committed.
  commits?: ReadonlyArray<Readonly<Record<string, string>>>;
  // Untracked files written after the last commit.
  untracked?: Readonly<Record<string, string>>;
  // Tracked files overwritten after the last commit and left uncommitted.
  modified?: Readonly<Record<string, string>>;
}

export interface ScratchRepo {
  // Realpath of the repository root.
  path: string;
  // Directory that holds the repository; remove it to dispose.
  base: string;
  // Commit SHAs, oldest first (the first commit is the root commit).
  shas: string[];
  head: string;
  dispose(): void;
}

function gitEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env['PATH'] ?? '/usr/bin:/bin',
    HOME: tmpdir(),
    LANG: 'C',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
}

export function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd, env: gitEnv(), encoding: 'utf8' });
}

function writeFiles(root: string, files: Readonly<Record<string, string>>): void {
  for (const [rel, content] of Object.entries(files)) {
    const target = join(root, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

function commitAll(root: string, message: string): string {
  git(root, ['add', '-A']);
  git(root, [
    '-c', 'user.name=Scratch',
    '-c', 'user.email=scratch@example.invalid',
    '-c', 'commit.gpgsign=false',
    'commit', '-q', '--allow-empty', '-m', message,
  ]);
  return git(root, ['rev-parse', 'HEAD']).trim();
}

export function makeScratchRepo(options: ScratchRepoOptions = {}): ScratchRepo {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-scratch-')));
  const path = join(base, 'repo');
  mkdirSync(path);
  git(path, ['init', '-q', '-b', 'main']);
  writeFiles(path, options.files ?? { 'README.md': '# scratch\n' });
  const shas = [commitAll(path, 'root')];
  for (const [index, files] of (options.commits ?? []).entries()) {
    writeFiles(path, files);
    shas.push(commitAll(path, `commit ${index + 2}`));
  }
  if (options.modified) writeFiles(path, options.modified);
  if (options.untracked) writeFiles(path, options.untracked);
  return {
    path,
    base,
    shas,
    head: shas[shas.length - 1] as string,
    dispose: () => rmSync(base, { recursive: true, force: true }),
  };
}

// Writes an executable file (a hook or a script) and returns its path.
export function writeExecutable(path: string, content: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, 0o755);
  return path;
}

// Digest of every file under root outside .git: relative path and bytes, in sorted order. `skip` names relative
// paths to leave out (a file that carries a timestamp, for example).
export function treeDigest(root: string, skip: (relPath: string) => boolean = () => false): string {
  const hash = createHash('sha256');
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (dir === root && entry.name === '.git') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && !skip(relative(root, full))) hash.update(relative(root, full)).update('\0').update(readFileSync(full)).update('\0');
    }
  };
  walk(root);
  return hash.digest('hex');
}

// What "the user's checkout is unchanged" means (research, staging worktree mechanics): HEAD, branch,
// porcelain status including untracked files, and the file digest.
export function checkoutSnapshot(root: string): { head: string; branch: string; status: string; digest: string } {
  const env = { ...gitEnv(), GIT_OPTIONAL_LOCKS: '0' };
  const run = (args: string[]): string => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' });
  return {
    head: run(['rev-parse', 'HEAD']).trim(),
    branch: run(['branch', '--show-current']).trim(),
    status: run(['status', '--porcelain=v2', '-z', '--untracked-files=all']),
    digest: treeDigest(root),
  };
}
