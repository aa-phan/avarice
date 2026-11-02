// Plan 01-10: the coverage label of an activated record follows the mapping mode and never overstates
// (ONB-7, S-33): a fast map is `partial` with the four files as scope, a full map is `complete`, a skipped
// map is `none`. `status` prints exactly what the record says.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo, ScratchRepoOptions } from '../helpers/scratch-repo.ts';
import type { FakeHostOptions } from '../helpers/fake-agent-host.ts';

const TEST_CLI = join(REPO_ROOT, 'test', 'helpers', 'test-cli.ts');
const REPO_FILES = {
  'README.md': '# scratch\n',
  'package.json': '{"name":"scratch"}\n',
  'src/index.ts': 'export const answer = 42;\n',
};
const FAST_FILES = ['STACK.md', 'INTEGRATIONS.md', 'ARCHITECTURE.md', 'STRUCTURE.md'];
const FAST_PATHS = FAST_FILES.map((f) => `.planning/codebase/${f}`);

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function fixture(options: ScratchRepoOptions = { files: REPO_FILES }): { roots: CliRoots; repo: ScratchRepo } {
  const roots = makeRoots();
  const repo = makeScratchRepo(options);
  cleanup.push(roots.base, repo.base);
  return { roots, repo };
}

function onboard(roots: CliRoots, repo: ScratchRepo, host: FakeHostOptions, extra: readonly string[] = []) {
  return runCli(['onboard', '--policy', 'onboarding', ...extra, repo.path], { roots, entry: TEST_CLI, env: { AVARICE_FAKE_HOST: JSON.stringify(host) } });
}

function rows<T>(roots: CliRoots, sql: string): T[] {
  const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
  try {
    return (db.prepare(sql).all() as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    db.close();
  }
}

interface RecordBody {
  mapping: { mode: string; scope: string[]; completeness: string };
}

function recordOf(roots: CliRoots): RecordBody {
  const [row] = rows<{ body_json: string }>(roots, 'SELECT body_json FROM project_records');
  assert.ok(row, 'a project record exists');
  return JSON.parse(row.body_json) as RecordBody;
}

describe('completeness labels (ONB-7, S-33)', () => {
  it('activates a fast map as partial, mode fast, with the four files as scope; status prints partial and never complete', () => {
    const { roots, repo } = fixture();
    const r = onboard(roots, repo, { files: FAST_FILES, stamp: false }, ['--mode', 'fast']);
    assert.equal(r.code, 0, r.stdout + r.stderr);

    const mapping = recordOf(roots).mapping;
    assert.equal(mapping.mode, 'fast');
    assert.equal(mapping.completeness, 'partial');
    assert.deepEqual(mapping.scope, FAST_PATHS);

    const json = JSON.parse(runCli(['status', '--json'], { roots }).stdout) as Array<{ mapping: { mode: string; completeness: string } }>;
    assert.equal(json[0]?.mapping.completeness, 'partial');
    assert.equal(json[0]?.mapping.mode, 'fast');
    const text = runCli(['status'], { roots }).stdout;
    assert.match(text, /mapping fast \(partial,/);
    assert.doesNotMatch(text, /complete/);
  });

  it('activates a full map as complete with the whole repository as scope', () => {
    const { roots, repo } = fixture();
    const r = onboard(roots, repo, {});
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const mapping = recordOf(roots).mapping;
    assert.equal(mapping.mode, 'full');
    assert.equal(mapping.completeness, 'complete');
    assert.deepEqual(mapping.scope, ['.']);
    const json = JSON.parse(runCli(['status', '--json'], { roots }).stdout) as Array<{ mapping: { completeness: string } }>;
    assert.equal(json[0]?.mapping.completeness, 'complete');
  });

  it('activates a skipped map as none with no scope, never as complete', () => {
    const { roots, repo } = fixture({ files: { 'README.md': '# only a readme\n' } });
    const r = onboard(roots, repo, {});
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const mapping = recordOf(roots).mapping;
    assert.equal(mapping.mode, 'skip');
    assert.equal(mapping.completeness, 'none');
    assert.deepEqual(mapping.scope, []);
  });

  it('stores every check of the accepted attempt as step validate, in order', () => {
    const { roots, repo } = fixture();
    assert.equal(onboard(roots, repo, {}).code, 0);
    const [step] = rows<{ attempt: number; status: string; result_json: string }>(roots, "SELECT attempt, status, result_json FROM onboarding_steps WHERE step = 'validate'");
    assert.equal(step?.status, 'accepted');
    const result = JSON.parse(step?.result_json ?? '{}') as { checks: Array<{ name: string; passed: boolean }>; completeness: string; scope: string[] };
    assert.deepEqual(
      result.checks.map((c) => c.name),
      ['presence', 'stamp', 'scope-of-writes', 'path-references', 'secrets', 'size-and-structure', 'coverage'],
    );
    assert.ok(result.checks.every((c) => c.passed));
    assert.equal(result.completeness, 'complete');
    assert.deepEqual(result.scope, ['.']);
  });
});
