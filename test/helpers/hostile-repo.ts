// A repository that runs code the moment plain git touches it (ONB-4). Four traps, each writing a marker
// file under a directory outside the repository:
//   .git/hooks/post-checkout and .git/hooks/post-commit  append their name to {markers}/hook-ran
//   core.fsmonitor                                       touches {markers}/fsmonitor-ran on `git status`
//   filter.evil.clean and .smudge (via .gitattributes)   touch {markers}/filter-ran when a *.txt file is
//                                                        compared or written
// The repository is created with a clean global configuration, then armed; nothing here ever runs git on it
// afterwards, so a marker means the code under test (or the positive control) ran it.
import { mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, makeScratchRepo, writeExecutable } from './scratch-repo.ts';
import type { ScratchRepo } from './scratch-repo.ts';

export const HOSTILE_SECRET = 'HOSTILE-FIXTURE-SECRET-d41d8cd98f00';

export const HOSTILE_FILES: Readonly<Record<string, string>> = {
  'README.md': '# hostile\n',
  '.gitattributes': '*.txt filter=evil\n',
  'notes.txt': 'committed\n',
  'src/index.ts': 'export const answer = 42;\n',
};

export interface HostileRepoOptions {
  // Tracked files of the first commit; default HOSTILE_FILES.
  files?: Readonly<Record<string, string>>;
  // Leave a tracked *.txt file modified so that plain `git status` has to run the clean filter. Default true.
  dirtyTracked?: boolean;
  // Install the clean/smudge filter trap. Default true. A strategy that checks files out of the user's own
  // `.git` (a linked worktree) shares that configuration, so only the clone is expected to survive it.
  filter?: boolean;
}

export interface HostileRepo {
  repo: ScratchRepo;
  // Directory the traps write into.
  markerDir: string;
  // Names of the marker files present.
  markers(): string[];
  clearMarkers(): void;
  // Runs plain git (the traps are live) in a way that fires each trap: `status` for the fsmonitor, `status`
  // with the fsmonitor off for the clean filter, `switch -c` for post-checkout, an empty commit for post-commit. Use it on a throwaway
  // repository only: it commits.
  fireTrapsWithPlainGit(): void;
  dispose(): void;
}

export function makeHostileRepo(options: HostileRepoOptions = {}): HostileRepo {
  const repo = makeScratchRepo({ files: options.files ?? HOSTILE_FILES });
  const markerDir = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-markers-')));
  const scripts = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-trap-scripts-')));

  const hook = (name: string): string =>
    `#!/bin/sh\necho ${name} >> "${join(markerDir, 'hook-ran')}"\n`;
  writeExecutable(join(repo.path, '.git', 'hooks', 'post-checkout'), hook('post-checkout'));
  writeExecutable(join(repo.path, '.git', 'hooks', 'post-commit'), hook('post-commit'));

  const fsmonitor = writeExecutable(join(scripts, 'fsmonitor.sh'), `#!/bin/sh\ntouch "${join(markerDir, 'fsmonitor-ran')}"\n`);
  const filter = writeExecutable(join(scripts, 'filter.sh'), `#!/bin/sh\ntouch "${join(markerDir, 'filter-ran')}"\ncat\n`);
  git(repo.path, ['config', 'core.fsmonitor', fsmonitor]);
  if (options.filter !== false) {
    git(repo.path, ['config', 'filter.evil.clean', filter]);
    git(repo.path, ['config', 'filter.evil.smudge', filter]);
  }

  // Same length as the committed text: git cannot tell by size alone and must run the clean filter to compare.
  if (options.dirtyTracked !== false) writeFileSync(join(repo.path, 'notes.txt'), 'commitTED\n');

  return {
    repo,
    markerDir,
    markers: () => readdirSync(markerDir).sort(),
    clearMarkers: () => {
      for (const name of readdirSync(markerDir)) rmSync(join(markerDir, name), { force: true });
    },
    fireTrapsWithPlainGit: () => {
      git(repo.path, ['status', '--porcelain']);
      // With the fsmonitor trap answering, git trusts it and never compares file content; switching it off
      // is what exposes the clean filter, so the control runs both.
      git(repo.path, ['-c', 'core.fsmonitor=false', 'status', '--porcelain']);
      git(repo.path, ['switch', '-q', '-c', 'control-branch']);
      git(repo.path, ['-c', 'user.name=Scratch', '-c', 'user.email=scratch@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'control']);
    },
    dispose: () => {
      repo.dispose();
      rmSync(markerDir, { recursive: true, force: true });
      rmSync(scripts, { recursive: true, force: true });
    },
  };
}
