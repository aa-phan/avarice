// A scratch repository that already carries a committed, GSD-stamped seven-file map (plan 04-10). The source is committed first; the map is
// committed next and stamped with the source commit, as `/gsd-map-codebase` leaves it: a map of the code at the stamp, committed after it.
// Variants build the other classes of an existing map: edited after its stamp commit, a different file set, drift after the stamp, a partial or
// unstamped set. Every repository is a scratch repository under os.tmpdir().
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ALL_MAP_FILES, fakeMapDocument } from './fake-agent-host.ts';
import { git, makeScratchRepo } from './scratch-repo.ts';
import type { ScratchRepo } from './scratch-repo.ts';

export const STAMPED_SOURCE_FILES: Readonly<Record<string, string>> = {
  'README.md': '# stamped fixture\n',
  'package.json': '{"name":"stamped-fixture"}\n',
  'src/index.ts': 'export const answer = 42;\n',
  'src/util/strings.ts': 'export const upper = (s: string): string => s.toUpperCase();\n',
};

export interface StampedMapOptions {
  // Map files to write, by name; default all seven.
  files?: readonly string[];
  // Write the files without a stamp (an unstamped map).
  unstamped?: boolean;
  // Stamp the files with this value instead of the source commit (a forged or stale stamp that names no commit of the repository).
  stamp?: string;
  // Extra files under `.planning/codebase/` in the map commit (a different file set makes the map an unknown format).
  extraMapFiles?: Readonly<Record<string, string>>;
  // Map files (by name) the owner edits in a commit after the map commit: a line is appended, the stamp is kept, so the stamp commit stays
  // before the last commit of the file (an edit after the stamp).
  editedAfterStamp?: readonly string[];
  // Each entry is one further commit after the map commit: path to content, written and committed (drift, or an edit of a map file).
  after?: ReadonlyArray<Readonly<Record<string, string>>>;
  // Uncommitted state left in the checkout after the last commit.
  untracked?: Readonly<Record<string, string>>;
  modified?: Readonly<Record<string, string>>;
}

export interface StampedMapRepo extends ScratchRepo {
  // The commit the map was made from and stamped with.
  sourceCommit: string;
  // The commit that added the map files.
  mapCommit: string;
  // The repository-relative paths of the map files written.
  mapFiles: string[];
}

function commitAll(root: string, message: string): string {
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.name=Scratch', '-c', 'user.email=scratch@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']).trim();
}

function write(root: string, files: Readonly<Record<string, string>>): void {
  for (const [rel, content] of Object.entries(files)) {
    const target = join(root, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

export function makeStampedMapRepo(options: StampedMapOptions = {}): StampedMapRepo {
  const repo = makeScratchRepo({ files: STAMPED_SOURCE_FILES });
  const sourceCommit = repo.head;
  const tracked = Object.keys(STAMPED_SOURCE_FILES);
  const names = options.files ?? ALL_MAP_FILES;
  const documents: Record<string, string> = {};
  for (const name of names) {
    documents[`.planning/codebase/${name}`] = fakeMapDocument(name, options.unstamped === true ? false : (options.stamp ?? sourceCommit), tracked, undefined);
  }
  write(repo.path, documents);
  write(repo.path, options.extraMapFiles ?? {});
  const mapCommit = commitAll(repo.path, 'map the codebase');
  const shas = [...repo.shas, mapCommit];
  if (options.editedAfterStamp !== undefined && options.editedAfterStamp.length > 0) {
    const edits: Record<string, string> = {};
    for (const name of options.editedAfterStamp) {
      const path = `.planning/codebase/${name}`;
      const original = documents[path];
      if (original === undefined) throw new Error(`${name} is not a map file of this fixture`);
      edits[path] = `${original}\nEdited by the owner after the stamp.\n`;
    }
    write(repo.path, edits);
    shas.push(commitAll(repo.path, 'owner edits the map'));
  }
  for (const [index, files] of (options.after ?? []).entries()) {
    write(repo.path, files);
    shas.push(commitAll(repo.path, `after the map ${index + 1}`));
  }
  write(repo.path, options.modified ?? {});
  write(repo.path, options.untracked ?? {});
  return {
    ...repo,
    shas,
    head: shas[shas.length - 1] as string,
    sourceCommit,
    mapCommit,
    mapFiles: Object.keys(documents).sort(),
  };
}
