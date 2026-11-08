// ONB-10 active validation of the declared checks, and the D-12 baseline (plan 02-14; ONB-10, AUT-8, FR-5, CON-8; SC 1, SC 4). The fake run host
// plays the unit; everything else is real: git, the validation clone, the sandboxed checks, the ledger, G2 and G4. No test calls a real model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { validateChecks } from '../../src/app/check-validation.ts';
import { SandboxedExecutor } from '../../src/adapters/exec/sandboxed-executor.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { err } from '../../src/domain/result.ts';
import type { RunContract } from '../../src/domain/run-contract.ts';
import type { CommandExecutor } from '../../src/ports/command-executor.ts';
import { startRun } from '../../src/app/run-start.ts';
import { FakeRunHost } from '../helpers/fake-run-host.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import {
  CHECK_SCRIPTS,
  FIXED_SLUG,
  RUN_BRIEF,
  RUN_CONVENTIONS_WITH_FORMAT,
  briefTargeting,
  commitConventions,
  ledgerRows,
  makeRunRepoWithFormat,
  onboardRunRepo,
  profileEnv,
  runInProcess,
  startWithFakeRunHost,
  writeBrief,
} from '../helpers/run-fixtures.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const FIX: FakeRunOptions = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' };

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  pin: string;
}

// An onboarded repository with the given conventions committed on top of the pin (D-16).
export function fixture(conventions: unknown = RUN_CONVENTIONS_WITH_FORMAT, extraFiles: Readonly<Record<string, string>> = {}): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepoWithFormat(extraFiles);
  cleanup.push(roots.base, repo.base);
  const pin = onboardRunRepo(roots, repo);
  commitConventions(repo, conventions);
  return { roots, repo, pin };
}

function start(f: Fixture, briefText: string, run: FakeRunOptions = FIX, name = 'brief.md'): CliResult {
  const brief = writeBrief(join(f.roots.base, 'briefs'), briefText, name);
  return startWithFakeRunHost(f.roots, f.repo, brief, run as Record<string, unknown>);
}

const runIdOf = (stdout: string): string => /^run (run_[0-9A-Z]{26}): /m.exec(stdout)?.[1] as string;

interface EvidenceDb {
  name: string;
  kind: string;
  status: string;
  revision: string;
  environment_json: string;
}
const evidenceOf = (f: Fixture, runId: string, label: string): EvidenceDb[] =>
  ledgerRows<EvidenceDb>(
    f.roots,
    "SELECT e.name, e.kind, e.status, e.revision, e.environment_json FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ? AND e.kind = 'check' ORDER BY e.rowid",
    runId,
  ).filter((e) => (JSON.parse(e.environment_json) as { label: string }).label === label);

const environmentOf = (e: EvidenceDb): Record<string, unknown> => JSON.parse(e.environment_json) as Record<string, unknown>;

const validationsOf = (f: Fixture): Array<{ name: string; verdict: string; detail_json: string }> =>
  ledgerRows(f.roots, 'SELECT name, verdict, detail_json FROM check_validations ORDER BY rowid');

const stepOf = (f: Fixture, runId: string, step: string): { status: string; result: Record<string, unknown> } | undefined => {
  const row = ledgerRows<{ status: string; result_json: string }>(f.roots, 'SELECT status, result_json FROM run_steps WHERE run_id = ? AND step = ?', runId, step)[0];
  return row === undefined ? undefined : { status: row.status, result: JSON.parse(row.result_json) as Record<string, unknown> };
};

