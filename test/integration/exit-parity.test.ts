// The parity guard of the exit tools (plan 03-65; AUT-16, AUT-1; D-26, D-27, D-29). Run 2 failed twice on a unit-versus-supervisor mismatch: in attempt 1 the unit was not told
// a check was already red (plan 03-61), in attempt 2 it was not given the check's environment (plan 03-64). `exit-run-phase3-tools.ts parity` runs every check the unit is told to
// run twice, offline, on a pinned repository: once as the unit would run it (the exact command the contract lists, judged by the real hook, under the host's environment) and once
// as the supervisor runs it. These tests drive the subcommand on scratch repositories. Git, the sandboxed executor, the hook decision, the run scope and the compiler are real; no
// model host is started and nothing is installed.
//
// Fixture B: `site` passes only with SITE_ORIGIN, a declared environment of the check, so both forms agree (plan 03-64's fix). Fixture A adds `ci`, which passes only with CI=1,
// a variable only the supervisor's sandbox sets: a mismatch. `--with-pre-fix` runs the bare argument vectors the unit was given before plan 03-64: run 2's attempt 2, offline.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RUN_BRIEF, RUN_CONVENTIONS, commitConventions, commitFiles, makeRunRepo, writeBrief } from '../helpers/run-fixtures.ts';
import { REPO_ROOT } from '../helpers/run-cli.ts';
import { git } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const TOOLS = join(REPO_ROOT, 'scripts', 'exit-run-phase3-tools.ts');

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const NEEDS_ENV_SCRIPT = [
  "if (process.env.SITE_ORIGIN === 'https://example.test') process.exit(0);",
  "process.stderr.write('SITE_ORIGIN is not set\\n');",
  'process.exit(1);',
  '',
].join('\n');

const NEEDS_CI_SCRIPT = [
  "if (process.env.CI === '1') process.exit(0);",
  "process.stderr.write('CI is not 1\\n');",
  'process.exit(1);',
  '',
].join('\n');

const LOCKFILE = '{\n  "name": "slugger",\n  "lockfileVersion": 3,\n  "requires": true,\n  "packages": {}\n}\n';
const SITE_CHECK = { name: 'site', argv: ['node', 'scripts/needs-env.mjs'], timeoutSec: 60, required: true, env: { SITE_ORIGIN: 'https://example.test' } };
const CI_CHECK = { name: 'ci', argv: ['node', 'scripts/needs-ci.mjs'], timeoutSec: 60, required: true };
const CONVENTIONS_B = { ...RUN_CONVENTIONS, checks: [...RUN_CONVENTIONS.checks, SITE_CHECK] };
const CONVENTIONS_A = { ...RUN_CONVENTIONS, checks: [...RUN_CONVENTIONS.checks, SITE_CHECK, CI_CHECK] };

interface Fixture {
  repo: ScratchRepo;
  pin: string;
  brief: string;
  dir: string;
}

// The pin holds the scripts and the lockfile; the conventions come in the next commit (a descendant that changes only .avarice/). The working tree has an untracked node_modules.
function fixture(conventions: unknown, withModules = true): Fixture {
  const repo = makeRunRepo({ 'scripts/needs-env.mjs': NEEDS_ENV_SCRIPT, 'scripts/needs-ci.mjs': NEEDS_CI_SCRIPT, 'package-lock.json': LOCKFILE });
  const pin = repo.head;
  commitConventions(repo, conventions);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-parity-test-')));
  cleanup.push(repo.base, dir);
  writeFileSync(join(dir, 'config.json'), `${JSON.stringify(conventions, null, 2)}\n`);
  if (withModules) {
    mkdirSync(join(repo.path, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(repo.path, 'node_modules', '.package-lock.json'), '{}\n');
    writeFileSync(join(repo.path, 'node_modules', 'dep', 'index.js'), 'module.exports = 1;\n');
  }
  return { repo, pin, brief: writeBrief(join(dir, 'briefs'), RUN_BRIEF), dir };
}

interface ParityResult {
  schema: number;
  plan: string;
  spentUsd: number;
  modelHostLaunched: boolean;
  installs: boolean;
  network: boolean;
  pin: string;
  nodeModules: { matchesPin: boolean; copy: string };
  checks: Array<{
    name: string;
    required: boolean;
    unitCommand: string;
    listed: boolean;
    hook: { decision: string; rule?: string };
    unit: { status: string; exitCode: number | null };
    supervisor: { status: string; exitCode: number | null };
    parity: boolean;
  }>;
  mismatches: string[];
  preFix: null | { mismatches: string[]; checks: Array<{ name: string; command: string; hook: { decision: string; rule?: string }; status: string }> };
  anchor: null | { matches: boolean; problems: string[] };
  checkout: { unchanged: boolean };
  parity: boolean;
  problems: string[];
}

interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
  out: string;
  report: ParityResult | null;
}

