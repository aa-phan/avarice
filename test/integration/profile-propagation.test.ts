// Profile propagation (plan 04-12; SEC-1, D-16, T-04-31): a command that hands work to another process, the detached supervisor `start` spawns and the
// LaunchAgent `schedule install` writes, carries the profile it selected beside the three root variables. A child that lost the name would open the default
// profile; with the roots pointing at a store of another profile the composition refuses it, and a run started under personal-extended would never advance.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderDigestPlist } from '../../src/adapters/schedule/launchd.ts';
import { ok } from '../../src/domain/result.ts';
import type { Result } from '../../src/domain/result.ts';
import type { ProcessEntry } from '../../src/adapters/proc/ancestry.ts';
import { main } from '../../src/cli/main.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { supervisorEnv } from '../../src/cli/spawn-supervisor.ts';
import { REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { TEST_CLI } from '../helpers/offline.ts';
import { FIXED_SLUG, RUN_CONVENTIONS_WITH_COMMANDS, commitConventions, ledgerRows, makeRunRepo, profileEnv, startWithFakeRunHost, writeBrief } from '../helpers/run-fixtures.ts';
import { fakeTerminal } from '../helpers/shell-streams.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const PROFILE = 'personal-extended';
const FAKE_LAUNCHCTL = join(REPO_ROOT, 'test', 'helpers', 'fake-launchctl.mjs');
const PLUTIL = '/usr/bin/plutil';
const ENTRY = join(REPO_ROOT, 'bin', 'avarice.ts');
const UID = process.getuid?.() ?? 0;

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  brief: string;
}

// A repository onboarded under personal-extended, with the three roots all pointing into the temp directory.
function fixture(): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  const onboarded = runCli(['onboard', '--policy', 'onboarding', '--profile', PROFILE, repo.path], { roots, entry: TEST_CLI, env: { AVARICE_FAKE_HOST: '{}' } });
  assert.equal(onboarded.code, 0, onboarded.stderr + onboarded.stdout);
  commitConventions(repo, RUN_CONVENTIONS_WITH_COMMANDS);
  return { roots, repo, brief: writeBrief(join(roots.base, 'briefs')) };
}

