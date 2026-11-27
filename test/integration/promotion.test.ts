// Plan 04-21 (ONB-6, ONB-5, D-15, FR-12, FR-15, S-28): promotion of the accepted map into the user's repository. `--promote none` is the default and
// writes nothing; `copy` writes the accepted map files into an absent or byte-identical `.planning/codebase`; `commit` creates one create-only branch.
// Both are privileged actions that pass the approval gate with the onboarding contract as their source. Scratch repositories, temp profiles and the
// fake host; no test calls a model.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { CloneStagingWorkspace } from '../../src/adapters/git/staging-clone.ts';
import { runOnboarding, startOnboarding } from '../../src/app/onboarding-service.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { ALL_MAP_FILES, FakeAgentHost } from '../helpers/fake-agent-host.ts';
import { EXPIRY_WAIT_MS, REPO_FILES, SHORT_TTL_MS, TEST_CLI, resumeCli, rows, sleepSync } from '../helpers/fault-run.ts';
import { makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import { checkoutSnapshot, git, makeScratchRepo, treeDigest } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';
import { makeStampedMapRepo } from '../helpers/stamped-map-fixture.ts';

const ORG_FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'org-acme');

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

// ---- Task 2: copy never overwrites (S-28), commit makes one create-only branch, and a policy deny refuses --------------------------------------------------

interface StepDb {
  status: string;
  result_json: string;
}
const promoteStep = (roots: CliRoots): { status: string; result: Record<string, unknown> } | null => {
  // The latest onboarding's step: a second onboarding of the same repository adds a row.
  const [row] = rows<StepDb>(roots, "SELECT status, result_json FROM onboarding_steps WHERE step = 'promote' ORDER BY rowid DESC");
  return row === undefined ? null : { status: row.status, result: JSON.parse(row.result_json) as Record<string, unknown> };
};
interface DecisionDb {
  decision_id: string;
  run_id: string;
  class: string;
  issue: string;
  options_json: string;
  evidence_refs_json: string;
  state: string;
}
const decisionsOf = (roots: CliRoots): DecisionDb[] => rows<DecisionDb>(roots, 'SELECT decision_id, run_id, class, issue, options_json, evidence_refs_json, state FROM decisions ORDER BY rowid');

// Every ref of the repository with its object, plus the branch HEAD names: what "no other ref moved" is measured against.
const refLines = (repo: ScratchRepo): string[] => git(repo.path, ['for-each-ref', '--format=%(refname) %(objectname)']).trim().split('\n').filter((l) => l !== '');
const refsDigest = (repo: ScratchRepo): string => `${git(repo.path, ['symbolic-ref', '-q', 'HEAD']).trim()}\n${refLines(repo).join('\n')}`;
const fileBytes = (repo: ScratchRepo, name: string): Buffer => readFileSync(join(repo.path, MAP_DIR, name));

