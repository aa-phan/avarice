// Restricted mode for runs (plan 04-23; CON-4, D-12, S-22). A host without required enforcement refuses an unattended run by default and says how to ask for
// restricted mode; `avarice start --restricted` then runs analysis and planning only: one `claude -p ... --restricted` invocation in the run's disposable clone, whose
// plan, patch and question list are stored as artifacts. The run never commits, never hands off a branch and never writes the user's repository, and it ends blocked
// (enforcement_failure) with one decision that names what it left. The real ClaudeHostAdapter runs against a fake `claude` that records its argv and edits the clone;
// no model is called.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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
