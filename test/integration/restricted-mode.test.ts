// Restricted mode for runs (plan 04-23; CON-4, D-12, S-22). A host without required enforcement refuses an unattended run by default and says how to ask for
// restricted mode; `avarice start --restricted` then runs analysis and planning only: one `claude -p ... --restricted` invocation in the run's disposable clone, whose
// plan, patch and question list are stored as artifacts. The run never commits, never hands off a branch and never writes the user's repository, and it ends blocked
// (enforcement_failure) with one decision that names what it left. The real ClaudeHostAdapter runs against a fake `claude` that records its argv and edits the clone;
// no model is called.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { ClaudeHostAdapter } from '../../src/adapters/host-claude/claude-host.ts';
import { assertRestrictedLaunchArgsSafe, restrictedLaunchArgs } from '../../src/adapters/host-claude/launch-args.ts';
import { checkRestrictedLaunchReady } from '../../src/adapters/host-claude/launch-preflight.ts';
import { RESTRICTED_HELP_FLAGS } from '../../src/domain/host-admission.ts';
import type { Result } from '../../src/domain/result.ts';
import { makeFakeClaude } from '../helpers/fake-claude.ts';
import type { FakeClaude, FakeClaudeScript } from '../helpers/fake-claude.ts';
import { makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import { commitConventions, makeRunRepo, onboardRunRepo, writeBrief } from '../helpers/run-fixtures.ts';
import { checkoutSnapshot } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

// The edit the fake host makes in the clone, and the plan and questions it leaves under the restricted directory.
const FIXED_SLUG = [
  '// Turns a title into a URL slug.',
  'export function slugify(title: string): string {',
  "  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');",
  '}',
  '',
].join('\n');
const PLAN_TEXT = '# Plan\n\n1. Collapse runs of separators in src/slug.ts.\n2. Trim the dashes at both ends.\n';
const WRITES: Readonly<Record<string, string>> = { '.avarice-restricted/PLAN.md': PLAN_TEXT, 'src/slug.ts': FIXED_SLUG };

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  // The revision the repository was onboarded at: the run clone is made at it.
  pin: string;
  brief: string;
  fake: FakeClaude;
}

// An onboarded repository with committed conventions, and a fake `claude` that reports `version` (2.2.0 is a minor no admission rule accepts).
function fixture(script: FakeClaudeScript = {}): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  const pin = onboardRunRepo(roots, repo);
  commitConventions(repo);
  const brief = writeBrief(join(roots.base, 'briefs'));
  const fake = makeFakeClaude({ version: '2.2.0 (Claude Code)', transcript: 'success', writes: WRITES, ...script });
  cleanup.push(fake.dir);
  return { roots, repo, pin, brief, fake };
}

function start(f: Fixture, ...extra: string[]): CliResult {
  return runCli(['start', '--brief', f.brief, '--policy', 'routine', ...extra], {
    roots: f.roots,
    cwd: f.repo.path,
    env: { AVARICE_CLAUDE_BIN: f.fake.bin },
    timeoutMs: 180_000,
  });
}

function db(roots: CliRoots): DatabaseSync {
  return new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true, timeout: 5000 });
}