describe('copy never overwrites a file of the checkout (S-28, T-04-56)', () => {
  it('a map edited after its stamp commit is left as it is: every differing file stays byte-identical and one permission decision lists them', () => {
    const repo = makeStampedMapRepo({ editedAfterStamp: ['STACK.md', 'TESTING.md'] });
    const roots = makeRoots();
    cleanups.push(repo.dispose, () => rmSync(roots.base, { recursive: true, force: true }));
    const before = checkoutSnapshot(repo.path);
    const edited = new Map<string, Buffer>(ALL_MAP_FILES.map((name) => [name, fileBytes(repo, name)]));

    const result = onboard(roots, repo, '--promote', 'copy');
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.deepEqual(checkoutSnapshot(repo.path), before, 'nothing in the checkout changed: no target was absent');
    for (const name of ALL_MAP_FILES) assert.ok(fileBytes(repo, name).equals(edited.get(name) as Buffer), `${name} is byte-identical`);
    assert.deepEqual(readdirSync(join(repo.path, MAP_DIR)).filter((n) => n.startsWith('.avarice-promote')), [], 'no temporary file is left behind');

    const step = promoteStep(roots);
    assert.equal(step?.status, 'completed');
    assert.deepEqual(step?.result['written'], []);
    const conflicts = step?.result['conflicts'] as string[];
    assert.ok(conflicts.length > 0, 'the differing files are named');
    for (const name of ['STACK.md', 'TESTING.md']) assert.ok(conflicts.includes(`${MAP_DIR}/${name}`), `${name} is a conflict`);

    const decisions = decisionsOf(roots);
    assert.equal(decisions.length, 1, 'one decision');
    assert.equal(decisions[0]?.class, 'permission');
    assert.equal(decisions[0]?.state, 'open');
    for (const path of conflicts) assert.ok(decisions[0]?.issue.includes(path), `the decision names ${path}`);
    assert.deepEqual((JSON.parse(decisions[0]?.options_json as string) as Array<{ key: string }>).map((o) => o.key), ['withdraw'], 'a permission decision offers only withdraw');
    assert.match(result.stdout, /left untouched because they differ/);
    assert.equal(approvalCount(roots), 0);
  });

  it('writes the absent targets, skips the byte-identical ones as already present and leaves an edited one: the checkout changes only by what was absent', () => {
    const { roots, repo } = fixture();
    assert.equal(onboard(roots, repo, '--promote', 'copy').code, 0);
    const first = promoteStep(roots);
    assert.equal((first?.result['written'] as string[]).length, ALL_MAP_FILES.length);

    // The owner edits one file and deletes another; the rest stay as AVARICE wrote them.
    writeFileSync(join(repo.path, MAP_DIR, 'STACK.md'), `${fileBytes(repo, 'STACK.md').toString('utf8')}\nOwner notes.\n`);
    rmSync(join(repo.path, MAP_DIR, 'CONCERNS.md'));
    const edited = fileBytes(repo, 'STACK.md');
    const withoutDeleted = treeDigest(repo.path, (rel) => rel === `${MAP_DIR}/CONCERNS.md`);

    const second = onboard(roots, repo, '--promote', 'copy');
    assert.equal(second.code, 0, second.stdout + second.stderr);
    const step = promoteStep(roots);
    assert.deepEqual(step?.result['written'], [`${MAP_DIR}/CONCERNS.md`], 'only the absent target is written');
    assert.deepEqual(step?.result['conflicts'], [`${MAP_DIR}/STACK.md`]);
    assert.equal((step?.result['present'] as string[]).length, ALL_MAP_FILES.length - 2, 'the byte-identical targets are skipped as already present');
    assert.ok(fileBytes(repo, 'STACK.md').equals(edited), 'the edited file is not touched');
    assert.equal(treeDigest(repo.path, (rel) => rel === `${MAP_DIR}/CONCERNS.md`), withoutDeleted, 'every other file is byte-identical to before');
    assert.ok(existsSync(join(repo.path, MAP_DIR, 'CONCERNS.md')));
    const decisions = decisionsOf(roots);
    assert.equal(decisions.length, 1, 'the first promotion left none; the second opened one');
    assert.ok(decisions[0]?.issue.includes(`${MAP_DIR}/STACK.md`));
  });

  it('never follows a symbolic link: a .planning that points outside the checkout is a conflict and nothing is written through it', () => {
    const { repo } = fixture();
    const outside = makeScratchRepo({ files: { 'keep.txt': 'outside\n' } });
    cleanups.push(outside.dispose);
    symlinkSync(outside.path, join(repo.path, '.planning'));
    const outsideBefore = treeDigest(outside.path);

    const workspace = new CloneStagingWorkspace();
    const copied = workspace.copyIntoCheckout(repo.path, [{ path: `${MAP_DIR}/STACK.md`, content: Buffer.from('accepted\n') }]);
    assert.ok(copied.ok, JSON.stringify(copied));
    assert.deepEqual(copied.value, { written: [], present: [], conflicts: [`${MAP_DIR}/STACK.md`] });
    assert.equal(treeDigest(outside.path), outsideBefore, 'nothing was written through the link');
  });

  it('refuses a path outside .planning/ and a path that climbs out, writing nothing', () => {
    const { repo } = fixture();
    const before = treeDigest(repo.path);
    const workspace = new CloneStagingWorkspace();
    for (const path of ['src/index.ts', '.planning/../README.md', '../escape.md', '/etc/passwd', '.planning', '.planning/a b.md']) {
      const copied = workspace.copyIntoCheckout(repo.path, [{ path, content: Buffer.from('x') }]);
      assert.equal(copied.ok, false, path);
    }
    assert.equal(treeDigest(repo.path), before);
  });

  // WR-22 (T-04-121): a promoted path is an ordinary planning file. A `.git` segment in any letter case would plant a repository inside the owner's checkout, and a
  // path that is not in normal form would pass the duplicate check as a different name than the one written.
  for (const path of [`${MAP_DIR}/.git/HEAD`, '.planning/.GIT/config', '.planning/.../a.md', '.planning//a.md', '.planning/a.md/']) {
    it(`refuses ${JSON.stringify(path)} with an invalid error naming it, before anything is written into the checkout`, () => {
      const { repo } = fixture();
      const before = checkoutSnapshot(repo.path);
      const copied = new CloneStagingWorkspace().copyIntoCheckout(repo.path, [{ path, content: Buffer.from('x') }]);
      assert.ok(!copied.ok, `${path} was promoted`);
      assert.equal(copied.error.kind, 'invalid');
      assert.ok(copied.error.kind === 'invalid' && copied.error.reason.includes(JSON.stringify(path)), `the error names the path: ${JSON.stringify(copied.error)}`);
      assert.deepEqual(checkoutSnapshot(repo.path), before, 'the checkout tree digest is unchanged');
    });
  }

  it('still promotes an ordinary map file next to a refused path rule', () => {
    const { repo } = fixture();
    const copied = new CloneStagingWorkspace().copyIntoCheckout(repo.path, [{ path: `${MAP_DIR}/STACK.md`, content: Buffer.from('accepted\n') }]);
    assert.ok(copied.ok, JSON.stringify(copied));
    assert.deepEqual(copied.value.written, [`${MAP_DIR}/STACK.md`]);
  });
});