describe('a run whose untargeted check already fails at the pin reaches ready_for_review (tracer, D-12, AUT-8)', () => {
  const f = fixture();
  const result = start(f, RUN_BRIEF);
  const runId = runIdOf(result.stdout);

  it('exits 0 at ready_for_review', () => {
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.match(result.stdout.trim().split('\n').at(-1) as string, /ready_for_review$/);
  });

  it('validated both declared checks as active, in declared order, before any invocation', () => {
    assert.deepEqual(validationsOf(f).map((v) => [v.name, v.verdict]), [['test', 'active'], ['format', 'active']]);
    const steps = ledgerRows<{ step: string }>(f.roots, 'SELECT step FROM run_steps WHERE run_id = ? ORDER BY rowid', runId).map((s) => s.step);
    assert.ok(steps.indexOf('checks:validate') < steps.indexOf('baseline'), 'validation before the baseline');
    assert.ok(steps.indexOf('baseline') < steps.indexOf('launch:run'), 'the baseline before the unit');
    const validated = stepOf(f, runId, 'checks:validate');
    assert.equal(validated?.status, 'completed');
    assert.deepEqual((validated?.result['checks'] as Array<{ name: string; verdict: string }>).map((c) => [c.name, c.verdict]), [['test', 'active'], ['format', 'active']]);
  });

  it('records each check at the pin: test failed (the bug), format failed', () => {
    const base = evidenceOf(f, runId, 'base');
    assert.deepEqual(base.map((e) => [e.name, e.status]), [['test', 'failed'], ['format', 'failed']]);
    assert.equal(stepOf(f, runId, 'baseline')?.status, 'completed');
  });

  it('records the final evidence: test passed, format failed and flagged preExisting; G4 passed', () => {
    const final = evidenceOf(f, runId, 'final');
    assert.deepEqual(final.map((e) => [e.name, e.status]), [['test', 'passed'], ['format', 'failed']]);
    assert.equal(environmentOf(final[0] as EvidenceDb)['preExisting'], undefined);
    assert.equal(environmentOf(final[1] as EvidenceDb)['preExisting'], true);
    const gates = ledgerRows<{ gate: string; passed: number }>(f.roots, "SELECT gate, passed FROM gate_results WHERE run_id = ? AND gate IN ('G2', 'G4') ORDER BY rowid", runId);
    assert.deepEqual(gates.map((g) => [g.gate, g.passed]), [['G2', 1], ['G4', 1]]);
  });

  it('lists the pre-existing failure in the ready_for_review transition', () => {
    const events = ledgerRows<{ data_json: string }>(f.roots, "SELECT data_json FROM events WHERE run_id = ? AND type = 'run.transition' ORDER BY seq", runId);
    const last = JSON.parse(events.at(-1)?.data_json as string) as Record<string, unknown>;
    assert.equal(last['to'], 'ready_for_review');
    assert.equal(last['preExisting'], 'format');
  });

  it('opens one attempt for the whole run: the baseline opens it and the unit adopts it', () => {
    const attempts = ledgerRows<{ reason: string; outcome: string }>(f.roots, 'SELECT reason, outcome FROM attempts WHERE run_id = ?', runId);
    assert.deepEqual(attempts.map((a) => [a.reason, a.outcome]), [['initial', 'handed-off']]);
  });

  it('a second run on the same pin and checks reuses the two verdicts and adds no validation row', () => {
    const second = start(f, RUN_BRIEF, FIX, 'second.md');
    assert.equal(second.code, 0, second.stderr + second.stdout);
    const secondId = runIdOf(second.stdout);
    assert.notEqual(secondId, runId);
    assert.equal(validationsOf(f).length, 2, 'no new check_validations row');
    assert.equal(stepOf(f, secondId, 'checks:validate')?.result['reused'], 2);
  });
});

describe('a brief that targets the check that fails at the pin blocks the run (D-12)', () => {
  const f = fixture();
  const result = start(f, briefTargeting('test', 'format'));
  const runId = runIdOf(result.stdout);

  it('ends blocked_on_decision (decision) with a checks-delta failure naming format as target-not-passed, and no branch', () => {
    assert.equal(result.code, 3, result.stderr + result.stdout);
    const run = ledgerRows<{ state: string; reason: string }>(f.roots, 'SELECT state, reason FROM runs WHERE run_id = ?', runId)[0];
    assert.deepEqual([run?.state, run?.reason], ['blocked_on_decision', 'decision']);
    // G2 holds the checks delta (docs/contracts-and-state.md), so the failing target stops the unit there, before the commit.
    const gate = ledgerRows<{ gate: string; failures_json: string }>(f.roots, "SELECT gate, failures_json FROM gate_results WHERE run_id = ? AND passed = 0", runId)[0];
    assert.equal(gate?.gate, 'G2');
    assert.match(gate?.failures_json as string, /checks-delta/);
    assert.match(gate?.failures_json as string, /format \(target-not-passed\)/);
    assert.equal(ledgerRows(f.roots, 'SELECT 1 FROM run_steps WHERE run_id = ? AND step = ?', runId, 'commit').length, 0, 'nothing was committed');
  });
});

// ---- Task 2: rejections, caching, declared output locations (ONB-10, CON-8) -------------------------------------------------------------------