function rows<T>(roots: CliRoots, sql: string, ...params: Array<string | number>): T[] {
  const handle = db(roots);
  try {
    return (handle.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    handle.close();
  }
}

function runIdOf(stdout: string): string {
  const match = /^run (run_[0-9A-Z]{26}): /.exec(stdout.split('\n')[0] ?? '');
  assert.ok(match, `the first line names the run, got ${JSON.stringify(stdout.split('\n')[0])}`);
  return match[1] as string;
}

const refsOf = (repo: string): string => execFileSync('git', ['for-each-ref', '--format=%(refname) %(objectname)'], { cwd: repo, encoding: 'utf8' });

// The text of a stored artifact, by digest.
function artifactText(roots: CliRoots, digest: string): string {
  const hex = digest.replace('sha256:', '');
  return readFileSync(join(roots.AVARICE_DATA_ROOT, 'artifacts', hex.slice(0, 2), hex), 'utf8');
}

interface ArtifactRow {
  digest: string;
  kind: string;
}
const artifactsOf = (roots: CliRoots, runId: string): ArtifactRow[] => rows<ArtifactRow>(roots, "SELECT digest, kind FROM artifacts WHERE run_id = ? AND kind LIKE 'restricted-%' ORDER BY kind", runId);

describe('tracer: an unenforced host refuses naming --restricted, and start --restricted ends with a plan and a patch (CON-4, D-12)', () => {
  it('without the flag, an unadmitted host refuses: exit 3, the message says `enforcement: restricted` and names --restricted, and no invocation started', () => {
    const f = fixture();
    const r = start(f, '--wait');
    assert.equal(r.code, 3, r.stdout + r.stderr);
    const text = r.stdout + r.stderr;
    assert.match(text, /enforcement: restricted/, text);
    assert.match(text, /rerun with --restricted for analysis and planning only/, text);
    assert.equal(f.fake.started(), false, 'the host was never started');
    assert.deepEqual(f.fake.argvs(), []);
    const run = rows<{ state: string; reason: string }>(f.roots, "SELECT state, reason FROM runs WHERE state != 'onboarding'")[0];
    assert.deepEqual([run?.state, run?.reason], ['blocked_on_decision', 'enforcement_failure']);
  });

  it('start --restricted launches the restricted line in the run clone, edits only the clone, stores the plan and the patch, and ends blocked without a gate, a commit or a hand-off', () => {
    const f = fixture();
    const before = { checkout: checkoutSnapshot(f.repo.path), refs: refsOf(f.repo.path) };
    const r = start(f, '--restricted', '--wait');
    const text = r.stdout + r.stderr;
    assert.equal(r.code, 3, text);
    const runId = runIdOf(r.stdout);
    assert.equal(r.stdout.split('\n').filter((l) => l !== '').at(-1), `run ${runId}: blocked_on_decision (enforcement_failure)`);

    // The launch line: restricted, dontAsk, no prompts, the run's settings, and no tool grant at all.
    const launches = f.fake.argvs();
    assert.equal(launches.length, 1, 'one invocation');
    const { argv, cwd } = launches[0] as { argv: string[]; cwd: string };
    assert.equal(argv[0], '-p');
    assert.ok(argv.includes('--restricted'), 'the line carries --restricted');
    assert.equal(argv[argv.indexOf('--permission-mode') + 1], 'dontAsk');
    assert.equal(argv[argv.indexOf('--permission-prompts') + 1], 'none');
    assert.ok((argv[argv.indexOf('--settings') + 1] ?? '').endsWith('host-settings.json'), 'the generated run settings');
    for (const flag of ['--allowedTools', '--allowed-tools', '--tools', '--add-dir', '--bare', '--plugin-dir', '--agents']) assert.ok(!argv.includes(flag), `no ${flag}`);
    assert.ok(!argv.includes('Bash'), 'no Bash anywhere on the line');
    assert.equal(cwd, join(realpathSync(f.roots.AVARICE_WORK_ROOT), runId, 'clone'), 'the unit runs in the disposable clone under the work root');

    // The outputs: the plan and the patch, stored as artifacts; the patch holds the edit.
    const artifacts = artifactsOf(f.roots, runId);
    assert.deepEqual(artifacts.map((a) => a.kind), ['restricted-patch', 'restricted-plan']);
    const patch = artifactText(f.roots, (artifacts.find((a) => a.kind === 'restricted-patch') as ArtifactRow).digest);
    assert.match(patch, /^diff --git a\/src\/slug\.ts b\/src\/slug\.ts$/m);
    assert.ok(patch.includes("+  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-')"), 'the patch holds the edit');
    assert.ok(!patch.includes('.avarice-restricted'), 'the restricted directory is not in the patch');
    assert.equal(artifactText(f.roots, (artifacts.find((a) => a.kind === 'restricted-plan') as ArtifactRow).digest), PLAN_TEXT);

    // The run stored its mode, ran no gate, made no commit and handed nothing off.
    const contract = rows<{ body_json: string }>(f.roots, 'SELECT body_json FROM contracts WHERE run_id = ?', runId)[0];
    assert.equal((JSON.parse(contract?.body_json ?? '{}') as { mode?: string }).mode, 'restricted');
    assert.deepEqual(rows(f.roots, 'SELECT gate FROM gate_results WHERE run_id = ?', runId), [], 'no gate ran');
    assert.deepEqual(rows(f.roots, "SELECT step FROM run_steps WHERE run_id = ? AND step LIKE 'handoff%'", runId), [], 'no hand-off');
    const clone = join(f.roots.AVARICE_WORK_ROOT, runId, 'clone');
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: clone, encoding: 'utf8' }).trim(), f.pin, 'the clone stays at the pin: nothing was committed');
    assert.ok(readFileSync(join(clone, 'src', 'slug.ts'), 'utf8').includes('replace(/^-+|-+$/g'), 'the edit is in the clone');

    // The user's repository is exactly as it was.
    assert.deepEqual(checkoutSnapshot(f.repo.path), before.checkout, 'the user checkout is unchanged (treeDigest, status, HEAD)');
    assert.equal(refsOf(f.repo.path), before.refs, 'the user repository has no new ref (refsDigest)');
    assert.ok(!existsSync(join(f.repo.path, '.avarice-restricted')), 'nothing written beside the clone');
  });
});

