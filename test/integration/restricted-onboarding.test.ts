// Restricted onboarding (plan 04-24; CON-4, D-12, ONB-7). A host that cannot be contained still refuses an onboarding by default and the refusal names `--restricted`;
// `avarice onboard --restricted <repo>` then runs GSD's fast map once under the restricted launch (`claude -p ... --restricted`) in the staging copy and activates a
// record that says so: mapping mode fast, completeness partial and `restricted: true`, shown as `partial (restricted)`. A restricted record never stands in for a
// whole-repository map, and a contained run is refused on a project whose only record is restricted. The real ClaudeHostAdapter runs against a fake `claude` (version
// 2.2.0, a minor no admission rule accepts, whose `--help` lists `--restricted`); no model is called, and every profile, repository and configuration directory is a
// temp directory.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { makeFakeClaude } from '../helpers/fake-claude.ts';
import type { FakeClaude, FakeClaudeScript } from '../helpers/fake-claude.ts';
import { REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import { commitConventions, makeRunRepo, writeBrief } from '../helpers/run-fixtures.ts';
import { checkoutSnapshot, makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const TEST_CLI = join(REPO_ROOT, 'test', 'helpers', 'test-cli.ts');

const REPO_FILES = {
  'README.md': '# scratch\n',
  'package.json': '{"name":"scratch"}\n',
  'src/index.ts': 'export const answer = 42;\n',
  'src/util/strings.ts': 'export const upper = (s: string): string => s.toUpperCase();\n',
};

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  fake: FakeClaude;
  configDir: string;
}

// A repository, a fake `claude` that is not admitted for a contained run, and a Claude configuration directory holding the skill the plugin directory links.
function fixture(script: FakeClaudeScript = {}): Fixture {
  const roots = makeRoots();
  const repo = makeScratchRepo({ files: REPO_FILES });
  const fake = makeFakeClaude({ version: '2.2.0 (Claude Code)', transcript: 'success', mapFiles: 'fast', ...script });
  const configDir = join(roots.base, 'claude-config');
  for (const skill of ['gsd-map-codebase', 'graphify']) {
    mkdirSync(join(configDir, 'skills', skill), { recursive: true });
    writeFileSync(join(configDir, 'skills', skill, 'SKILL.md'), `---\nname: ${skill}\ndescription: stand-in\n---\n`);
  }
  cleanup.push(roots.base, repo.base, fake.dir);
  return { roots, repo, fake, configDir };
}

function envOf(f: Fixture): Record<string, string> {
  return { AVARICE_CLAUDE_BIN: f.fake.bin, CLAUDE_CONFIG_DIR: f.configDir, AVARICE_GRAPHIFY_BIN: '/nonexistent' };
}

function onboard(f: Fixture, ...flags: string[]): CliResult {
  return runCli(['onboard', '--policy', 'onboarding', ...flags, f.repo.path], { roots: f.roots, env: envOf(f), timeoutMs: 180_000 });
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

interface RecordBody {
  mapping: { mode: string; completeness: string };
  indexes: { absent?: Array<{ index: string; reason: string }> };
  restricted?: boolean;
}
const activeRecord = (roots: CliRoots): { version: number; body: RecordBody } => {
  const [row] = rows<{ version: number; body_json: string }>(roots, "SELECT version, body_json FROM project_records WHERE state = 'active' AND superseded_at IS NULL ORDER BY version DESC");
  assert.ok(row !== undefined, 'an active record');
  return { version: row.version, body: JSON.parse(row.body_json) as RecordBody };
};

describe('tracer: `onboard --restricted` maps fast under the restricted launch and activates a `partial (restricted)` record (CON-4, D-12)', () => {
  it('launches the mapper once with --restricted in the staging copy, activates mode fast, completeness partial and restricted true, and leaves the checkout byte-identical', () => {
    const f = fixture();
    const before = checkoutSnapshot(f.repo.path);
    const r = onboard(f, '--restricted');
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /onboarding onb_[0-9A-Z]{26}: active/);

    // One launch: the map. The restricted line, run in the staging copy, with no tool grant; the intel and knowledge steps start nothing.
    const launches = f.fake.argvs();
    assert.equal(launches.length, 1, `one invocation, got ${launches.map((l) => l.argv.join(' ')).join(' | ')}`);
    const { argv, cwd } = launches[0] as { argv: string[]; cwd: string };
    assert.equal(argv[0], '-p');
    assert.ok((argv[1] ?? '').startsWith('/gsd-map-codebase --fast'), 'the fast map prompt');
    assert.ok(argv.includes('--restricted'), 'the line carries --restricted');
    assert.equal(argv[argv.indexOf('--permission-mode') + 1], 'dontAsk');
    assert.equal(argv[argv.indexOf('--permission-prompts') + 1], 'none');
    for (const flag of ['--allowedTools', '--allowed-tools', '--tools', '--add-dir', '--bare', '--agent']) assert.ok(!argv.includes(flag), `no ${flag}`);
    const [onboarding] = rows<{ staging_worktree: string }>(f.roots, 'SELECT staging_worktree FROM onboardings');
    assert.equal(cwd, realpathSync(onboarding?.staging_worktree as string), 'the mapper runs in the staging copy');
    assert.ok(cwd.startsWith(realpathSync(f.roots.AVARICE_WORK_ROOT)), 'staging is under the work root');

    // The record says what it is.
    const { body } = activeRecord(f.roots);
    assert.equal(body.mapping.mode, 'fast');
    assert.equal(body.mapping.completeness, 'partial');
    assert.equal(body.restricted, true);
    assert.deepEqual(
      (body.indexes.absent ?? []).filter((a) => a.index !== 'graph').map((a) => [a.index, a.reason]),
      [['intel', 'restricted'], ['knowledge', 'restricted']],
      'the indexes that need a contained host are recorded absent as restricted',
    );

    // The user's checkout is exactly as it was.
    assert.deepEqual(checkoutSnapshot(f.repo.path), before, 'the user checkout is unchanged (treeDigest, status, HEAD)');
  });

  it('shows `partial (restricted)` in status, and appends the optional `restricted` key last to the project entry of status --json', () => {
    const f = fixture();
    assert.equal(onboard(f, '--restricted').code, 0);
    const text = runCli(['status'], { roots: f.roots, env: envOf(f) });
    assert.equal(text.code, 0, text.stderr);
    assert.match(text.stdout, /mapping fast \(partial \(restricted\), fresh\)/);

    const json = runCli(['status', '--json'], { roots: f.roots, env: envOf(f) });
    assert.equal(json.code, 0, json.stderr);
    const [entry] = JSON.parse(json.stdout) as Array<Record<string, unknown>>;
    assert.ok(entry !== undefined);
    assert.equal(entry['restricted'], true);
    assert.equal(Object.keys(entry).at(-1), 'restricted', 'appended last');
    assert.equal((entry['mapping'] as Record<string, unknown>)['completeness'], 'partial', 'completeness stays partial');
  });

  it('exits 64 naming the conflict for `--restricted --mode full`, and registers nothing', () => {
    const f = fixture();
    const r = onboard(f, '--restricted', '--mode', 'full');
    assert.equal(r.code, 64, r.stdout + r.stderr);
    assert.match(r.stderr, /--restricted/);
    assert.match(r.stderr, /--mode full/);
    assert.deepEqual(f.fake.argvs(), []);
    assert.deepEqual(rows(f.roots, 'SELECT onboarding_id FROM onboardings'), []);
  });

  it('without the flag, an onboarding on the same host stays blocked with enforcement_failure and the message names --restricted', () => {
    const f = fixture();
    const r = onboard(f);
    assert.equal(r.code, 3, r.stdout + r.stderr);
    assert.match(r.stdout, /onboarding onb_[0-9A-Z]{26}: blocked \(enforcement_failure\)/);
    assert.match(r.stdout + r.stderr, /--restricted/, 'the message names the flag');
    assert.equal(f.fake.started(), false, 'no mapper was launched');
    assert.equal(rows<{ state: string }>(f.roots, 'SELECT state FROM onboardings')[0]?.state, 'blocked');
  });
});

// ---- Task 2: a restricted record is never full coverage, and a contained run on it is refused (ONB-7, CON-4, T-04-65) ------------------------------------------

interface RunFixture extends Fixture {
  brief: string;
}

// A scratch GSD project (a committed slug bug and the conventions a routine run needs), onboarded with `--restricted` on the fake `claude`.
function runFixture(): RunFixture {
  const roots = makeRoots();
  const repo = makeRunRepo();
  const fake = makeFakeClaude({ version: '2.2.0 (Claude Code)', transcript: 'success', mapFiles: 'fast' });
  const configDir = join(roots.base, 'claude-config');
  for (const skill of ['gsd-map-codebase', 'graphify']) {
    mkdirSync(join(configDir, 'skills', skill), { recursive: true });
    writeFileSync(join(configDir, 'skills', skill, 'SKILL.md'), `---\nname: ${skill}\ndescription: stand-in\n---\n`);
  }
  cleanup.push(roots.base, repo.base, fake.dir);
  const f: RunFixture = { roots, repo, fake, configDir, brief: '' };
  const onboarded = onboard(f, '--restricted');
  assert.equal(onboarded.code, 0, onboarded.stdout + onboarded.stderr);
  commitConventions(repo);
  f.brief = writeBrief(join(roots.base, 'briefs'));
  return f;
}

function start(f: RunFixture, env: Record<string, string>, ...extra: string[]): CliResult {
  return runCli(['start', '--brief', f.brief, '--policy', 'routine', ...extra], { roots: f.roots, cwd: f.repo.path, env, timeoutMs: 180_000 });
}

describe('a restricted record is never presented as whole-repository coverage (ONB-7, CON-4)', () => {
  it('labels the pack of `context <term>` `partial (restricted)`, in the project line and as a `restricted` key of the JSON project', () => {
    const f = runFixture();
    const text = runCli(['context', 'slugify'], { roots: f.roots, env: envOf(f) });
    assert.equal(text.code, 0, text.stdout + text.stderr);
    assert.match(text.stdout.split('\n')[0] ?? '', /\(record v1 at git:[0-9a-f]{40}; map: partial \(restricted\)\)$/, text.stdout);

    const json = runCli(['context', 'slugify', '--json'], { roots: f.roots, env: envOf(f) });
    assert.equal(json.code, 0, json.stdout + json.stderr);
    const report = JSON.parse(json.stdout) as { project: Record<string, unknown> };
    assert.equal(report.project['restricted'], true);
    assert.equal(Object.keys(report.project).at(-1), 'restricted', 'appended last');
  });

  it('refuses a contained start on a project whose active record is restricted: exit 3, the message names a contained re-onboarding, and no run is stored', () => {
    const f = runFixture();
    const r = start(f, envOf(f));
    assert.equal(r.code, 3, r.stdout + r.stderr);
    assert.match(r.stderr, /refused: .*restricted onboarding \(partial \(restricted\)\)/, r.stderr);
    assert.match(r.stderr, /avarice onboard --policy onboarding /, 'it names the onboarding that replaces the record');
    assert.match(r.stderr, /enforced host/);
    assert.deepEqual(rows(f.roots, 'SELECT run_id FROM runs'), [], 'nothing was stored');
  });

  it('lets `start --restricted` run on it: the restricted line launches in the run clone and the run ends blocked as any restricted run does', () => {
    const f = runFixture();
    const runFake = makeFakeClaude({ version: '2.2.0 (Claude Code)', transcript: 'success', writes: { '.avarice-restricted/PLAN.md': '# Plan\n\n1. Collapse runs of separators.\n' } });
    cleanup.push(runFake.dir);
    const r = start(f, { AVARICE_CLAUDE_BIN: runFake.bin }, '--restricted', '--wait');
    assert.equal(r.code, 3, r.stdout + r.stderr);
    assert.match(r.stdout, /run run_[0-9A-Z]{26}: blocked_on_decision \(enforcement_failure\)/);
    const launches = runFake.argvs();
    assert.equal(launches.length, 1, 'one invocation');
    assert.ok((launches[0] as { argv: string[] }).argv.includes('--restricted'));
  });

  it('is replaced by a later contained onboarding: the new record version has no restricted key, and the contained start is no longer refused for it', () => {
    const f = runFixture();
    assert.equal(activeRecord(f.roots).body.restricted, true);
    // The fake host of the test entry is an enforced one, as the production host is on a host that can be contained.
    const contained = runCli(['onboard', '--policy', 'onboarding', f.repo.path], { roots: f.roots, entry: TEST_CLI, env: { AVARICE_FAKE_HOST: '{}' }, timeoutMs: 180_000 });
    assert.equal(contained.code, 0, contained.stdout + contained.stderr);
    const record = activeRecord(f.roots);
    assert.equal(record.version, 2, 'a new version replaced the restricted one');
    assert.equal(record.body.restricted, undefined, 'the new record is not restricted');
    assert.equal(record.body.mapping.completeness, 'complete');
    const json = JSON.parse(runCli(['status', '--json'], { roots: f.roots, env: envOf(f) }).stdout) as Array<Record<string, unknown>>;
    assert.ok(!('restricted' in (json[0] as Record<string, unknown>)), 'status no longer says restricted');
    const r = start(f, envOf(f));
    assert.ok(!/restricted onboarding/.test(r.stderr), `the contained start is not refused for a restricted record: ${r.stderr}`);
  });
});