const TEST_CHECK = { name: 'test', argv: ['npm', 'test'], timeoutSec: 120, required: true };
const conventionsOf = (...checks: unknown[]): Record<string, unknown> => ({
  schema: 1,
  checks: [TEST_CHECK, ...checks],
  paths: { write: ['src/**', 'test/**'], protected: [], artifacts: [] },
  agentCommands: ['npm test'],
});
const node = (name: string, script: string, args: readonly string[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  name,
  argv: ['node', `scripts/${script}`, ...args],
  timeoutSec: 60,
  required: false,
  ...extra,
});

const validationOf = (f: Fixture, name: string): { verdict: string; detail: Record<string, unknown> } | undefined => {
  const row = validationsOf(f).find((v) => v.name === name);
  return row === undefined ? undefined : { verdict: row.verdict, detail: JSON.parse(row.detail_json) as Record<string, unknown> };
};

describe('a required check that writes where it did not declare is rejected, and the run stops before any invocation (ONB-10, T-02-45)', () => {
  const f = fixture(conventionsOf(node('writer', 'write-file.mjs', ['out/x.txt'], { required: true })), CHECK_SCRIPTS);
  const result = start(f, RUN_BRIEF);
  const runId = runIdOf(result.stdout);

  it('records `rejected` with reason unexpected-write and the path, and activates nothing', () => {
    assert.deepEqual(validationOf(f, 'writer'), { verdict: 'rejected', detail: { reason: 'unexpected-write', paths: ['out/x.txt'] } });
    assert.equal(validationOf(f, 'test')?.verdict, 'active', 'the other check was still judged on its own');
  });

  it('blocks in blocked_on_decision (decision) with a permission decision naming the check, before any launch or baseline', () => {
    assert.equal(result.code, 3, result.stderr + result.stdout);
    const run = ledgerRows<{ state: string; reason: string }>(f.roots, 'SELECT state, reason FROM runs WHERE run_id = ?', runId)[0];
    assert.deepEqual([run?.state, run?.reason], ['blocked_on_decision', 'decision']);
    const decision = ledgerRows<{ class: string; issue: string }>(f.roots, 'SELECT class, issue FROM decisions WHERE run_id = ?', runId);
    assert.equal(decision.length, 1);
    assert.equal(decision[0]?.class, 'permission');
    assert.match(decision[0]?.issue as string, /required check writer .*outside its declared paths \(out\/x\.txt\)/);
    const steps = ledgerRows<{ step: string }>(f.roots, 'SELECT step FROM run_steps WHERE run_id = ?', runId).map((s) => s.step);
    assert.ok(!steps.includes('launch:run') && !steps.includes('baseline'), `no launch or baseline step, got ${steps.join(',')}`);
    assert.equal(stepOf(f, runId, 'checks:validate')?.status, 'failed');
    assert.equal(evidenceOf(f, runId, 'base').length, 0, 'no repository check ran for evidence');
  });

  it('the run row names its clone although it never reached running', () => {
    const run = ledgerRows<{ workspace_path: string | null; branch: string | null }>(f.roots, 'SELECT workspace_path, branch FROM runs WHERE run_id = ?', runId)[0];
    assert.match(run?.workspace_path as string, /\/clone$/);
    assert.equal(run?.branch, `avarice/${runId}`);
  });
});