// ---- the decision list, the status label and resume (task 2) ---------------------------------------------------------------------------------

const QUESTIONS = 'Should an empty title give an empty slug or an error?\nShould a non-ASCII letter be kept or dropped?\n';

interface DecisionRow {
  decision_id: string;
  class: string;
  state: string;
  issue: string;
  options_json: string;
  evidence_refs_json: string;
}

describe('the decision list, the status label, and resume stays restricted (CON-4, D-12)', () => {
  it('stores the question list as restricted-decisions and opens one permission decision that names the plan, the patch and the list', () => {
    const f = fixture({ writes: { ...WRITES, '.avarice-restricted/QUESTIONS.md': QUESTIONS } });
    const r = start(f, '--restricted', '--wait');
    assert.equal(r.code, 3, r.stdout + r.stderr);
    const runId = runIdOf(r.stdout);

    const artifacts = artifactsOf(f.roots, runId);
    assert.deepEqual(artifacts.map((a) => a.kind), ['restricted-decisions', 'restricted-patch', 'restricted-plan']);
    const list = artifacts.find((a) => a.kind === 'restricted-decisions') as ArtifactRow;
    assert.equal(artifactText(f.roots, list.digest), QUESTIONS);

    const decisions = rows<DecisionRow>(f.roots, 'SELECT decision_id, class, state, issue, options_json, evidence_refs_json FROM decisions WHERE run_id = ?', runId);
    assert.equal(decisions.length, 1, 'one decision');
    const decision = decisions[0] as DecisionRow;
    assert.deepEqual([decision.class, decision.state], ['permission', 'open']);
    for (const artifact of artifacts) assert.ok(decision.issue.includes(artifact.digest), `the decision names the ${artifact.kind} digest`);
    assert.match(decision.issue, /2 open questions/);
    assert.match(decision.issue, /No check and no gate ran and nothing was committed or handed off/);
    assert.match(decision.issue, /avarice cancel/);
    // A permission decision offers only withdraw (owner decision 2); it applies nothing, and the run stays blocked until it is cancelled.
    assert.deepEqual((JSON.parse(decision.options_json) as Array<{ key: string }>).map((o) => o.key), ['withdraw']);
    assert.deepEqual((JSON.parse(decision.evidence_refs_json) as string[]).sort(), artifacts.map((a) => `artifact:${a.digest}`).sort());
  });

  it('labels the run restricted in text status and appends the optional `restricted` key last to the run entry of status --json; a contained run has neither', () => {
    const f = fixture({ writes: { ...WRITES, '.avarice-restricted/QUESTIONS.md': QUESTIONS } });
    const runId = runIdOf(start(f, '--restricted', '--wait').stdout);
    const json = runCli(['status', '--json'], { roots: f.roots, env: { AVARICE_CLAUDE_BIN: f.fake.bin } });
    assert.equal(json.code, 0, json.stderr);
    const projects = JSON.parse(json.stdout) as Array<{ runs?: Array<Record<string, unknown>> }>;
    const entry = projects.flatMap((p) => p.runs ?? []).find((r) => r['runId'] === runId) as Record<string, unknown>;
    assert.equal(entry['restricted'], true);
    assert.equal(Object.keys(entry).at(-1), 'restricted', 'appended last');

    const text = runCli(['status'], { roots: f.roots, env: { AVARICE_CLAUDE_BIN: f.fake.bin } });
    assert.equal(text.code, 0, text.stderr);
    const tableRow = text.stdout.split('\n').find((line) => line.includes(runId) && line.includes('blocked_on_decision'));
    assert.ok(tableRow !== undefined && tableRow.includes('restricted'), `the STATE column says restricted: ${tableRow ?? text.stdout}`);

    // A contained run (no claude to run it on, so it blocks at G0 like any unenforced host) has no `restricted` key and no label.
    const g = fixture();
    const absent = { AVARICE_CLAUDE_BIN: '/nonexistent/claude' };
    const contained = runCli(['start', '--brief', g.brief, '--policy', 'routine', '--wait'], { roots: g.roots, cwd: g.repo.path, env: absent, timeoutMs: 180_000 });
    const containedId = runIdOf(contained.stdout);
    const plain = JSON.parse(runCli(['status', '--json'], { roots: g.roots, env: absent }).stdout) as Array<{ runs?: Array<Record<string, unknown>> }>;
    const plainEntry = plain.flatMap((p) => p.runs ?? []).find((r) => r['runId'] === containedId) as Record<string, unknown>;
    assert.ok(!('restricted' in plainEntry), 'no restricted key on a contained run');
    assert.ok(!runCli(['status'], { roots: g.roots, env: absent }).stdout.includes('restricted'), 'no restricted label on a contained run');
  });

  it('relaunches the restricted line when the supervisor is killed during the invocation and the run is resumed; no check runs and no gate row is written', async () => {
    // The first launch sleeps; the supervisor dies with it running. The lease is short so the resume does not wait it out.
    const f = fixture({ sleepMs: 600_000, sleepFirstOnly: true });
    const env = { AVARICE_CLAUDE_BIN: f.fake.bin, AVARICE_LEASE_TTL_MS: '400' };
    const started = runCli(['start', '--restricted', '--brief', f.brief, '--policy', 'routine'], { roots: f.roots, cwd: f.repo.path, env, timeoutMs: 180_000 });
    assert.equal(started.code, 0, started.stdout + started.stderr);
    const runId = runIdOf(started.stdout);
    const waitFor = async (what: string, ready: () => boolean): Promise<void> => {
      for (const deadline = Date.now() + 90_000; !ready(); await new Promise((resolve) => setTimeout(resolve, 100))) {
        if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
      }
    };
    await waitFor('the first restricted launch', () => f.fake.started());
    const spawned = rows<{ result_json: string }>(f.roots, "SELECT result_json FROM run_steps WHERE run_id = ? AND step = 'supervisor:spawn'", runId)[0];
    process.kill((JSON.parse(spawned?.result_json ?? '{}') as { pid: number }).pid, 'SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const resumed = runCli(['resume', runId, '--wait'], { roots: f.roots, cwd: f.repo.path, env, timeoutMs: 180_000 });
    assert.equal(resumed.code, 3, resumed.stdout + resumed.stderr);
    assert.equal(resumed.stdout.split('\n').filter((l) => l !== '').at(-1), `run ${runId}: blocked_on_decision (enforcement_failure)`);

    const launches = f.fake.argvs();
    assert.equal(launches.length, 2, 'the interrupted launch and the relaunch');
    for (const launch of launches) {
      assert.ok(launch.argv.includes('--restricted'), 'every launch of a restricted run carries --restricted');
      assert.ok(!launch.argv.includes('--allowedTools') && !launch.argv.includes('--plugin-dir'), 'never the contained line');
    }
    assert.deepEqual(rows(f.roots, 'SELECT gate FROM gate_results WHERE run_id = ?', runId), [], 'no gate row');
    assert.deepEqual(rows(f.roots, "SELECT step FROM run_steps WHERE run_id = ? AND step IN ('deps:install', 'checks:validate', 'baseline', 'gsd:configure')", runId), [], 'no preparation step that runs repository code');
    assert.deepEqual(rows(f.roots, 'SELECT evidence_id FROM evidence'), [], 'no check evidence');
    const launchSteps = rows<{ attempt: number; status: string }>(f.roots, "SELECT attempt, status FROM run_steps WHERE run_id = ? AND step = 'launch:run' ORDER BY attempt", runId);
    assert.deepEqual(launchSteps.map((s) => s.status), ['interrupted', 'completed']);
    assert.deepEqual(artifactsOf(f.roots, runId).map((a) => a.kind), ['restricted-patch', 'restricted-plan']);
    const contract = rows<{ body_json: string }>(f.roots, 'SELECT body_json FROM contracts WHERE run_id = ?', runId)[0];
    assert.equal((JSON.parse(contract?.body_json ?? '{}') as { mode?: string }).mode, 'restricted', "the mode is still the contract's");
  });
});

// ---- the restricted launch preflight and descriptor (task 3) ---------------------------------------------------------------------------------

const SETTINGS_DONTASK = JSON.stringify({ permissions: { defaultMode: 'dontAsk' } });

// A settings file in a scratch directory.
function settingsFile(text: string | null): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-restricted-settings-')));
  cleanup.push(dir);
  const file = join(dir, 'host-settings.json');
  if (text !== null) writeFileSync(file, text);
  return file;
}