describe('commit makes one create-only branch and changes nothing else in the repository (D-15, ONB-5, T-04-58)', () => {
  it('adds exactly refs/heads/avarice/onboard-<id>, with one Conventional Commits commit of the accepted files on the pinned revision', () => {
    const { roots, repo } = fixture();
    const snapshot = checkoutSnapshot(repo.path);
    const refsBefore = refLines(repo);
    const headRefBefore = git(repo.path, ['symbolic-ref', '-q', 'HEAD']).trim();

    const result = onboard(roots, repo, '--promote', 'commit');
    assert.equal(result.code, 0, result.stdout + result.stderr);
    const id = onboardingId(roots);
    const branch = `avarice/onboard-${id}`;

    const refsAfter = refLines(repo);
    assert.deepEqual(refsAfter.filter((line) => !refsBefore.includes(line)).map((line) => line.split(' ')[0]), [`refs/heads/${branch}`], 'exactly one ref was added');
    assert.deepEqual(refsBefore.filter((line) => !refsAfter.includes(line)), [], 'no ref was removed or moved');
    assert.equal(git(repo.path, ['symbolic-ref', '-q', 'HEAD']).trim(), headRefBefore, 'HEAD still names the same branch');
    assert.deepEqual(checkoutSnapshot(repo.path), snapshot, 'HEAD, the branch, the index, the working tree and every file are unchanged');

    assert.equal(git(repo.path, ['log', '-1', '--format=%s', branch]).trim(), `docs(planning): adopt GSD codebase map from AVARICE onboarding ${id}`);
    assert.equal(git(repo.path, ['rev-list', '--count', branch, `^${repo.head}`]).trim(), '1', 'one commit on top of the pin');
    assert.equal(git(repo.path, ['rev-parse', `${branch}~1`]).trim(), repo.head, 'its parent is the pinned revision');
    assert.deepEqual(
      git(repo.path, ['diff-tree', '-r', '--name-status', '--no-renames', repo.head, branch]).trim().split('\n').sort(),
      ALL_MAP_FILES.map((name) => `A\t${MAP_DIR}/${name}`).sort(),
      'the commit adds the accepted files and nothing else',
    );
    const [onboarding] = rows<{ staging_worktree: string }>(roots, 'SELECT staging_worktree FROM onboardings');
    for (const name of ALL_MAP_FILES) {
      const accepted = readFileSync(join(onboarding?.staging_worktree as string, MAP_DIR, name));
      assert.ok(Buffer.from(git(repo.path, ['cat-file', 'blob', `${branch}:${MAP_DIR}/${name}`]), 'utf8').equals(accepted), `${name} carries the accepted bytes`);
    }

    const [started] = eventsOf(roots, 'action.started');
    assert.equal(dataOf(started as EventDb).action, 'onboarding.promote.commit');
    assert.equal(dataOf(started as EventDb).source, 'contract');
    assert.equal(dataOf(eventsOf(roots, 'action.finished')[0] as EventDb).status, 'succeeded');
    assert.equal(promoteStep(roots)?.result['branch'], branch);
    assert.equal(approvalCount(roots), 0);
  });

  it('refuses a branch that already exists and leaves it where it is (create-only)', () => {
    const { roots, repo } = fixture();
    const workspace = new CloneStagingWorkspace();
    const prepared = workspace.prepare({ repoPath: repo.path, workRoot: roots.AVARICE_WORK_ROOT, onboardingId: 'onb_TWICE', pin: repo.head });
    assert.ok(prepared.ok, JSON.stringify(prepared));
    const input = {
      repoPath: repo.path,
      stagingPath: prepared.value.path,
      onboardingId: 'onb_TWICE',
      pin: repo.head,
      files: [{ path: `${MAP_DIR}/STACK.md`, content: Buffer.from('accepted\n') }],
      message: 'docs(planning): adopt the map',
    };

    const first = workspace.commitPromotion(input);
    assert.ok(first.ok, JSON.stringify(first));
    const refs = refsDigest(repo);
    const second = workspace.commitPromotion({ ...input, files: [{ path: `${MAP_DIR}/STACK.md`, content: Buffer.from('other\n') }] });
    assert.equal(second.ok, false);
    assert.ok(!second.ok && second.error.kind === 'conflict', JSON.stringify(second));
    assert.equal(refsDigest(repo), refs, 'the existing branch did not move');
  });

  it('refuses a staging copy that shares the repository, and a path outside .planning/', () => {
    const { roots, repo } = fixture();
    const workspace = new CloneStagingWorkspace();
    const refs = refsDigest(repo);
    const bad = workspace.commitPromotion({ repoPath: repo.path, stagingPath: repo.path, onboardingId: 'onb_BAD', pin: repo.head, files: [{ path: `${MAP_DIR}/STACK.md`, content: Buffer.from('x') }], message: 'm' });
    assert.equal(bad.ok, false, 'the user repository is not a staging clone');
    const prepared = workspace.prepare({ repoPath: repo.path, workRoot: roots.AVARICE_WORK_ROOT, onboardingId: 'onb_PATH', pin: repo.head });
    assert.ok(prepared.ok);
    const outside = workspace.commitPromotion({ repoPath: repo.path, stagingPath: prepared.value.path, onboardingId: 'onb_PATH', pin: repo.head, files: [{ path: 'src/index.ts', content: Buffer.from('x') }], message: 'm' });
    assert.equal(outside.ok, false);
    assert.equal(refsDigest(repo), refs, 'no ref was created');
  });
});

