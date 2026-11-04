// Plan 01-22 (gap P-2, review CR-03): the staging diff behind validation's scope-of-writes check and the
// activation scope check must see untracked files the hostile repository's own committed `.gitignore` hides.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { checkoutSnapshot, git, makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';
import type { FakeHostOptions } from '../helpers/fake-agent-host.ts';

const TEST_CLI = join(REPO_ROOT, 'test', 'helpers', 'test-cli.ts');
const LIB_FILES = Array.from({ length: 20 }, (_, i) => `lib/f${String(i).padStart(2, '0')}.ts`);
const REPO_FILES: Record<string, string> = {
  'README.md': '# scratch\n',
  'package.json': '{"name":"scratch"}\n',
  ...Object.fromEntries(LIB_FILES.map((f) => [f, `export const x = '${f}';\n`])),
};

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

// A repository whose committed `.gitignore` is `*`: every file written later is ignored by git, so a plain
// `git status` would not list it. `pin` is the commit that carries the `.gitignore` (repo.head predates it).
function hostileIgnoreRepo(): { repo: ScratchRepo; pin: string } {
  const repo = makeScratchRepo({ files: REPO_FILES });
  cleanup.push(repo.base);
  writeIgnoreAll(repo);
  const pin = git(repo.path, ['rev-parse', 'HEAD']).trim();
  return { repo, pin };
}

function writeIgnoreAll(repo: ScratchRepo): void {
  writeFileSync(join(repo.path, '.gitignore'), '*\n');
  git(repo.path, ['add', '-f', '.gitignore']);
  git(repo.path, ['-c', 'user.name=Scratch', '-c', 'user.email=scratch@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'hostile ignore']);
}

function fixture(): { roots: CliRoots; repo: ScratchRepo } {
  const roots = makeRoots();
  cleanup.push(roots.base);
  const { repo } = hostileIgnoreRepo();
  return { roots, repo };
}

function onboard(roots: CliRoots, repo: ScratchRepo, host: FakeHostOptions = {}) {
  return runCli(['onboard', '--policy', 'onboarding', repo.path], { roots, entry: TEST_CLI, env: { AVARICE_FAKE_HOST: JSON.stringify(host) } });
}

function rows<T>(roots: CliRoots, sql: string, ...params: Array<string | number>): T[] {
  const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
  try {
    return (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    db.close();
  }
}

interface ValidateStep {
  attempt: number;
  status: string;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
}

function finalState(roots: CliRoots): { state: string; reason: string | null } {
  const [row] = rows<{ state: string; reason: string | null }>(
    roots,
    `SELECT o.state AS state, (SELECT json_extract(e.data_json, '$.reason') FROM events e WHERE e.type = 'onboarding.transition' AND json_extract(e.data_json, '$.to') = o.state ORDER BY e.seq DESC LIMIT 1) AS reason FROM onboardings o`,
  );
  assert.ok(row);
  return row;
}

function validateSteps(roots: CliRoots): ValidateStep[] {
  return rows<{ attempt: number; status: string; result_json: string }>(roots, "SELECT attempt, status, result_json FROM onboarding_steps WHERE step = 'validate' ORDER BY attempt").map((r) => ({
    attempt: r.attempt,
    status: r.status,
    checks: (JSON.parse(r.result_json) as { checks: ValidateStep['checks'] }).checks,
  }));
}

const failedNames = (step: ValidateStep | undefined): string[] => (step?.checks ?? []).filter((c) => !c.passed).map((c) => c.name);

function eventsOfType(roots: CliRoots, type: string): Array<Record<string, unknown>> {
  return rows<{ data_json: string }>(roots, 'SELECT data_json FROM events WHERE type = ? ORDER BY seq', type).map((r) => JSON.parse(r.data_json) as Record<string, unknown>);
}

describe('validation under a hostile .gitignore of `*`', () => {
  it('fails an out-of-set write the repository ignores, remaps once, blocks with a decision and names the path', () => {
    const { roots, repo } = fixture();
    const pristine = checkoutSnapshot(repo.path);
    const r = onboard(roots, repo, { extraWrites: { 'evil.txt': 'payload\n' } });
    assert.equal(r.code, 3, r.stdout + r.stderr);
    assert.deepEqual(finalState(roots), { state: 'blocked', reason: 'decision' });

    const steps = validateSteps(roots);
    assert.equal(steps.length, 2, 'one remap within the retry budget');
    for (const s of steps) {
      assert.equal(s.status, 'rejected');
      assert.deepEqual(failedNames(s), ['scope-of-writes']);
      assert.match(s.checks.find((c) => c.name === 'scope-of-writes')?.detail ?? '', /evil\.txt/);
    }

    const findings = eventsOfType(roots, 'containment.finding');
    assert.equal(findings[0]?.['check'], 'scope-of-writes');
    assert.deepEqual(findings[0]?.['paths'], ['evil.txt']);

    assert.equal(rows(roots, 'SELECT 1 FROM project_records').length, 0);
    assert.deepEqual(checkoutSnapshot(repo.path), pristine, 'the user checkout is untouched');
  });
});
