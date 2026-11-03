// Deferred item 9 (plan 01-19 gap fix): a full map is stamped by AVARICE, also when a killed map invocation is
// reconciled on resume. The mapper's own `stamp-codebase-map` call is denied by the hook, so the files it wrote are
// unstamped; without the AVARICE stamp the reconciled map fails validation `stamp` and a second map is launched.
// Fake host and temp roots only; no model is called.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { makeScratchRepo, git } from '../helpers/scratch-repo.ts';
import { runCli } from '../helpers/run-cli.ts';
import { EXPIRY_WAIT_MS, REPO_FILES, TEST_CLI, freshProfile, onboardArgs, onboardingIdOf, resumeCli, rows, sleepSync } from '../helpers/fault-run.ts';
import { ALL_MAP_FILES } from '../helpers/fake-agent-host.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

describe('resume reconciles a killed full map and stamps it', () => {
  it('stamps the seven files itself and validates without launching a second map', () => {
    const repo = makeScratchRepo({ files: REPO_FILES });
    const roots = freshProfile();
    cleanup.push(repo.base, roots.base);
    // The host writes all seven documents, unstamped, and dies before it can report: the previous holder is gone.
    const killed = runCli(onboardArgs(repo), {
      roots,
      entry: TEST_CLI,
      env: { AVARICE_FAKE_HOST: JSON.stringify({ stamp: false, killAfterFiles: ALL_MAP_FILES.length }), AVARICE_LEASE_TTL_MS: '200' },
    });
    assert.equal(killed.signal, 'SIGKILL', killed.stdout + killed.stderr);
    const id = onboardingIdOf(roots);
    assert.deepEqual(
      rows<{ status: string }>(roots, "SELECT status FROM onboarding_steps WHERE step = 'launch:map'"),
      [{ status: 'started' }],
      'the killed invocation is a started launch',
    );

    sleepSync(EXPIRY_WAIT_MS);
    const resumed = resumeCli(roots, id, { stamp: false });
    assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
    assert.match(resumed.stdout, new RegExp(`onboarding ${id}: active`));

    assert.deepEqual(
      rows<{ attempt: number; status: string }>(roots, "SELECT attempt, status FROM onboarding_steps WHERE step = 'launch:map' ORDER BY attempt"),
      [{ attempt: 1, status: 'reconciled' }],
      'the map was reconciled and validated, not launched again',
    );
    const stamps = rows<{ status: string; result_json: string }>(roots, "SELECT status, result_json FROM onboarding_steps WHERE step = 'gsd:stamp'");
    assert.equal(stamps.length, 1);
    assert.equal(stamps[0]?.status, 'completed');
    assert.deepEqual([...(JSON.parse(stamps[0]?.result_json ?? '{}') as { stamped: string[] }).stamped].sort(), [...ALL_MAP_FILES].sort());

    const [onboarding] = rows<{ staging_worktree: string }>(roots, 'SELECT staging_worktree FROM onboardings');
    const staging = onboarding?.staging_worktree as string;
    const head = git(staging, ['rev-parse', 'HEAD']).trim();
    for (const name of ALL_MAP_FILES) {
      assert.match(readFileSync(join(staging, '.planning', 'codebase', name), 'utf8'), new RegExp(`^---\\nlast_mapped_commit: ${head}\\n`), `${name} is stamped`);
    }
  });
});