describe('a policy deny refuses the promotion (T-04-57, FR-12)', () => {
  // An enterprise profile whose organization policy denies onboarding.promote.commit: the contract names the action, and the deny still wins.
  function enterpriseWithDeny(roots: CliRoots, extraRules: readonly unknown[]): void {
    const profileDir = join(roots.AVARICE_CONFIG_HOME, 'profiles', 'enterprise-acme');
    mkdirSync(profileDir, { recursive: true });
    copyFileSync(join(ORG_FIXTURE, 'config.json'), join(profileDir, 'config.json'));
    const policy = JSON.parse(readFileSync(join(ORG_FIXTURE, 'policy.json'), 'utf8')) as { rules: unknown[] };
    policy.rules.push(...extraRules);
    writeFileSync(join(profileDir, 'policy.json'), JSON.stringify(policy));
  }
  const envOf = (roots: CliRoots): NodeJS.ProcessEnv => ({
    ...process.env,
    AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME,
    AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT,
    AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT,
    AVARICE_CLAUDE_BIN: '/nonexistent/avarice-test-has-no-claude',
  });

  it('the enterprise fixture policy with a deny rule for onboarding.promote.commit: the promotion is refused with the rule ID, no ref is created and the onboarding stays active', async () => {
    const { roots, repo } = fixture();
    enterpriseWithDeny(roots, [{ id: 'org.no-promote-commit', action: 'onboarding.promote.commit', effect: 'deny' }]);
    const refsBefore = refsDigest(repo);
    const before = checkoutSnapshot(repo.path);
    const composed = createDeps(envOf(roots), { host: new FakeAgentHost() }, { profile: 'enterprise-acme' });
    assert.ok(composed.ok, JSON.stringify(composed));
    try {
      const { deps } = composed.value;
      const started = startOnboarding(deps, { repoPath: repo.path, policy: 'onboarding', promote: 'commit' });
      assert.ok(started.ok, JSON.stringify(started));
      const outcome = await runOnboarding(deps, started.value.onboardingId);
      assert.ok(outcome.ok, JSON.stringify(outcome));
      assert.equal(outcome.value.state, 'active', 'the onboarding is not failed by a refused promotion');
      assert.match(outcome.value.message ?? '', /org\.no-promote-commit/, 'the owner is told which rule refused it');

      const steps = deps.ledger.getStepResults(started.value.onboardingId);
      assert.ok(steps.ok);
      const step = steps.value.find((s) => s.step === 'promote');
      assert.equal(step?.status, 'refused');
      assert.equal((step?.result as Record<string, unknown>)['rule'], 'org.no-promote-commit');
      const actions = deps.ledger.listActionEvents(started.value.onboardingId);
      assert.ok(actions.ok);
      assert.deepEqual(actions.value, [], 'a refused action records no start');
    } finally {
      composed.value.close();
    }
    assert.equal(refsDigest(repo), refsBefore, 'no ref was created');
    assert.deepEqual(checkoutSnapshot(repo.path), before);
  });

  it('the same deny does not refuse copy: a rule names one action', async () => {
    const { roots, repo } = fixture();
    enterpriseWithDeny(roots, [{ id: 'org.no-promote-commit', action: 'onboarding.promote.commit', effect: 'deny' }]);
    const composed = createDeps(envOf(roots), { host: new FakeAgentHost() }, { profile: 'enterprise-acme' });
    assert.ok(composed.ok, JSON.stringify(composed));
    try {
      const { deps } = composed.value;
      const started = startOnboarding(deps, { repoPath: repo.path, policy: 'onboarding', promote: 'copy' });
      assert.ok(started.ok, JSON.stringify(started));
      const outcome = await runOnboarding(deps, started.value.onboardingId);
      assert.ok(outcome.ok, JSON.stringify(outcome));
      assert.equal(outcome.value.state, 'active');
      const steps = deps.ledger.getStepResults(started.value.onboardingId);
      assert.ok(steps.ok);
      assert.equal(steps.value.find((s) => s.step === 'promote')?.status, 'completed');
    } finally {
      composed.value.close();
    }
    assert.deepEqual(mapFilesIn(repo), [...ALL_MAP_FILES].sort());
  });
});