// A fake `claude` whose `--help` lists the given flags (default: every flag the restricted line uses); an unknown version, since restricted mode asks for none.
function helpHost(helpFlags: readonly string[] = [...RESTRICTED_HELP_FLAGS]): string {
  const fake = makeFakeClaude({ version: '9.9.9 (Claude Code)', helpFlags });
  cleanup.push(fake.dir);
  return fake.bin;
}

function refusedRule(result: Result<unknown>): string {
  assert.ok(!result.ok, 'expected a refusal');
  assert.ok(result.error.kind === 'denied', JSON.stringify(result));
  return result.error.kind === 'denied' ? result.error.rule : '';
}

describe('the restricted launch preflight and descriptor (CON-4, D-12)', () => {
  it('is ready with a claude that lists the flags and settings that deny by default; it asks for no admitted version, no sandbox probe and no hook', () => {
    assert.ok(checkRestrictedLaunchReady({ claudeBin: helpHost(), settingsFile: settingsFile(SETTINGS_DONTASK) }).ok);
  });

  it('refuses when claude is missing', () => {
    const rule = refusedRule(checkRestrictedLaunchReady({ claudeBin: '/nonexistent/claude', settingsFile: settingsFile(SETTINGS_DONTASK) }));
    assert.equal(rule, 'enforcement_failure:host-unavailable');
  });

  it('refuses when --restricted is absent from --help, with this exact rule text', () => {
    const rule = refusedRule(checkRestrictedLaunchReady({ claudeBin: helpHost(RESTRICTED_HELP_FLAGS.filter((flag) => flag !== '--restricted')), settingsFile: settingsFile(SETTINGS_DONTASK) }));
    assert.equal(rule, 'enforcement_failure:host-flag-missing:--restricted');
  });

  it('refuses when --help no longer lists another flag the restricted line uses, naming it', () => {
    for (const flag of RESTRICTED_HELP_FLAGS.filter((f) => f !== '--restricted')) {
      const rule = refusedRule(checkRestrictedLaunchReady({ claudeBin: helpHost(RESTRICTED_HELP_FLAGS.filter((f) => f !== flag)), settingsFile: settingsFile(SETTINGS_DONTASK) }));
      assert.equal(rule, `enforcement_failure:host-flag-missing:${flag}`);
    }
  });

  it('refuses when the settings file is missing, invalid, or lacks permissions.defaultMode dontAsk', () => {
    const claudeBin = helpHost();
    assert.equal(refusedRule(checkRestrictedLaunchReady({ claudeBin, settingsFile: settingsFile(null) })), 'enforcement_failure:settings-missing');
    assert.equal(refusedRule(checkRestrictedLaunchReady({ claudeBin, settingsFile: settingsFile('{not json') })), 'enforcement_failure:settings-invalid');
    assert.equal(refusedRule(checkRestrictedLaunchReady({ claudeBin, settingsFile: settingsFile('{}') })), 'enforcement_failure:settings-key:permissions.defaultMode');
    assert.equal(refusedRule(checkRestrictedLaunchReady({ claudeBin, settingsFile: settingsFile(JSON.stringify({ permissions: { defaultMode: 'acceptEdits' } })) })), 'enforcement_failure:settings-key:permissions.defaultMode');
  });

  it('describes the restricted adapter as enforcement restricted, with capabilities that exclude shell execution and contained invocation', () => {
    const fake = helpHost();
    const adapter = new ClaudeHostAdapter({ mode: 'restricted', claudeBin: fake, hookEntry: '/nonexistent/hook.ts', ledgerPath: '/nonexistent/state.db', dataRoot: '/nonexistent', gsd: { gsdCoreDir: '/x', agentsDir: '/x', skillsRoot: '/x' }, artifacts: {} as never, staging: {} as never, countHookDenies: () => ({ ok: true, value: { total: 0, budget: 0 } }) });
    const descriptor = adapter.descriptor;
    assert.equal(descriptor.attributes?.['enforcement'], 'restricted');
    assert.equal(descriptor.capabilities['restricted-invocation'], true);
    assert.ok(!('contained-invocation' in descriptor.capabilities) || descriptor.capabilities['contained-invocation'] === false, 'not a contained invocation');
    assert.ok(!Object.keys(descriptor.capabilities).some((name) => /shell|bash|exec|command/i.test(name) && descriptor.capabilities[name] === true), 'no shell execution capability');
    // Not ready: the descriptor says none, with the probe that failed.
    const stale = new ClaudeHostAdapter({ mode: 'restricted', claudeBin: helpHost(['--settings']), hookEntry: '/nonexistent/hook.ts', ledgerPath: '/nonexistent/state.db', dataRoot: '/nonexistent', gsd: { gsdCoreDir: '/x', agentsDir: '/x', skillsRoot: '/x' }, artifacts: {} as never, staging: {} as never, countHookDenies: () => ({ ok: true, value: { total: 0, budget: 0 } }) });
    assert.equal(stale.descriptor.attributes?.['enforcement'], 'none');
    assert.equal(stale.descriptor.attributes?.['reason'], 'enforcement_failure:host-flag-missing:--restricted');
  });

  it('judges the restricted argv: the generated line passes, and a line without --restricted or with a tool grant is refused', () => {
    const line = restrictedLaunchArgs({ prompt: 'plan it', settingsFile: '/s/host-settings.json', mcpFile: '/s/mcp.json', model: 'sonnet', costCapUsd: 1.5, sessionId: '00000000-0000-4000-8000-000000000000' });
    assert.ok(assertRestrictedLaunchArgsSafe(line).ok);
    const refused = (argv: readonly string[]): string => {
      const result = assertRestrictedLaunchArgsSafe(argv);
      assert.ok(!result.ok);
      return result.error.kind === 'denied' ? result.error.rule : '';
    };
    assert.match(refused(line.filter((token) => token !== '--restricted')), /^launch_args:restricted:--restricted is required/);
    assert.match(refused([...line, '--allowedTools', 'Bash']), /^launch_args:restricted:--allowedTools/);
    assert.match(refused([...line, '--tools', 'Bash']), /^launch_args:restricted:--tools/);
    assert.match(refused([...line, '--dangerously-skip-permissions']), /^launch_args:restricted:--dangerously-skip-permissions/);
    assert.match(refused(line.map((token) => (token === 'dontAsk' ? 'acceptEdits' : token))), /^launch_args:restricted:permission-mode/);
    assert.match(refused(line.filter((token) => token !== '--strict-mcp-config')), /^launch_args:restricted:strict-mcp-config/);
  });

  it('start --restricted with a claude that does not list --restricted exits 3 with enforcement_failure:host-flag-missing:--restricted, and stores no run', () => {
    const f = fixture({ helpFlags: RESTRICTED_HELP_FLAGS.filter((flag) => flag !== '--restricted') });
    const r = start(f, '--restricted', '--wait');
    assert.equal(r.code, 3, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /enforcement_failure:host-flag-missing:--restricted/);
    assert.equal(f.fake.started(), false, 'no invocation started');
    assert.deepEqual(rows(f.roots, "SELECT run_id FROM runs WHERE state != 'onboarding'"), [], 'no run was stored');
  });
});
