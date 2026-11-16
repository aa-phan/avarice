// A required check that needs its declared environment must be listed to the unit with that environment (plan 03-64; AUT-16, AUT-1, CON-15; the owner's product-defect ruling on
// run 2's attempt 2, D-26, D-27). Scenario E is run 2's attempt 2 offline: the required `site` check passes only with SITE_ORIGIN set, as the portfolio's `build` passes only with
// VITE_SITE_ORIGIN. The fake run host plays the unit, which runs the command its prompt lists for the check, through the real hook and under the environment the real host adapter
// builds, and reports human_needed when that command fails (as the 03-63 unit did). Git, the sandboxed checks, the hook, the ledger, the gates and the supervisor are real. No test
// calls a real model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { decisionsOf } from '../helpers/independent-work.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { FIXED_SLUG, RUN_BRIEF, RUN_CONVENTIONS, commitConventions, ledgerRows, makeRunRepo, onboardRunRepo, startWithFakeRunHost, writeBrief } from '../helpers/run-fixtures.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

// A script that exits 0 only when SITE_ORIGIN equals the declared value (the shape of the portfolio's build, which stops at config load without VITE_SITE_ORIGIN).
const NEEDS_ENV_SCRIPT = [
  "if (process.env.SITE_ORIGIN === 'https://example.test') process.exit(0);",
  "process.stderr.write('SITE_ORIGIN is not set\\n');",
  'process.exit(1);',
  '',
].join('\n');

const SITE_CHECK = { name: 'site', argv: ['node', 'scripts/needs-env.mjs'], timeoutSec: 60, required: true, env: { SITE_ORIGIN: 'https://example.test' } };
const CONVENTIONS = { ...RUN_CONVENTIONS, checks: [...RUN_CONVENTIONS.checks, SITE_CHECK], agentCommands: ['npm test'] };

// The command the check is listed under, written as a literal on purpose: the test imports nothing new from src, so a missing export is never the reason it fails.
const LISTED = 'SITE_ORIGIN=https://example.test node scripts/needs-env.mjs';
const BARE = 'node scripts/needs-env.mjs';
const COMMANDS_LINE = 'Commands you may run, exactly as written:';

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  brief: string;
  recordTo: string;
}

function fixture(): Fixture {
  const roots = makeRoots();
  // The slug is not fixed at the pin: the target check `test` fails there and the unit's edit makes it pass, as in scenario R of run-baseline-red-verification.
  const repo = makeRunRepo({ 'scripts/needs-env.mjs': NEEDS_ENV_SCRIPT });
  const scratch = mkdtempSync(join(tmpdir(), 'avarice-check-env-'));
  cleanup.push(roots.base, repo.base, scratch);
  onboardRunRepo(roots, repo);
  commitConventions(repo, CONVENTIONS);
  return { roots, repo, brief: writeBrief(join(roots.base, 'briefs'), RUN_BRIEF), recordTo: join(scratch, 'prompt.json') };
}

const runIdOf = (stdout: string): string => /^run (run_[0-9A-Z]{26}): /m.exec(stdout)?.[1] as string;

interface Recorded {
  prompt: string;
  listed?: { command: string; denied: boolean; exitCode: number | null };
}
const recorded = (f: Fixture): Recorded => JSON.parse(readFileSync(f.recordTo, 'utf8')) as Recorded;

// The bullet lines under 'Commands you may run, exactly as written:', in order.
function listedCommands(prompt: string): string[] {
  const lines = prompt.split('\n');
  const at = lines.indexOf(COMMANDS_LINE);
  const out: string[] = [];
  for (let i = at + 1; at >= 0 && i < lines.length && (lines[i] as string).startsWith('- '); i += 1) out.push(lines[i] as string);
  return out;
}

const classifyOf = (f: Fixture, runId: string): Record<string, unknown> =>
  JSON.parse(ledgerRows<{ result_json: string }>(f.roots, "SELECT result_json FROM run_steps WHERE run_id = ? AND step = 'classify'", runId)[0]?.result_json ?? '{}') as Record<string, unknown>;

const hookDecisions = (f: Fixture, runId: string): Array<Record<string, unknown>> =>
  ledgerRows<{ data_json: string }>(f.roots, "SELECT data_json FROM events WHERE run_id = ? AND type = 'hook.decision' ORDER BY seq", runId).map((row) => JSON.parse(row.data_json) as Record<string, unknown>);

// The unit stands in for the 03-63 unit: it plays the slug edit, runs the command its prompt lists for `site`, and reports human_needed when that command fails.
const unitOf = (f: Fixture): FakeRunOptions => ({
  edits: { 'src/slug.ts': FIXED_SLUG },
  summary: true,
  runListedCommand: { command: BARE, otherwise: 'human_needed' },
  recordTo: f.recordTo,
});