describe('the supervisor of a run keeps the profile the run was started under (D-16, T-04-31)', () => {
  const f = fixture();
  const started = startWithFakeRunHost(f.roots, f.repo, f.brief, { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' }, ['--profile', PROFILE]);
  const runId = /^run (run_[0-9A-Z]{26}): /.exec(started.stdout.split('\n')[0] ?? '')?.[1] ?? '';

  it('start --profile personal-extended --wait ends ready_for_review in the personal-extended store', () => {
    assert.equal(started.code, 0, started.stderr + started.stdout);
    assert.notEqual(runId, '', started.stdout);
    assert.equal(started.stdout.trim().split('\n').at(-1), `run ${runId}: ready_for_review`);
    assert.equal(ledgerRows<{ value: string }>(f.roots, "SELECT value FROM meta WHERE key = 'profile_id'")[0]?.value, PROFILE);
    assert.equal(ledgerRows<{ state: string }>(f.roots, 'SELECT state FROM runs WHERE run_id = ?', runId)[0]?.state, 'ready_for_review');
  });

  it('the child never opened personal-local: no config of it was created beside the config of the selected profile', () => {
    assert.equal(existsSync(join(f.roots.AVARICE_CONFIG_HOME, 'profiles', 'personal-local')), false);
    assert.equal(existsSync(join(f.roots.AVARICE_CONFIG_HOME, 'profiles', PROFILE, 'config.json')), true);
  });

  it('a supervisor selected as personal-local by its environment is refused on the store of personal-extended (exit 70, nothing changed)', () => {
    const before = ledgerRows<{ state: string }>(f.roots, 'SELECT state FROM runs WHERE run_id = ?', runId)[0]?.state;
    const refused = runCli(['supervise', runId], { roots: f.roots, entry: TEST_CLI, env: { AVARICE_FAKE_HOST: '{}', AVARICE_PROFILE: 'personal-local' } });
    assert.equal(refused.code, 70, refused.stderr);
    assert.match(refused.stderr, /belongs to profile personal-extended/);
    assert.equal(ledgerRows<{ state: string }>(f.roots, 'SELECT state FROM runs WHERE run_id = ?', runId)[0]?.state, before);
  });

  it('a supervisor selected by AVARICE_PROFILE alone opens the store of that profile', () => {
    const again = runCli(['supervise', runId], { roots: f.roots, entry: TEST_CLI, env: { AVARICE_FAKE_HOST: '{}', AVARICE_PROFILE: PROFILE } });
    assert.doesNotMatch(again.stderr, /belongs to profile/);
    assert.match(again.stdout + again.stderr, new RegExp(`run ${runId}`));
  });
});

describe('supervisorEnv carries the selected profile beside the three roots (D-16)', () => {
  it('sets AVARICE_PROFILE to deps.profile.profile', () => {
    const roots = makeRoots();
    cleanup.push(roots.base);
    const composed = createDeps(profileEnv(roots), {}, { profile: PROFILE });
    assert.ok(composed.ok, composed.ok ? '' : composed.message);
    try {
      const env = supervisorEnv(composed.value.deps);
      assert.equal(env['AVARICE_PROFILE'], PROFILE);
      assert.equal(env['AVARICE_DATA_ROOT'], roots.AVARICE_DATA_ROOT);
      assert.equal(supervisorEnv(composed.value.deps, 'run_NONE')['AVARICE_PROFILE'], PROFILE);
    } finally {
      composed.value.close();
    }
  });

  it('overrides an AVARICE_PROFILE the spawning process happened to inherit', () => {
    const roots = makeRoots();
    cleanup.push(roots.base);
    const composed = createDeps({ ...profileEnv(roots), AVARICE_PROFILE: 'personal-local' }, {}, { profile: PROFILE });
    assert.ok(composed.ok, composed.ok ? '' : composed.message);
    const saved = process.env['AVARICE_PROFILE'];
    process.env['AVARICE_PROFILE'] = 'personal-local';
    try {
      assert.equal(supervisorEnv(composed.value.deps)['AVARICE_PROFILE'], PROFILE);
    } finally {
      if (saved === undefined) delete process.env['AVARICE_PROFILE'];
      else process.env['AVARICE_PROFILE'] = saved;
      composed.value.close();
    }
  });
});

describe('the LaunchAgent of the digest carries the selected profile (D-16)', () => {
  const entry = (pid: number, ppid: number, command: string): ProcessEntry => ({ pid, ppid, command });
  const CALM_CHAIN = (): Result<ProcessEntry[]> => ok([entry(300, 200, 'node avarice.ts schedule'), entry(200, 100, '-zsh'), entry(100, 1, 'login'), entry(1, 0, '/sbin/launchd')]);

  const plistInput = (env: Record<string, string>) => ({
    label: `io.avarice.digest.${PROFILE}`,
    nodePath: process.execPath,
    entryPath: ENTRY,
    times: ['12:30'],
    env,
    logPath: '/tmp/avarice-data/logs/digest.log',
  });

  it('schedule install --profile personal-extended writes AVARICE_PROFILE into EnvironmentVariables', async () => {
    const roots = makeRoots();
    const dir = mkdtempSync(join(tmpdir(), 'avarice-propagation-'));
    cleanup.push(roots.base, dir);
    chmodSync(FAKE_LAUNCHCTL, 0o755);
    const agents = join(dir, 'LaunchAgents');
    mkdirSync(agents);
    const term = fakeTerminal({ inputIsTty: true, outputIsTty: true });
    const out: string[] = [];
    const err: string[] = [];
    process.env['FAKE_LAUNCHCTL_LOG'] = join(dir, 'launchctl.log');
    try {
      const code = await main(['schedule', 'install', '--profile', PROFILE], {
        env: profileEnv(roots),
        io: { out: (t) => void out.push(t), err: (t) => void err.push(t) },
        stdin: term.stdin,
        stdout: term.stdout,
        ancestry: CALM_CHAIN,
        scheduler: { agentsDir: agents, launchctl: FAKE_LAUNCHCTL, plutil: PLUTIL, uid: UID, nodePath: process.execPath, entryPath: ENTRY },
      } as Parameters<typeof main>[1]);
      assert.equal(code, 0, err.join('') + out.join(''));
    } finally {
      delete process.env['FAKE_LAUNCHCTL_LOG'];
    }
    const file = join(agents, `io.avarice.digest.${PROFILE}.plist`);
    const json = JSON.parse(execFileSync(PLUTIL, ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' })) as { EnvironmentVariables: Record<string, string> };
    assert.deepEqual(json.EnvironmentVariables, {
      AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME,
      AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT,
      AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT,
      AVARICE_PROFILE: PROFILE,
    });
    assert.match(readFileSync(file, 'utf8'), /<key>AVARICE_PROFILE<\/key><string>personal-extended<\/string>/);
  });

  it('the validator accepts a profile name and refuses a name that is not a profile, a path, and a variable it does not carry', () => {
    const base = { AVARICE_DATA_ROOT: '/tmp/avarice-data' };
    const accepted = renderDigestPlist(plistInput({ ...base, AVARICE_PROFILE: PROFILE }));
    assert.ok(accepted.ok, accepted.ok ? '' : JSON.stringify(accepted.error));
    for (const bad of ['Bogus', '../escape', '/tmp/personal-local', 'personal-local\n', '']) {
      const refused = renderDigestPlist(plistInput({ ...base, AVARICE_PROFILE: bad }));
      assert.equal(refused.ok, false, JSON.stringify(bad));
    }
    const unknown = renderDigestPlist(plistInput({ ...base, AVARICE_SOMETHING: 'x' }));
    assert.equal(unknown.ok, false);
  });
});