describe('verdicts of every kind of declared check, in declared order, and an optional rejection leaves the run going', () => {
  const f = fixture(
    conventionsOf(
      node('dist-ok', 'write-file.mjs', ['dist/a.js'], { writes: ['dist/**'] }),
      node('dist-evil', 'write-file.mjs', ['dist-evil/x'], { writes: ['dist/**'] }),
      node('quiet', 'net-proxy.mjs', ['registry.invalid:443'], { writes: [] }),
      node('direct', 'net-direct.mjs', ['direct.invalid']),
      node('noop', 'write-file.mjs', ['node_modules/.cache/z'], { writes: ['node_modules/.cache/**'] }),
    ),
    { ...CHECK_SCRIPTS, '.gitignore': 'node_modules/\n' },
  );
  const result = start(f, RUN_BRIEF);
  const runId = runIdOf(result.stdout);

  it('active: declared writes under dist/** (also into an ignored directory), and a check that writes nothing', () => {
    assert.equal(validationOf(f, 'dist-ok')?.verdict, 'active');
    assert.equal(validationOf(f, 'noop')?.verdict, 'active', 'a write into an ignored declared path is declared');
    assert.equal(validationOf(f, 'test')?.verdict, 'active', 'a check with no declared writes that writes nothing is active, although it fails at the pin');
  });

  it('adjacency: dist-evil/x is not under dist/** and is rejected naming it', () => {
    assert.deepEqual(validationOf(f, 'dist-evil'), { verdict: 'rejected', detail: { reason: 'unexpected-write', paths: ['dist-evil/x'] } });
  });

  it('network by proxy: a CONNECT to a remote host is seen by the empty-allowlist proxy and names the host', () => {
    assert.deepEqual(validationOf(f, 'quiet'), { verdict: 'rejected', detail: { reason: 'network', hosts: ['registry.invalid'] } });
  });

  it('network by error text: a direct connect that fails in the sandbox is rejected network', () => {
    const verdict = validationOf(f, 'direct');
    assert.equal(verdict?.verdict, 'rejected');
    assert.equal(verdict?.detail['reason'], 'network');
    assert.deepEqual(verdict?.detail['hosts'], ['direct.invalid']);
  });

  it('ordering: verdicts and `check.validated` events follow the declared order', () => {
    const declared = ['test', 'dist-ok', 'dist-evil', 'quiet', 'direct', 'noop'];
    assert.deepEqual(validationsOf(f).map((v) => v.name), declared);
    const events = ledgerRows<{ data_json: string }>(f.roots, "SELECT data_json FROM events WHERE run_id = ? AND type = 'check.validated' ORDER BY seq", runId);
    assert.deepEqual(events.map((e) => (JSON.parse(e.data_json) as { name: string }).name), declared);
    const validated = stepOf(f, runId, 'checks:validate');
    assert.deepEqual((validated?.result['checks'] as Array<{ name: string }>).map((c) => c.name), declared);
  });

  it('an optional check that is rejected does not stop the run, and is absent from every run of the checks', () => {
    assert.equal(result.code, 0, result.stderr + result.stdout);
    const names = new Set(ledgerRows<{ name: string }>(f.roots, "SELECT name FROM evidence WHERE kind = 'check'").map((e) => e.name));
    assert.deepEqual([...names], ['test']);
  });
});

describe('a check whose argv changed re-validates, and the unchanged one is reused (ONB-10)', () => {
  const f = fixture();
  const first = start(f, RUN_BRIEF);
  const [test, format] = RUN_CONVENTIONS_WITH_FORMAT.checks;
  commitConventions(f.repo, { ...RUN_CONVENTIONS_WITH_FORMAT, checks: [test, { ...format, argv: ['node', 'scripts/format-check.mjs', '--again'] }] });
  const second = start(f, RUN_BRIEF, FIX, 'second.md');

  it('adds exactly one verdict row, for the edited check, and reuses the other', () => {
    assert.equal(first.code, 0, first.stderr + first.stdout);
    assert.equal(second.code, 0, second.stderr + second.stdout);
    assert.deepEqual(validationsOf(f).map((v) => [v.name, v.verdict]), [['test', 'active'], ['format', 'active'], ['format', 'active']]);
    const result = stepOf(f, runIdOf(second.stdout), 'checks:validate')?.result;
    assert.equal(result?.['reused'], 1);
    assert.deepEqual((result?.['checks'] as Array<{ name: string; reused: boolean }>).map((c) => [c.name, c.reused]), [['test', true], ['format', false]]);
  });
});

