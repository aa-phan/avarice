// Plan 04-21 (ONB-6, ONB-5, D-15, FR-12, FR-15, S-28): promotion of the accepted map into the user's repository. `--promote none` is the default and
// writes nothing; `copy` writes the accepted map files into an absent or byte-identical `.planning/codebase`; `commit` creates one create-only branch.
// Both are privileged actions that pass the approval gate with the onboarding contract as their source. Scratch repositories, temp profiles and the
// fake host; no test calls a model.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { ALL_MAP_FILES } from '../helpers/fake-agent-host.ts';
import { REPO_FILES, TEST_CLI, rows } from '../helpers/fault-run.ts';
import { makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import { checkoutSnapshot, makeScratchRepo, treeDigest } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) (cleanups.pop() as () => void)();
});

function fixture(files: Readonly<Record<string, string>> = REPO_FILES): { roots: CliRoots; repo: ScratchRepo } {
  const repo = makeScratchRepo({ files });
  const roots = makeRoots();
  cleanups.push(repo.dispose, () => rmSync(roots.base, { recursive: true, force: true }));
  return { roots, repo };
}

// `avarice onboard` through the test entry (production main() with the fake host).
function onboard(roots: CliRoots, repo: ScratchRepo, ...flags: string[]): CliResult {
  return runCli(['onboard', '--policy', 'onboarding', ...flags, repo.path], { roots, entry: TEST_CLI, env: { AVARICE_FAKE_HOST: '{}' } });
}

interface EventDb {
  seq: number;
  type: string;
  run_id: string | null;
  data_json: string;
}
const eventsOf = (roots: CliRoots, ...types: string[]): EventDb[] =>
  rows<EventDb>(roots, `SELECT seq, type, run_id, data_json FROM events WHERE type IN (${types.map(() => '?').join(', ')}) ORDER BY seq`, ...types);
const dataOf = (event: EventDb): Record<string, unknown> => JSON.parse(event.data_json) as Record<string, unknown>;
const approvalCount = (roots: CliRoots): number => rows<{ n: number }>(roots, 'SELECT COUNT(*) AS n FROM approvals')[0]?.n ?? -1;
const onboardingId = (roots: CliRoots): string => (rows<{ onboarding_id: string }>(roots, 'SELECT onboarding_id FROM onboardings')[0] as { onboarding_id: string }).onboarding_id;

const MAP_DIR = '.planning/codebase';
const mapFilesIn = (repo: ScratchRepo): string[] => (existsSync(join(repo.path, MAP_DIR)) ? readdirSync(join(repo.path, MAP_DIR)).sort() : []);

describe('tracer: `onboard --promote copy` copies the accepted map into an empty .planning/codebase through the approval gate (ONB-6, D-15)', () => {
  it('writes the accepted map files, uncommitted, under action.started and action.finished with source contract and no approvals row', () => {
    const { roots, repo } = fixture();
    const before = checkoutSnapshot(repo.path);

    const result = onboard(roots, repo, '--promote', 'copy');
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /: active/);

    assert.deepEqual(mapFilesIn(repo), [...ALL_MAP_FILES].sort(), 'the seven accepted map files are in the checkout');
    const [onboarding] = rows<{ staging_worktree: string }>(roots, 'SELECT staging_worktree FROM onboardings');
    for (const name of ALL_MAP_FILES) {
      const accepted = readFileSync(join(onboarding?.staging_worktree as string, MAP_DIR, name));
      assert.ok(readFileSync(join(repo.path, MAP_DIR, name)).equals(accepted), `${name} carries the accepted bytes`);
    }

    // Nothing was committed or staged: the files are untracked, HEAD and the branch are where they were.
    const after = checkoutSnapshot(repo.path);
    assert.equal(after.head, before.head);
    assert.equal(after.branch, before.branch);
    assert.match(execFileSync('git', ['status', '--porcelain'], { cwd: repo.path, encoding: 'utf8' }), /^\?\? \.planning\/$/m);
    assert.equal(execFileSync('git', ['ls-files', '.planning'], { cwd: repo.path, encoding: 'utf8' }), '', 'no file of the map is tracked');

    const id = onboardingId(roots);
    const [started] = eventsOf(roots, 'action.started');
    const [finished] = eventsOf(roots, 'action.finished');
    assert.ok(started !== undefined && finished !== undefined, 'a start and an end were recorded');
    assert.equal(dataOf(started).action, 'onboarding.promote.copy');
    assert.equal(dataOf(started).scope, id);
    assert.equal(dataOf(started).source, 'contract');
    assert.equal(dataOf(finished).action, 'onboarding.promote.copy');
    assert.equal(dataOf(finished).status, 'succeeded');
    assert.equal(approvalCount(roots), 0, 'a contract is the source: no approvals row');
  });

  it('refuses a promotion value that does not exist, naming none, copy and commit, with exit 64 and nothing written', () => {
    const { roots, repo } = fixture();
    const before = treeDigest(repo.path);

    const result = onboard(roots, repo, '--promote', 'push');
    assert.equal(result.code, 64, result.stdout + result.stderr);
    for (const allowed of ['none', 'copy', 'commit']) assert.ok(result.stderr.includes(allowed), `names ${allowed}: ${result.stderr}`);
    assert.equal(treeDigest(repo.path), before);
    assert.equal(eventsOf(roots, 'action.started').length, 0);
  });

  it('promotes nothing without the flag, and `--promote none` is the same: the checkout is byte-identical', () => {
    for (const flags of [[], ['--promote', 'none']]) {
      const { roots, repo } = fixture();
      const before = checkoutSnapshot(repo.path);

      const result = onboard(roots, repo, ...flags);
      assert.equal(result.code, 0, result.stdout + result.stderr);
      assert.deepEqual(checkoutSnapshot(repo.path), before);
      assert.equal(eventsOf(roots, 'action.started', 'action.finished').length, 0, 'no privileged action');
    }
  });
});
