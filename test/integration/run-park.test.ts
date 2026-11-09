// Park and unpark of a paused work item's delta (plan 03-09; AUT-3, research Pitfall 1; T-03-15). Every repository is a scratch repository
// under os.tmpdir(); nothing here runs git against the AVARICE checkout or the owner's repositories.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { CloneRunWorkspace } from '../../src/adapters/git/run-workspace.ts';
import type { Result } from '../../src/domain/result.ts';
import type { RunWorkspaceInfo } from '../../src/ports/run-workspace.ts';
import { checkoutSnapshot, git, gitRun, makeScratchRepo } from '../helpers/scratch-repo.ts';
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
