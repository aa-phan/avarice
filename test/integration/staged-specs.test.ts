// Staged GSD specs (plan 04-34, owner ruling (a) after the second D-04 stop): the restricted host reads only inside the working directory, so AVARICE copies the
// GSD specs the fast map needs into `.claude/gsd-core/` of the staging copy, read-only, and takes them out again when the invocation is settled. The adapter, on both
// staging strategies, with a stand-in gsd-core directory and scratch repositories under os.tmpdir().
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { CloneStagingWorkspace } from '../../src/adapters/git/staging-clone.ts';
import { WorktreeStagingWorkspace } from '../../src/adapters/git/staging-worktree.ts';
import { RESTRICTED_SPEC_DIR, RESTRICTED_SPEC_SEEDS } from '../../src/domain/restricted-specs.ts';
import type { Result } from '../../src/domain/result.ts';
import type { StagingWorkspace } from '../../src/ports/staging-workspace.ts';
import { checkoutSnapshot, makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) (cleanups.pop() as () => void)();
});

function must<T>(result: Result<T>): T {
  assert.ok(result.ok, result.ok ? '' : `expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

function mustFail<T>(result: Result<T>): { kind: string } {
  assert.equal(result.ok, false, 'expected an error result');
  return (result as { ok: false; error: { kind: string } }).error;
}

const SPECS: Record<string, string> = {
  'workflows/map-codebase.md': '@~/.claude/gsd-core/references/lang.md\nmap {focus}\n',
  'workflows/scan.md': 'scan, then @gsd-core/references/dispatch.md\n',
  'references/agent-skills-bootstrap.md': 'bootstrap\n',
  'references/lang.md': 'language\n',
  'references/dispatch.md': 'dispatch\n',
  'references/unrelated.md': 'never named by a seed\n',
  'bin/gsd-tools.cjs': '// not a spec\n',
};

// A stand-in gsd-core directory with the seeds and what they name.
function gsdCoreDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-specs-src-')));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(SPECS)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

const ONB = 'onb_01TESTSPECS0000000000000A';
const STRATEGIES: ReadonlyArray<readonly [string, () => StagingWorkspace]> = [
  ['clone', () => new CloneStagingWorkspace()],
  ['worktree', () => new WorktreeStagingWorkspace()],
];

function staged(workspace: StagingWorkspace, files?: Record<string, string>): { repo: ScratchRepo; path: string; pin: string } {
  const repo = makeScratchRepo({ files: files ?? { 'README.md': '# scratch\n', 'src/a.ts': 'export const a = 1;\n' } });
  const workRoot = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-specs-work-')));
  cleanups.push(repo.dispose, () => rmSync(workRoot, { recursive: true, force: true }));
  const info = must(workspace.prepare({ repoPath: repo.path, workRoot, onboardingId: ONB, pin: repo.head }));
  return { repo, path: info.path, pin: repo.head };
}

const walk = (root: string, rel = ''): string[] =>
  readdirSync(join(root, rel), { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(root, join(rel, entry.name)) : [join(rel, entry.name)]));

for (const [name, make] of STRATEGIES) {
  describe(`staged GSD specs on the ${name} staging copy`, () => {
    it('copies the closure of the seeds, and only it, under .claude/gsd-core with every file read-only and byte-identical to the source', () => {
      const workspace = make();
      const src = gsdCoreDir();
      const s = staged(workspace);
      const outcome = must(workspace.stageGsdSpecs(s.path, { gsdCoreDir: src, seeds: RESTRICTED_SPEC_SEEDS }));
      assert.equal(outcome.root, RESTRICTED_SPEC_DIR);
      assert.deepEqual(outcome.files, ['references/agent-skills-bootstrap.md', 'references/dispatch.md', 'references/lang.md', 'workflows/map-codebase.md', 'workflows/scan.md']);
      const target = join(s.path, RESTRICTED_SPEC_DIR);
      for (const rel of outcome.files) {
        assert.equal(readFileSync(join(target, rel), 'utf8'), SPECS[rel], rel);
        assert.equal(lstatSync(join(target, rel)).mode & 0o777, 0o444, `${rel} is read-only`);
      }
      assert.ok(!existsSync(join(target, 'references/unrelated.md')), 'a file no seed names is not staged');
      assert.ok(!existsSync(join(target, 'bin')), 'nothing outside workflows, references and templates is staged');
      assert.throws(() => writeFileSync(join(target, 'workflows/scan.md'), 'changed'), /EACCES|EPERM/, 'a staged file cannot be written');
    });

    it('shows the staged files as additions until they are removed, then leaves the staging copy as it was, with no .claude directory', () => {
      const workspace = make();
      const s = staged(workspace);
      const before = must(workspace.changes(s.path, s.pin));
      must(workspace.stageGsdSpecs(s.path, { gsdCoreDir: gsdCoreDir(), seeds: RESTRICTED_SPEC_SEEDS }));
      assert.ok(must(workspace.changes(s.path, s.pin)).added.some((p) => p.startsWith(`${RESTRICTED_SPEC_DIR}/`)), 'the scope checks would see a leftover');
      must(workspace.unstageGsdSpecs(s.path));
      assert.deepEqual(must(workspace.changes(s.path, s.pin)), before);
      assert.ok(!existsSync(join(s.path, '.claude')), 'the directory AVARICE made is gone');
    });

    it('stages again over its own leftover (a resume after a kill) and removes it once', () => {
      const workspace = make();
      const src = gsdCoreDir();
      const s = staged(workspace);
      must(workspace.stageGsdSpecs(s.path, { gsdCoreDir: src, seeds: RESTRICTED_SPEC_SEEDS }));
      must(workspace.stageGsdSpecs(s.path, { gsdCoreDir: src, seeds: RESTRICTED_SPEC_SEEDS }));
      must(workspace.unstageGsdSpecs(s.path));
      must(workspace.unstageGsdSpecs(s.path));
      assert.ok(!existsSync(join(s.path, '.claude')));
    });

    it('leaves a .claude directory the repository itself holds, with its files, and refuses a .claude/gsd-core the repository holds', () => {
      const workspace = make();
      const own = staged(workspace, { 'README.md': '# scratch\n', '.claude/settings.json': '{}\n' });
      must(workspace.stageGsdSpecs(own.path, { gsdCoreDir: gsdCoreDir(), seeds: RESTRICTED_SPEC_SEEDS }));
      must(workspace.unstageGsdSpecs(own.path));
      assert.deepEqual(walk(join(own.path, '.claude')), ['settings.json'], 'only the staged directory was taken out');

      const tracked = staged(workspace, { 'README.md': '# scratch\n', '.claude/gsd-core/workflows/scan.md': 'the repository own spec\n' });
      const failure = mustFail(workspace.stageGsdSpecs(tracked.path, { gsdCoreDir: gsdCoreDir(), seeds: RESTRICTED_SPEC_SEEDS }));
      assert.equal(failure.kind, 'conflict');
      assert.equal(readFileSync(join(tracked.path, '.claude/gsd-core/workflows/scan.md'), 'utf8'), 'the repository own spec\n', 'the repository file is untouched');
      must(workspace.unstageGsdSpecs(tracked.path));
      assert.equal(readFileSync(join(tracked.path, '.claude/gsd-core/workflows/scan.md'), 'utf8'), 'the repository own spec\n', 'and untouched by the removal');
    });

    it('writes through no symbolic link: a .claude that links elsewhere is refused and nothing lands outside staging', () => {
      const workspace = make();
      const s = staged(workspace);
      const outside = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-specs-out-')));
      cleanups.push(() => rmSync(outside, { recursive: true, force: true }));
      symlinkSync(outside, join(s.path, '.claude'));
      const failure = mustFail(workspace.stageGsdSpecs(s.path, { gsdCoreDir: gsdCoreDir(), seeds: RESTRICTED_SPEC_SEEDS }));
      assert.equal(failure.kind, 'denied');
      assert.deepEqual(readdirSync(outside), [], 'nothing was written through the link');
      mustFail(workspace.unstageGsdSpecs(s.path));
      assert.ok(lstatSync(join(s.path, '.claude')).isSymbolicLink(), 'the link is not followed or removed');
    });

    it('stages nothing when a seed is missing from the gsd-core directory', () => {
      const workspace = make();
      const src = gsdCoreDir();
      rmSync(join(src, 'workflows/scan.md'));
      const s = staged(workspace);
      assert.equal(mustFail(workspace.stageGsdSpecs(s.path, { gsdCoreDir: src, seeds: RESTRICTED_SPEC_SEEDS })).kind, 'not_found');
      assert.ok(!existsSync(join(s.path, '.claude')), 'no partial copy');
    });

    it('refuses a gsd-core directory that is not an absolute path', () => {
      const workspace = make();
      const s = staged(workspace);
      assert.equal(mustFail(workspace.stageGsdSpecs(s.path, { gsdCoreDir: 'gsd-core', seeds: RESTRICTED_SPEC_SEEDS })).kind, 'invalid');
      assert.ok(!existsSync(join(s.path, '.claude')));
    });

    it('leaves the user repository byte-identical', () => {
      const workspace = make();
      const s = staged(workspace);
      const before = checkoutSnapshot(s.repo.path);
      must(workspace.stageGsdSpecs(s.path, { gsdCoreDir: gsdCoreDir(), seeds: RESTRICTED_SPEC_SEEDS }));
      must(workspace.unstageGsdSpecs(s.path));
      assert.deepEqual(checkoutSnapshot(s.repo.path), before);
    });
  });
}
