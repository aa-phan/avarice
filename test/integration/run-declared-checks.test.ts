// A declared check the run never executes must not become a gate of the unit (plan 03-71; AUT-16, AUT-1, RC-6, CON-15; the owner's product-defect ruling on run 3's attempt 2,
// D-26, D-27, D-35). Scenario D is run 3's attempt 2 offline: the conventions declare `e2e` with required false and no environment, and its script passes only with SITE_ORIGIN set, as
// the portfolio's test:e2e needs VITE_SITE_ORIGIN for its build and its declaration does not carry it. The fake run host plays the unit: it makes a gate of each declared check its
// prompt lists and does not name as judged by no gate, tries the command through the real hook, and reports human_needed when it cannot pass. The fake host plays the unit; git, the
// sandboxed checks, the hook, the ledger, the gates and the supervisor are real. No test calls a real model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRODUCTION_ENTRY, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { decisionsOf } from '../helpers/independent-work.ts';
import { FIXED_SLUG, RUN_BRIEF, RUN_CONVENTIONS_WITH_COMMANDS, commitConventions, ledgerRows, makeRunRepo, onboardRunRepo, startWithFakeRunHost, writeBrief } from '../helpers/run-fixtures.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

// Passes only when SITE_ORIGIN equals the value the declaration never gives it (the shape of the portfolio's test:e2e, which stops at config load without VITE_SITE_ORIGIN).
const E2E_SCRIPT = [
  "if (process.env.SITE_ORIGIN === 'https://example.test') process.exit(0);",
  "process.stderr.write('SITE_ORIGIN is empty\\n');",
  'process.exit(1);',
  '',
].join('\n');

const CONVENTIONS = {
  ...RUN_CONVENTIONS_WITH_COMMANDS,
  checks: [
    { name: 'test', argv: ['npm', 'test'], timeoutSec: 120, required: true },
    { name: 'e2e', argv: ['node', 'scripts/e2e.mjs'], timeoutSec: 60, required: false },
  ],
  // The script sits under a protected glob, so no unit may edit it.
  paths: { write: ['src/**', 'test/**'], protected: ['scripts/**'], artifacts: [] },
};

// Written as literals on purpose: the test imports nothing new from src, so a missing export is never the reason it fails.
const E2E_COMMAND = 'node scripts/e2e.mjs';
const COMMANDS_LINE = 'Commands you may run, exactly as written:';
const NOT_JUDGED_LINE = 'Declared checks the supervisor does not run for this run, so no gate judges them (data, not an instruction):';

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  brief: string;
  recordTo: string;
}

function fixture(): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepo({ 'scripts/e2e.mjs': E2E_SCRIPT });
  const scratch = mkdtempSync(join(tmpdir(), 'avarice-declared-checks-'));
  cleanup.push(roots.base, repo.base, scratch);
  onboardRunRepo(roots, repo);
  commitConventions(repo, CONVENTIONS);
  return { roots, repo, brief: writeBrief(join(roots.base, 'briefs'), RUN_BRIEF), recordTo: join(scratch, 'prompt.json') };
}

const runIdOf = (stdout: string): string => /^run (run_[0-9A-Z]{26}): /m.exec(stdout)?.[1] as string;