describe('unavailable: nothing is known, so nothing is cached, and a required check blocks as an enforcement failure', () => {
  it('a sandbox that cannot run (sandbox-exec forced to /usr/bin/false) gives `unavailable` for every check and records no verdict', async () => {
    const f = fixture();
    const brief = writeBrief(join(f.roots.base, 'briefs'), RUN_BRIEF);
    const composed = createDeps(profileEnv(f.roots), { host: new FakeRunHost({}), executor: new SandboxedExecutor({ sandboxExecPath: '/usr/bin/false' }) });
    assert.ok(composed.ok);
    try {
      const started = startRun(composed.value.deps, { cwd: f.repo.path, briefPath: brief, policy: 'routine', budgetOverrides: {} });
      assert.ok(started.ok, JSON.stringify(started));
      const run = composed.value.deps.ledger.getRun(started.value.runId);
      const contract = composed.value.deps.ledger.getRunContract(started.value.runId);
      assert.ok(run.ok && contract.ok && contract.value !== null);
      const report = await validateChecks(composed.value.deps, run.value, contract.value.body as RunContract);
      assert.ok(report.ok, JSON.stringify(report));
      assert.deepEqual(report.value.outcomes.map((o) => [o.name, o.verdict, o.detail.reason]), [['test', 'unavailable', 'sandbox-unavailable'], ['format', 'unavailable', 'sandbox-unavailable']]);
    } finally {
      composed.value.close();
    }
    assert.equal(validationsOf(f).length, 0, 'an unavailable verdict is not cached');
  });

  it('a whole run whose validation cannot run ends blocked (enforcement_failure), with no verdict cached and no unit launched', async () => {
    const f = fixture();
    const brief = writeBrief(join(f.roots.base, 'briefs'), RUN_BRIEF);
    const real = new SandboxedExecutor();
    // Everything but the validation clone runs for real (configuring GSD needs the sandbox too).
    const selective: CommandExecutor = { descriptor: real.descriptor, run: (cmd, signal) => (cmd.cwd.endsWith('/validate') ? Promise.resolve(err({ kind: 'unavailable', cause: 'forced' })) : real.run(cmd, signal)) };
    const ran = await runInProcess(f.roots, f.repo, brief, FIX, { executor: selective });
    assert.deepEqual([ran.state, ran.reason], ['blocked_on_decision', 'enforcement_failure']);
    assert.equal(validationsOf(f).length, 0);
    assert.equal(ran.host.calls.length, 0, 'no invocation');
  });
});

describe('a run-time check may write only its declared paths and the scratch directory (CON-8)', () => {
  const f = fixture(conventionsOf(node('cwdwriter', 'cwd-write.mjs', [], { required: true })), CHECK_SCRIPTS);
  const result = start(f, RUN_BRIEF);
  const runId = runIdOf(result.stdout);

  it('passes validation (it writes nothing in the validation clone) and then fails in the run clone under the sandbox', () => {
    assert.equal(validationOf(f, 'cwdwriter')?.verdict, 'active');
    const base = evidenceOf(f, runId, 'base').find((e) => e.name === 'cwdwriter');
    assert.equal(base?.status, 'failed');
  });

  it('records the refusal in the check output artifact, and leaves no out/x.txt in the clone', () => {
    const digest = ledgerRows<{ artifact_digest: string }>(f.roots, "SELECT e.artifact_digest FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ? AND e.name = 'cwdwriter' ORDER BY e.rowid", runId)[0]?.artifact_digest as string;
    const composed = createDeps(profileEnv(f.roots), {}, { readOnly: true });
    assert.ok(composed.ok);
    try {
      const bytes = composed.value.deps.artifacts.get(digest);
      assert.ok(bytes.ok);
      assert.match(new TextDecoder().decode(bytes.value), /EPERM|operation not permitted/i);
    } finally {
      composed.value.close();
    }
    const clone = ledgerRows<{ workspace_path: string }>(f.roots, 'SELECT workspace_path FROM runs WHERE run_id = ?', runId)[0]?.workspace_path as string;
    assert.equal(existsSync(join(clone, 'out', 'x.txt')), false);
  });
});

describe('a secret printed by a check is stored redacted (R-WR-03, T-02-115)', () => {
  const FAKE_KEY = 'AKIAABCDEFGHIJKLMNOP';
  const f = fixture(conventionsOf(node('leaky', 'print-secret.mjs', [FAKE_KEY], { required: true })), {
    ...CHECK_SCRIPTS,
    'scripts/print-secret.mjs': "console.log('token ' + process.argv[2]);\nconsole.error('again ' + process.argv[2]);\n",
  });
  const result = start(f, RUN_BRIEF);
  const runId = runIdOf(result.stdout);

  it('stores the check output with a redaction marker and without the key id', () => {
    const digests = ledgerRows<{ artifact_digest: string }>(f.roots, "SELECT e.artifact_digest FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ? AND e.name = 'leaky' ORDER BY e.rowid", runId);
    assert.ok(digests.length > 0, `the leaky check ran and left evidence: ${result.stderr}${result.stdout}`);
    const composed = createDeps(profileEnv(f.roots), {}, { readOnly: true });
    assert.ok(composed.ok);
    try {
      for (const { artifact_digest: digest } of digests) {
        const bytes = composed.value.deps.artifacts.get(digest);
        assert.ok(bytes.ok);
        const text = new TextDecoder().decode(bytes.value);
        assert.match(text, /\[REDACTED:/);
        assert.equal(text.includes(FAKE_KEY), false, 'the key id is stored raw');
      }
    } finally {
      composed.value.close();
    }
  });
});