describe('scenario E: a required check that passes only with its declared environment (run 2 attempt 2, offline)', () => {
  const f = fixture();
  const result = startWithFakeRunHost(f.roots, f.repo, f.brief, unitOf(f) as Record<string, unknown>);
  const runId = runIdOf(result.stdout);
  const stop = (): string => `${result.stderr}${result.stdout}\nclassify: ${JSON.stringify(classifyOf(f, runId))}`;

  it('exits 0 at ready_for_review', () => {
    assert.equal(result.code, 0, stop());
    assert.match(result.stdout.trim().split('\n').at(-1) as string, /ready_for_review$/);
  });

  it('holds no decision for the run, G2 passed for item A, and item A\'s G2 evidence row for `site` passed', () => {
    assert.deepEqual(decisionsOf(f.roots, runId).map((d) => d.class), [], stop());
    const g2 = ledgerRows<{ passed: number }>(f.roots, "SELECT passed FROM gate_results WHERE run_id = ? AND gate = 'G2' ORDER BY rowid", runId);
    assert.deepEqual(g2.map((g) => g.passed), [1]);
    const rows = ledgerRows<{ name: string; status: string; environment_json: string }>(
      f.roots,
      "SELECT e.name, e.status, e.environment_json FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ? AND e.kind = 'check' AND e.work_item = 'A' ORDER BY e.rowid",
      runId,
    ).filter((e) => (JSON.parse(e.environment_json) as { label?: string }).label === 'g2');
    assert.deepEqual(rows.map((r) => [r.name, r.status]), [['test', 'passed'], ['site', 'passed']]);
  });

  it('listed the check to the unit with its environment, and not as the bare command', () => {
    const bullets = listedCommands(recorded(f).prompt);
    assert.ok(bullets.includes(`- ${LISTED}`), `the prompt lists ${JSON.stringify(bullets)}`);
    assert.equal(bullets.includes(`- ${BARE}`), false, 'the bare form is not listed');
  });

  it('shows the listed command admitted by the hook and run to exit code 0, under an agent-command allow', () => {
    assert.deepEqual(recorded(f).listed, { command: LISTED, denied: false, exitCode: 0 });
    assert.ok(hookDecisions(f, runId).some((d) => d['decision'] === 'allow' && d['rule'] === 'agent-command'), 'an allow with rule agent-command');
  });
});

// Scenario N (T-03-172): the unit tries the check under other environments through the real hook, and none of them runs. The `ls src` between them is admitted, so the hook's loop limit
// (three denials in a row) is never reached; then the unit runs its listed command as in scenario E and the run still reaches ready_for_review.
describe('scenario N: an environment other than the listed one is refused and never runs', () => {
  const f = fixture();
  const OTHER = 'SITE_ORIGIN=https://other.test node scripts/needs-env.mjs';
  const REORDERED = 'SITE_ORIGIN=https://example.test NODE_OPTIONS=--version node scripts/needs-env.mjs';
  const unit: FakeRunOptions = { ...unitOf(f), shellAttempts: [BARE, 'ls src', OTHER, 'ls src', REORDERED] };
  const result = startWithFakeRunHost(f.roots, f.repo, f.brief, unit as Record<string, unknown>);
  const runId = runIdOf(result.stdout);
  const stop = (): string => `${result.stderr}${result.stdout}\nclassify: ${JSON.stringify(classifyOf(f, runId))}`;

  it('exits 0 at ready_for_review with no decision', () => {
    assert.equal(result.code, 0, stop());
    assert.match(result.stdout.trim().split('\n').at(-1) as string, /ready_for_review$/);
    assert.deepEqual(decisionsOf(f.roots, runId).map((d) => d.class), [], stop());
  });

  it('shows the three attempts denied with exit code null (they never ran), the two `ls src` admitted, and the listed command admitted and run to exit code 0', () => {
    const record = recorded(f) as Recorded & { shell?: Array<{ command: string; denied: boolean; exitCode: number | null }> };
    assert.deepEqual(record.shell?.map((s) => [s.command, s.denied, s.exitCode === null]), [
      [BARE, true, true],
      ['ls src', false, false],
      [OTHER, true, true],
      ['ls src', false, false],
      [REORDERED, true, true],
    ]);
    assert.deepEqual(record.listed, { command: LISTED, denied: false, exitCode: 0 });
  });

  it('recorded at least three shell-not-allowed denials and no loop.limit event', () => {
    const denies = hookDecisions(f, runId).filter((d) => d['decision'] === 'deny' && d['rule'] === 'shell-not-allowed');
    assert.ok(denies.length >= 3, `${denies.length} shell-not-allowed denials`);
    const loops = ledgerRows<{ n: number }>(f.roots, "SELECT count(*) AS n FROM events WHERE run_id = ? AND type = 'loop.limit'", runId);
    assert.equal(loops[0]?.n, 0);
  });
});