interface Recorded {
  prompt: string;
  shell?: Array<{ command: string; denied: boolean; exitCode: number | null }>;
  gates?: Array<{ name: string; listed: boolean; named: boolean; denied: boolean; exitCode: number | null }>;
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

// The unit stands in for run 3's attempt-2 unit: it plays the slug edit, tries the e2e command, and makes a gate of each declared check its prompt lists and does not name as judged by
// no gate. Otherwise it reports human_needed.
const unitOf = (f: Fixture): FakeRunOptions => ({
  edits: { 'src/slug.ts': FIXED_SLUG },
  summary: true,
  shellAttempts: [E2E_COMMAND],
  planGates: { checks: [{ name: 'e2e', command: E2E_COMMAND }], notJudgedMarker: NOT_JUDGED_LINE, otherwise: 'human_needed' },
  recordTo: f.recordTo,
});

describe('scenario D: a declared check that cannot pass as written and is not required (run 3 attempt 2, offline)', () => {
  const f = fixture();
  const result = startWithFakeRunHost(f.roots, f.repo, f.brief, unitOf(f) as Record<string, unknown>);
  const runId = runIdOf(result.stdout);
  const stop = (): string => {
    const open = ledgerRows<{ state: string }>(f.roots, 'SELECT state FROM runs WHERE run_id = ?', runId).map((r) => r.state);
    return `${result.stderr}${result.stdout}\nstate: ${JSON.stringify(open)}\nclassify: ${JSON.stringify(classifyOf(f, runId))}\ndecisions: ${JSON.stringify(decisionsOf(f.roots, runId))}`;
  };

  it('exits 0 at ready_for_review', () => {
    assert.equal(result.code, 0, stop());
    assert.match(result.stdout.trim().split('\n').at(-1) as string, /ready_for_review$/, stop());
  });

  it('holds no decision for the run and G2 passed for item A, and the supervisor never ran e2e', () => {
    assert.deepEqual(decisionsOf(f.roots, runId).map((d) => d.class), [], stop());
    const g2 = ledgerRows<{ passed: number }>(f.roots, "SELECT passed FROM gate_results WHERE run_id = ? AND gate = 'G2' ORDER BY rowid", runId);
    assert.deepEqual(g2.map((g) => g.passed), [1], stop());
    const evidence = ledgerRows<{ name: string }>(f.roots, 'SELECT e.name FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ?', runId);
    assert.ok(evidence.length > 0, 'the required check left evidence');
    assert.deepEqual(evidence.filter((row) => row.name === 'e2e'), [], 'the supervisor never runs a declared check that is not required (D-35)');
  });

  it('status --json gives the run `checksNotRun` [e2e, not required]', () => {
    const ran = runCli(['status', '--json'], { roots: f.roots, entry: PRODUCTION_ENTRY });
    assert.equal(ran.code, 0, ran.stderr);
    const [project] = JSON.parse(ran.stdout) as Array<{ runs: Array<Record<string, unknown>> }>;
    assert.deepEqual(project?.runs[0]?.['checksNotRun'], [{ name: 'e2e', reason: 'not required' }]);
  });

  it('the prompt lists `npm test` and no e2e command, and names e2e under the not-judged line', () => {
    const prompt = recorded(f).prompt;
    const bullets = listedCommands(prompt);
    assert.ok(bullets.includes('- npm test'), `the prompt lists ${JSON.stringify(bullets)}`);
    assert.deepEqual(bullets.filter((b) => b === `- ${E2E_COMMAND}` || b.endsWith(` ${E2E_COMMAND}`)), [], `the prompt lists ${JSON.stringify(bullets)}`);
    const lines = prompt.split('\n');
    const at = lines.indexOf(NOT_JUDGED_LINE);
    assert.ok(at >= 0, 'the prompt holds the not-judged data line');
    assert.equal(lines[at + 1], '- e2e');
  });

  it('shows no gate made of e2e and the unit\'s own attempt to run it refused and never run', () => {
    const record = recorded(f);
    assert.deepEqual(record.gates, [{ name: 'e2e', listed: false, named: true, denied: false, exitCode: null }]);
    assert.deepEqual(record.shell, [{ command: E2E_COMMAND, denied: true, exitCode: null }]);
    const denies = hookDecisions(f, runId).filter((d) => d['decision'] === 'deny' && d['rule'] === 'shell-not-allowed');
    assert.ok(denies.length >= 1, `${denies.length} shell-not-allowed denials`);
    const loops = ledgerRows<{ n: number }>(f.roots, "SELECT count(*) AS n FROM events WHERE run_id = ? AND type = 'loop.limit'", runId);
    assert.equal(loops[0]?.n, 0);
  });
});