function parity(f: Fixture, extra: readonly string[] = [], pinArg: string = f.pin): Ran {
  const out = join(f.dir, `03-65-parity-${Math.random().toString(36).slice(2)}.json`);
  const ran = spawnSync(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', TOOLS, 'parity', '--source', f.repo.path, '--config', join(f.dir, 'config.json'), '--brief', f.brief, '--pin', pinArg, '--gsd-core-bin', join(f.dir, 'gsd-bin'), '--out', out, ...extra],
    { encoding: 'utf8', cwd: f.dir, env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: process.env['HOME'] ?? tmpdir() }, timeout: 280_000 },
  );
  return { code: ran.status, stdout: ran.stdout, stderr: ran.stderr, out, report: existsSync(out) ? (JSON.parse(readFileSync(out, 'utf8')) as ParityResult) : null };
}

// The checkout facts the test reads itself, independently of the tool's own record.
const checkoutFacts = (repo: ScratchRepo): string[] => [git(repo.path, ['rev-parse', 'HEAD']), git(repo.path, ['status', '--porcelain=v2', '--untracked-files=all']), git(repo.path, ['for-each-ref', '--format=%(refname) %(objectname)'])];

const shown = (r: Ran): string => `exit ${String(r.code)}\n${r.stderr}${r.stdout}${r.report === null ? '' : `\n${JSON.stringify({ mismatches: r.report.mismatches, problems: r.report.problems }, null, 1)}`}`;
const checkOf = (r: ParityResult, name: string): ParityResult['checks'][number] => r.checks.find((c) => c.name === name) as ParityResult['checks'][number];
const evidenceFile = (f: Fixture, runId: string, rows: Record<string, string>): string => {
  const path = join(f.dir, `evidence-${Math.random().toString(36).slice(2)}.json`);
  const evidenceRows = Object.entries(rows).map(([name, status]) => ({ kind: 'check', name, status, phase: 'base' }));
  writeFileSync(path, JSON.stringify({ schema: 1, runs: [{ runId, evidenceRows }] }));
  return path;
};

describe('fixture B: a check that needs its declared environment agrees in both forms', () => {
  const f = fixture(CONVENTIONS_B);
  const before = checkoutFacts(f.repo);
  const ran = parity(f, ['--keep']);
  const report = ran.report as ParityResult;

  it('exits 0 and writes a report with parity true and no problem', () => {
    assert.equal(ran.code, 0, shown(ran));
    assert.equal(report.schema, 1);
    assert.equal(report.plan, '03-65');
    assert.equal(report.parity, true, shown(ran));
    assert.deepEqual(report.mismatches, []);
    assert.deepEqual(report.problems, []);
  });

  it('ran `test` to failed in both forms (the slug bug) and `site` to passed in both', () => {
    assert.deepEqual(['test', 'site'].map((n) => [checkOf(report, n).unit.status, checkOf(report, n).supervisor.status]), [['failed', 'failed'], ['passed', 'passed']], shown(ran));
  });

  it('lists `site` to the unit with its environment, admitted by the hook as an agent command', () => {
    const site = checkOf(report, 'site');
    assert.equal(site.unitCommand, 'SITE_ORIGIN=https://example.test node scripts/needs-env.mjs');
    assert.equal(site.listed, true);
    assert.deepEqual([site.hook.decision, site.hook.rule], ['allow', 'agent-command']);
    assert.equal(checkOf(report, 'test').unitCommand, 'npm test');
  });

  it('records no spend, no model host, no install, no network, a node_modules tree that matches the pin, and an unchanged checkout', () => {
    assert.deepEqual([report.spentUsd, report.modelHostLaunched, report.installs, report.network], [0, false, false, false]);
    assert.equal(report.nodeModules.matchesPin, true);
    assert.ok(['clone', 'copy'].includes(report.nodeModules.copy), report.nodeModules.copy);
    assert.equal(report.checkout.unchanged, true);
    assert.equal(report.preFix, null);
    assert.equal(report.anchor, null);
  });

  it('left the fixture repository as it was: HEAD, porcelain status and refs', () => {
    assert.deepEqual(checkoutFacts(f.repo), before);
  });
});

