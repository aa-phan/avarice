// Park and unpark of a paused work item's delta (plan 03-09; AUT-3, research Pitfall 1; T-03-15). Every repository is a scratch repository
// under os.tmpdir(); nothing here runs git against the AVARICE checkout or the owner's repositories.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { CloneRunWorkspace } from '../../src/adapters/git/run-workspace.ts';
import type { Result } from '../../src/domain/result.ts';
import type { ParkRecord, RunWorkspaceInfo } from '../../src/ports/run-workspace.ts';
import { checkoutSnapshot, git, gitRun, makeScratchRepo, treeDigest } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) (cleanups.pop() as () => void)();
});

const RUN = 'run_PARKRUN1';
const BASE_FILES = {
  'README.md': '# scratch\n',
  'src/a.ts': 'export const a = 1;\n',
  'src/b.ts': 'export const b = 2;\n',
  'src/old.ts': 'export const old = 0;\n',
  '.gitignore': 'ignored.log\n.cache/\n',
};

function scratch(): ScratchRepo {
  const repo = makeScratchRepo({ files: BASE_FILES });
  cleanups.push(repo.dispose);
  return repo;
}

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function must<T>(result: Result<T>): T {
  assert.ok(result.ok, result.ok ? '' : `expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

function mustFail<T>(result: Result<T>): { kind: string; [key: string]: unknown } {
  assert.equal(result.ok, false, 'expected an error result');
  return (result as { ok: false; error: { kind: string } }).error;
}

function write(root: string, rel: string, content: string): void {
  const target = join(root, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

const ws = new CloneRunWorkspace();

function prepared(repo: ScratchRepo): RunWorkspaceInfo {
  return must(ws.prepare({ repoPath: repo.path, workRoot: tempDir('avarice-park-'), runId: RUN, pin: repo.head }));
}

const isLink = (target: string): boolean => {
  try {
    return lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
};
const read = (root: string, rel: string): string => readFileSync(join(root, rel), 'utf8');

// Item B's half-done work: an edit, a quick record that is new and a deleted file. Returns the base snapshot taken before it.
function runItemB(clone: string): ReturnType<typeof ws.snapshot> {
  const base = ws.snapshot(clone);
  write(clone, 'src/a.ts', 'export const a = 100;\n');
  write(clone, '.planning/quick/q1/PLAN.md', '# the plan of B\n');
  rmSync(join(clone, 'src', 'old.ts'));
  return base;
}

describe('CloneRunWorkspace.park and unpark: the tracer (AUT-3)', () => {
  it('parks item B, lets item C commit on the clean tree, and unparks B on top of C', () => {
    const repo = scratch();
    const info = prepared(repo);
    const clone = info.path;
    const source = checkoutSnapshot(repo.path);
    const sourceRefs = git(repo.path, ['for-each-ref', '--format=%(refname) %(objectname)']);

    const base = must(runItemB(clone));
    const record = must(ws.park(clone, { base, runId: RUN, itemId: 'B' }));
    assert.equal(record.ref, `refs/avarice/park/${RUN}/B`);
    assert.match(record.commit, /^[0-9a-f]{40}$/);
    assert.match(record.tree, /^[0-9a-f]{40}$/);
    assert.equal(record.baseHead, base.head);
    assert.deepEqual(record.paths, ['.planning/quick/q1/PLAN.md', 'src/a.ts', 'src/old.ts']);

    // The park commit: parent is the base HEAD, tree is the parked content, and the ref points at it.
    assert.equal(git(clone, ['rev-parse', record.ref]).trim(), record.commit);
    assert.equal(git(clone, ['rev-parse', `${record.commit}^`]).trim(), base.head);
    assert.equal(git(clone, ['rev-parse', `${record.commit}^{tree}`]).trim(), record.tree);

    // The tree is back to the base: nothing differs, the deleted file is back, the record is gone.
    assert.deepEqual(must(ws.status(clone)), []);
    assert.equal(read(clone, 'src/old.ts'), BASE_FILES['src/old.ts']);
    assert.equal(read(clone, 'src/a.ts'), BASE_FILES['src/a.ts']);
    assert.equal(existsSync(join(clone, '.planning', 'quick', 'q1')), false, 'the directories the record leaves empty go too');

    // Item C works on the clean tree and the supervisor commits it.
    write(clone, 'src/c.ts', 'export const c = 3;\n');
    const committed = must(ws.commit(clone, { paths: ['src/c.ts'], message: 'item C' }));
    assert.equal(must(ws.head(clone)), committed);
    const afterC = must(ws.snapshot(clone));

    const unparked = must(ws.unpark(clone, record));
    assert.deepEqual(unparked.applied, ['.planning/quick/q1/PLAN.md', 'src/a.ts', 'src/old.ts']);
    assert.equal(read(clone, 'src/a.ts'), 'export const a = 100;\n');
    assert.equal(read(clone, '.planning/quick/q1/PLAN.md'), '# the plan of B\n');
    assert.equal(existsSync(join(clone, 'src', 'old.ts')), false, 'a parked deletion is a deletion');
    assert.equal(read(clone, 'src/c.ts'), 'export const c = 3;\n', 'the commit of C is kept');
    assert.deepEqual(must(ws.changedSince(clone, afterC)), [
      { path: '.planning/quick/q1/PLAN.md', status: 'added' },
      { path: 'src/a.ts', status: 'modified' },
      { path: 'src/old.ts', status: 'deleted' },
    ]);
    assert.equal(must(ws.head(clone)), committed, 'unpark never moves HEAD');
    assert.equal(git(clone, ['rev-parse', record.ref]).trim(), record.commit, 'unpark keeps the ref; dropPark ends it');

    // The source repository saw none of it.
    assert.deepEqual(checkoutSnapshot(repo.path), source);
    assert.equal(git(repo.path, ['for-each-ref', '--format=%(refname) %(objectname)']), sourceRefs);
    assert.equal(gitRun(repo.path, ['for-each-ref', 'refs/avarice/']).stdout, '');
  });

  it('restores the file mode of a parked file and leaves the clone index alone', () => {
    const repo = scratch();
    const clone = prepared(repo).path;
    const base = must(ws.snapshot(clone));
    write(clone, 'tools/run.sh', '#!/bin/sh\necho ok\n');
    chmodSync(join(clone, 'tools', 'run.sh'), 0o755);
    const indexBefore = readFileSync(join(clone, '.git', 'index'));

    const record = must(ws.park(clone, { base, runId: RUN, itemId: 'B' }));
    assert.deepEqual(record.paths, ['tools/run.sh']);
    assert.equal(existsSync(join(clone, 'tools', 'run.sh')), false);
    must(ws.unpark(clone, record));
    assert.equal(statSync(join(clone, 'tools', 'run.sh')).mode & 0o777, 0o755);
    assert.equal(read(clone, 'tools/run.sh'), '#!/bin/sh\necho ok\n');
    assert.deepEqual(readFileSync(join(clone, '.git', 'index')), indexBefore, 'the clone index is byte-identical');
    assert.equal(existsSync(join(clone, '.git', 'index.lock')), false);
  });

  it('names none of the git verbs reset, clean or checkout in the park, unpark and dropPark code (CON-16, STATE 02-07)', () => {
    const source = readFileSync(new URL('../../src/adapters/git/run-workspace.ts', import.meta.url), 'utf8');
    const lines = source.split('\n');
    const methods: string[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const start = /^ {2}(?:private |protected )?(park\w*|unpark\w*|dropPark\w*)\(/.exec(lines[i] as string);
      if (start === null) continue;
      let end = i;
      while (end < lines.length && lines[end] !== '  }') end += 1;
      methods.push(`${start[1] as string}\n${lines.slice(i, end + 1).join('\n')}`);
    }
    const names = methods.map((m) => m.split('\n')[0] as string);
    for (const expected of ['park', 'unpark', 'dropPark']) assert.ok(names.includes(expected), `${expected} was found in the adapter source`);
    for (const method of methods) {
      assert.doesNotMatch(method, /\b(reset|clean|checkout)\b/i, `${method.split('\n')[0] as string} names no destructive git verb`);
    }
  });
});

// Everything a refused unpark must leave alone: the working files, the status and HEAD.
function workingState(clone: string): { digest: string; status: unknown; head: string } {
  return { digest: treeDigest(clone), status: must(ws.status(clone)), head: must(ws.head(clone)) };
}

describe('CloneRunWorkspace.unpark refuses rather than overwrites (T-03-15)', () => {
  it('names src/a.ts and changes nothing when item C committed a change to a path B parked', () => {
    const repo = scratch();
    const clone = prepared(repo).path;
    const base = must(runItemB(clone));
    const record = must(ws.park(clone, { base, runId: RUN, itemId: 'B' }));

    write(clone, 'src/a.ts', 'export const a = 2;\n');
    must(ws.commit(clone, { paths: ['src/a.ts'], message: 'item C changes a' }));
    const before = workingState(clone);
    const indexBefore = readFileSync(join(clone, '.git', 'index'));

    const error = mustFail(ws.unpark(clone, record));
    assert.equal(error.kind, 'conflict');
    assert.match(JSON.stringify(error), /src\/a\.ts/);
    assert.doesNotMatch(JSON.stringify(error), /PLAN\.md|old\.ts/, 'only the paths that changed are named');
    assert.deepEqual(workingState(clone), before, 'the working tree digest, status and HEAD are equal before and after the refused unpark');
    assert.deepEqual(readFileSync(join(clone, '.git', 'index')), indexBefore);
    assert.equal(existsSync(join(clone, '.planning', 'quick')), false, 'not even the paths that could have been applied were');
  });

  it('refuses a parked path that is modified in the working tree now, names it, and succeeds once it is put back', () => {
    const repo = scratch();
    const clone = prepared(repo).path;
    const base = must(runItemB(clone));
    const record = must(ws.park(clone, { base, runId: RUN, itemId: 'B' }));

    write(clone, 'src/a.ts', 'export const a = "someone else";\n');
    write(clone, '.planning/quick/q1/PLAN.md', '# a different plan\n');
    const before = workingState(clone);
    const error = mustFail(ws.unpark(clone, record));
    assert.equal(error.kind, 'conflict');
    assert.match(JSON.stringify(error), /src\/a\.ts/);
    assert.match(JSON.stringify(error), /PLAN\.md/);
    assert.deepEqual(workingState(clone), before);
    assert.equal(existsSync(join(clone, 'src', 'old.ts')), true, 'the deletion was not applied either');

    write(clone, 'src/a.ts', BASE_FILES['src/a.ts']);
    rmSync(join(clone, '.planning'), { recursive: true });
    assert.deepEqual(must(ws.unpark(clone, record)).applied, ['.planning/quick/q1/PLAN.md', 'src/a.ts', 'src/old.ts']);
    assert.equal(read(clone, 'src/a.ts'), 'export const a = 100;\n');
  });

  it('refuses when HEAD deleted a path that B parked a change to', () => {
    const repo = scratch();
    const clone = prepared(repo).path;
    const base = must(ws.snapshot(clone));
    write(clone, 'src/b.ts', 'export const b = 20;\n');
    rmSync(join(clone, 'src', 'old.ts'));
    const record = must(ws.park(clone, { base, runId: RUN, itemId: 'B' }));

    rmSync(join(clone, 'src', 'b.ts'));
    must(ws.commit(clone, { paths: ['src/b.ts'], message: 'item C deletes b' }));
    const before = workingState(clone);
    const error = mustFail(ws.unpark(clone, record));
    assert.equal(error.kind, 'conflict');
    assert.match(JSON.stringify(error), /src\/b\.ts/);
    assert.deepEqual(workingState(clone), before);
  });

  it('names a path literally: a path that looks like a glob is parked and restored as that one file', () => {
    const repo = scratch();
    const clone = prepared(repo).path;
    const base = must(ws.snapshot(clone));
    write(clone, 'src/*.ts', 'star\n');
    write(clone, 'src/[ab].ts', 'bracket\n');
    const record = must(ws.park(clone, { base, runId: RUN, itemId: 'B' }));
    assert.deepEqual(record.paths, ['src/*.ts', 'src/[ab].ts']);
    assert.equal(read(clone, 'src/a.ts'), BASE_FILES['src/a.ts']);
    assert.deepEqual(must(ws.unpark(clone, record)).applied, ['src/*.ts', 'src/[ab].ts']);
    assert.equal(read(clone, 'src/*.ts'), 'star\n');
    assert.equal(read(clone, 'src/[ab].ts'), 'bracket\n');
    assert.equal(read(clone, 'src/a.ts'), BASE_FILES['src/a.ts'], 'a path that the glob would match is untouched');
  });
});

describe('CloneRunWorkspace.park survives gc, repeats and is dropped by its ref only', () => {
  it('keeps the delta reachable through the ref: unpark succeeds after gc --prune=now, and dropPark ends it', () => {
    const repo = scratch();
    const clone = prepared(repo).path;
    const base = must(runItemB(clone));
    const record = must(ws.park(clone, { base, runId: RUN, itemId: 'B' }));
    const other = must(ws.park(clone, { base: must(ws.snapshot(clone)), runId: RUN, itemId: 'Z' }));
    assert.deepEqual(other.paths, [], 'an item with no changes parks an empty delta');

    git(clone, ['gc', '--prune=now', '--quiet']);
    git(clone, ['cat-file', '-e', record.commit]);
    write(clone, 'src/c.ts', 'export const c = 3;\n');
    must(ws.commit(clone, { paths: ['src/c.ts'], message: 'item C' }));
    assert.deepEqual(must(ws.unpark(clone, record)).applied, ['.planning/quick/q1/PLAN.md', 'src/a.ts', 'src/old.ts']);
    assert.equal(read(clone, 'src/a.ts'), 'export const a = 100;\n');

    must(ws.dropPark(clone, record.ref));
    assert.deepEqual(git(clone, ['for-each-ref', '--format=%(refname)', 'refs/avarice/']).split('\n').filter((l) => l.length > 0), [other.ref], 'only that ref went');
    assert.equal(mustFail(ws.unpark(clone, record)).kind, 'not_found');
    must(ws.dropPark(clone, record.ref)); // already gone: success
    assert.equal(mustFail(ws.dropPark(clone, 'refs/heads/main')).kind, 'invalid');
    assert.equal(git(clone, ['rev-parse', '--verify', `refs/heads/avarice/${RUN}`]).trim().length, 40, 'the run branch is untouched');

    git(clone, ['gc', '--prune=now', '--quiet']);
    assert.notEqual(gitRun(clone, ['cat-file', '-e', record.commit]).status, 0, 'without its ref the delta is collectable');
  });

  it('a second unpark changes nothing and returns the same applied list, also after the item committed its own paths', () => {
    const repo = scratch();
    const clone = prepared(repo).path;
    const base = must(runItemB(clone));
    const record = must(ws.park(clone, { base, runId: RUN, itemId: 'B' }));
    write(clone, 'src/c.ts', 'export const c = 3;\n');
    must(ws.commit(clone, { paths: ['src/c.ts'], message: 'item C' }));

    const first = must(ws.unpark(clone, record));
    const after = workingState(clone);
    const second = must(ws.unpark(clone, record));
    assert.deepEqual(second, first);
    assert.deepEqual(workingState(clone), after);

    must(ws.commit(clone, { paths: record.paths, message: 'item B' }));
    const committed = workingState(clone);
    assert.deepEqual(must(ws.unpark(clone, record)), first, 'what is already committed is already applied');
    assert.deepEqual(workingState(clone), committed);
  });

  it('parks the same content again for the same item as the same commit, and refuses a different delta under that ref', () => {
    const repo = scratch();
    const clone = prepared(repo).path;
    const base = must(runItemB(clone));
    const record = must(ws.park(clone, { base, runId: RUN, itemId: 'B' }));
    must(ws.unpark(clone, record));

    const again = must(ws.park(clone, { base, runId: RUN, itemId: 'B' }));
    assert.deepEqual(again, record, 'the interrupted park is finished, not repeated');
    assert.deepEqual(must(ws.status(clone)), []);

    must(ws.unpark(clone, again));
    write(clone, 'src/a.ts', 'export const a = 101;\n');
    const before = workingState(clone);
    assert.equal(mustFail(ws.park(clone, { base, runId: RUN, itemId: 'B' })).kind, 'conflict');
    assert.deepEqual(workingState(clone), before, 'a refused park changes nothing');
    assert.equal(git(clone, ['rev-parse', record.ref]).trim(), record.commit, 'the earlier delta is still there');
  });

  it('refuses a park when HEAD is not the base HEAD, creating no ref and changing nothing', () => {
    const repo = scratch();
    const clone = prepared(repo).path;
    const base = must(ws.snapshot(clone));
    write(clone, 'src/c.ts', 'export const c = 3;\n');
    must(ws.commit(clone, { paths: ['src/c.ts'], message: 'item C' }));
    write(clone, 'src/a.ts', 'export const a = 100;\n');
    const before = workingState(clone);
    assert.equal(mustFail(ws.park(clone, { base, runId: RUN, itemId: 'B' })).kind, 'conflict');
    assert.deepEqual(workingState(clone), before);
    assert.equal(git(clone, ['for-each-ref', 'refs/avarice/']), '');
  });
});

describe('CloneRunWorkspace.park and unpark refuse hostile names, paths and records (T-03-15)', () => {
  it('refuses an item ID or run ID that is not a plain name as invalid, before any ref or change', () => {
    const repo = scratch();
    const clone = prepared(repo).path;
    const base = must(runItemB(clone));
    const before = workingState(clone);
    for (const itemId of ['../x', '', 'a/b', '-x', 'a.b', 'a b', 'x'.repeat(65), 'a\nb', '\0']) {
      assert.equal(mustFail(ws.park(clone, { base, runId: RUN, itemId })).kind, 'invalid', JSON.stringify(itemId));
    }
    for (const runId of ['a b', '', '..', 'a/b', '-r', 'run:1']) {
      assert.equal(mustFail(ws.park(clone, { base, runId, itemId: 'B' })).kind, 'invalid', JSON.stringify(runId));
    }
    assert.deepEqual(workingState(clone), before);
    assert.equal(git(clone, ['for-each-ref', 'refs/avarice/']), '');
  });

  it('restores a parked symlink as the link itself, and the file it points at outside the clone is never read or written', () => {
    const repo = scratch();
    const clone = prepared(repo).path;
    const outside = tempDir('avarice-park-outside-');
    write(outside, 'precious.txt', 'secret\n');
    const base = must(ws.snapshot(clone));
    const target = join(outside, 'precious.txt');
    symlinkSync(target, join(clone, 'link-out'));
    const record = must(ws.park(clone, { base, runId: RUN, itemId: 'B' }));
    assert.deepEqual(record.paths, ['link-out']);
    assert.equal(isLink(join(clone, 'link-out')), false, 'the link left the tree');

    assert.deepEqual(must(ws.unpark(clone, record)).applied, ['link-out']);
    assert.equal(lstatSync(join(clone, 'link-out')).isSymbolicLink(), true);
    assert.equal(readlinkSync(join(clone, 'link-out')), target);
    assert.equal(readFileSync(target, 'utf8'), 'secret\n');
    assert.deepEqual(must(ws.status(clone)), [{ path: 'link-out', status: 'added' }]);
  });

  it('refuses to write through a directory that is a link to somewhere outside the clone: denied, and the outside directory is untouched', () => {
    const repo = scratch();
    const clone = prepared(repo).path;
    const outside = tempDir('avarice-park-outside-');
    write(outside, 'keep.txt', 'kept\n');
    const base = must(ws.snapshot(clone));
    write(clone, 'docs/x.md', '# parked\n');
    const record = must(ws.park(clone, { base, runId: RUN, itemId: 'B' }));
    assert.equal(existsSync(join(clone, 'docs')), false);

    symlinkSync(outside, join(clone, 'docs'));
    const outsideBefore = treeDigest(outside);
    const before = workingState(clone);
    assert.equal(mustFail(ws.unpark(clone, record)).kind, 'denied');
    assert.equal(treeDigest(outside), outsideBefore);
    assert.equal(existsSync(join(outside, 'x.md')), false);
    assert.equal(lstatSync(join(clone, 'docs')).isSymbolicLink(), true);
    assert.deepEqual(workingState(clone), before);
  });

  it('refuses a record whose ref is not a park ref, whose ids are not SHAs, whose paths climb out or name .git, or that no longer matches its ref', () => {
    const repo = scratch();
    const clone = prepared(repo).path;
    const base = must(runItemB(clone));
    const record = must(ws.park(clone, { base, runId: RUN, itemId: 'B' }));
    const before = workingState(clone);
    const variants: Array<[string, ParkRecord]> = [
      ['a branch ref', { ...record, ref: `refs/heads/avarice/${RUN}` }],
      ['a ref with a dot segment', { ...record, ref: `refs/avarice/park/${RUN}/../B` }],
      ['a commit that is not a SHA', { ...record, commit: 'HEAD' }],
      ['a tree that is not a SHA', { ...record, tree: 'x'.repeat(40) }],
      ['a path that climbs out', { ...record, paths: ['../escape'] }],
      ['a path in the git directory', { ...record, paths: ['.git/config'] }],
      ['an absolute path', { ...record, paths: ['/etc/passwd'] }],
      ['a path that is not in normal form', { ...record, paths: ['src//a.ts'] }],
    ];
    for (const [name, bad] of variants) assert.equal(mustFail(ws.unpark(clone, bad)).kind, 'invalid', name);
    assert.equal(mustFail(ws.unpark(clone, { ...record, commit: base.head })).kind, 'conflict', 'a record that names another commit than its ref holds');
    assert.equal(mustFail(ws.unpark(clone, { ...record, tree: base.tree })).kind, 'conflict', 'a record whose tree is not the commit tree');
    assert.equal(mustFail(ws.unpark(clone, { ...record, ref: `refs/avarice/park/${RUN}/NOPE` })).kind, 'not_found');
    assert.deepEqual(workingState(clone), before);
  });
});