// ---- Task 3: an interrupted promotion is not replayed (FR-15, T-04-44) ---------------------------------------------------------------------------------------

describe('a promotion interrupted after its start was recorded is not replayed on resume (FR-15, T-04-44)', () => {
  // The two gaps of a privileged action: right after its start was recorded, and after the write took effect but before its end was.
  const GAPS = [
    { point: 'after-action-start:onboarding.promote.copy', written: false },
    { point: 'after-action-work:onboarding.promote.copy', written: true },
  ] as const;

  for (const gap of GAPS) {
    it(`killed at ${gap.point}: resume opens one permission decision, writes nothing and does not run the stage again`, () => {
      const { roots, repo } = fixture();
      const killed = runCli(['onboard', '--policy', 'onboarding', '--promote', 'copy', repo.path], {
        roots,
        entry: TEST_CLI,
        env: { AVARICE_FAKE_HOST: '{}', AVARICE_LEASE_TTL_MS: String(SHORT_TTL_MS), AVARICE_FAULT: gap.point },
      });
      assert.equal(killed.signal, 'SIGKILL', `${killed.stdout}${killed.stderr}`);
      const id = onboardingId(roots);
      assert.equal(rows<{ state: string }>(roots, 'SELECT state FROM onboardings')[0]?.state, 'active', 'activation had committed');
      const [start] = eventsOf(roots, 'action.started');
      assert.ok(start !== undefined, 'the start was recorded');
      assert.equal(eventsOf(roots, 'action.finished').length, 0, 'the end was not');
      assert.equal(mapFilesIn(repo).length > 0, gap.written, gap.written ? 'the files were written before the kill' : 'nothing was written before the kill');
      const atKill = treeDigest(repo.path);

      sleepSync(EXPIRY_WAIT_MS);
      const resumed = resumeCli(roots, id);
      assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
      assert.match(resumed.stdout, new RegExp(`onboarding ${id}: active`));
      assert.match(resumed.stdout, /onboarding\.promote\.copy was started and never finished; it was not repeated \(decision dec_/);

      const decisions = decisionsOf(roots);
      assert.equal(decisions.length, 1, 'one permission decision');
      assert.equal(decisions[0]?.class, 'permission');
      assert.equal(decisions[0]?.state, 'open');
      assert.deepEqual(JSON.parse(decisions[0]?.evidence_refs_json as string), [`event:${start.seq}`], 'it names the start it is about');
      assert.ok(decisions[0]?.issue.includes('onboarding.promote.copy') && decisions[0]?.issue.includes('it was not repeated'), decisions[0]?.issue);
      assert.equal(rows<{ contract_run_id: string }>(roots, 'SELECT contract_run_id FROM onboardings')[0]?.contract_run_id, decisions[0]?.run_id, 'it hangs off the onboarding contract run');
      assert.deepEqual((JSON.parse(decisions[0]?.options_json as string) as Array<{ key: string }>).map((o) => o.key), ['withdraw']);

      assert.equal(treeDigest(repo.path), atKill, 'the checkout after the resume is the checkout at the kill: the resume wrote nothing');
      assert.equal(eventsOf(roots, 'action.started').length, 1, 'the stage did not run again: still one start');
      assert.equal(eventsOf(roots, 'action.finished').length, 0);
      const [interrupted] = eventsOf(roots, 'action.interrupted');
      assert.equal(dataOf(interrupted as EventDb).startSeq, start.seq);
      assert.equal(promoteStep(roots), null, 'no outcome was recorded for a promotion nobody saw finish');
      assert.equal(approvalCount(roots), 0, 'nothing here writes an approval');

      // A second resume finds nothing open and repeats nothing.
      const again = resumeCli(roots, id);
      assert.equal(again.code, 0, again.stdout + again.stderr);
      assert.equal(decisionsOf(roots).length, 1);
      assert.equal(eventsOf(roots, 'action.interrupted').length, 1);
      assert.equal(treeDigest(repo.path), atKill);
    });
  }

  it('a finished promotion leaves nothing for resume: no lease, no decision, no new event', () => {
    const { roots, repo } = fixture();
    assert.equal(onboard(roots, repo, '--promote', 'copy').code, 0);
    const id = onboardingId(roots);
    const eventsBefore = rows<{ n: number }>(roots, 'SELECT COUNT(*) AS n FROM events')[0]?.n;
    const atEnd = treeDigest(repo.path);

    const resumed = resumeCli(roots, id);
    assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
    assert.equal(rows<{ n: number }>(roots, 'SELECT COUNT(*) AS n FROM events')[0]?.n, eventsBefore, 'resume wrote no event');
    assert.equal(decisionsOf(roots).length, 0);
    assert.equal(treeDigest(repo.path), atEnd);
  });
});