describe('fixture B with --with-pre-fix and a matching anchor: run 2 attempt 2 reproduced offline', () => {
  const f = fixture(CONVENTIONS_B);
  const evidence = evidenceFile(f, 'run_AnchorMatches1', { test: 'failed', site: 'passed' });
  const ran = parity(f, ['--with-pre-fix', '--anchor-evidence', evidence, '--anchor-run-id', 'run_AnchorMatches1']);
  const report = ran.report as ParityResult;

  it('still has parity (the pre-fix pass is evidence, not part of the verdict) and the anchor matches', () => {
    assert.equal(ran.code, 0, shown(ran));
    assert.equal(report.parity, true);
    assert.equal(report.anchor?.matches, true, shown(ran));
  });

  it('shows the bare `site` command refused by the hook, failed when run, while the supervisor passed it: preFix.mismatches is exactly [site]', () => {
    assert.deepEqual(report.preFix?.mismatches, ['site'], shown(ran));
    const site = report.preFix?.checks.find((c) => c.name === 'site');
    assert.equal(site?.command, 'node scripts/needs-env.mjs');
    assert.deepEqual([site?.hook.decision, site?.hook.rule, site?.status], ['deny', 'shell-not-allowed', 'failed']);
    assert.equal(checkOf(report, 'site').supervisor.status, 'passed');
  });
});

describe('fixture A: a check that needs a variable only the supervisor sets (CI) is a mismatch', () => {
  const f = fixture(CONVENTIONS_A);
  const ran = parity(f);
  const report = ran.report as ParityResult;

  it('exits 1 with mismatches exactly [ci], the supervisor passing and the unit failing, and parity false', () => {
    assert.equal(ran.code, 1, shown(ran));
    assert.deepEqual(report.mismatches, ['ci'], shown(ran));
    assert.equal(report.parity, false);
    const ci = checkOf(report, 'ci');
    assert.deepEqual([ci.supervisor.status, ci.unit.status, ci.parity, ci.listed, ci.hook.decision], ['passed', 'failed', false, true, 'allow']);
  });

  it('leaves the other checks in agreement and the checkout unchanged', () => {
    assert.deepEqual(report.checks.filter((c) => c.parity).map((c) => c.name), ['test', 'site']);
    assert.equal(report.checkout.unchanged, true);
  });
});

describe('the anchor', () => {
  const f = fixture(CONVENTIONS_B);
  const evidence = evidenceFile(f, 'run_AnchorDiffers1', { test: 'failed', site: 'failed' });
  const ran = parity(f, ['--anchor-evidence', evidence, '--anchor-run-id', 'run_AnchorDiffers1']);
  const report = ran.report as ParityResult;

  it('reports an anchor problem and exits 1 when the supervisor form differs from the recorded base evidence', () => {
    assert.equal(ran.code, 1, shown(ran));
    assert.equal(report.anchor?.matches, false);
    assert.ok(report.anchor?.problems.some((p) => p.includes('site')), JSON.stringify(report.anchor));
    assert.ok(report.problems.some((p) => p.includes('anchor')), JSON.stringify(report.problems));
  });

  it('keeps parity itself true: the two forms agree, it is the anchor that differs', () => {
    assert.equal(report.parity, true);
    assert.deepEqual(report.mismatches, []);
  });
});

describe('refused input', () => {
  it('a working-tree lockfile that differs from the pin\'s blob exits 2 and writes no report', () => {
    const f = fixture(CONVENTIONS_B);
    writeFileSync(join(f.repo.path, 'package-lock.json'), `${LOCKFILE}\n`);
    const ran = parity(f);
    assert.equal(ran.code, 2, shown(ran));
    assert.equal(ran.report, null);
    assert.match(ran.stderr, /package-lock\.json/);
  });

  it('a missing node_modules directory exits 2 and writes no report', () => {
    const f = fixture(CONVENTIONS_B, false);
    const ran = parity(f);
    assert.equal(ran.code, 2, shown(ran));
    assert.equal(ran.report, null);
    assert.match(ran.stderr, /node_modules/);
  });

  it('a usage error (no --brief) exits 2 with the usage line', () => {
    const f = fixture(CONVENTIONS_B);
    const ran = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', TOOLS, 'parity', '--source', f.repo.path], { encoding: 'utf8', cwd: f.dir });
    assert.equal(ran.status, 2);
    assert.match(ran.stderr, /usage: parity /);
  });
});

// Only the pin's blob counts: a lockfile that a later commit changed is not the pin's tree.
describe('the lockfile is compared with the pin, not with HEAD', () => {
  it('a lockfile changed in a commit after the pin is refused (the tree is not the pin\'s)', () => {
    const f = fixture(CONVENTIONS_B);
    commitFiles(f.repo, { 'package-lock.json': `${LOCKFILE}\n` }, 'a later lockfile');
    const ran = parity(f);
    assert.equal(ran.code, 2, shown(ran));
    assert.equal(ran.report, null);
    assert.match(ran.stderr, /package-lock\.json/);
  });
});
