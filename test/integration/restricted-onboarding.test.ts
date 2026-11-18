// Restricted onboarding (plan 04-24; CON-4, D-12, ONB-7). A host that cannot be contained still refuses an onboarding by default and the refusal names `--restricted`;
// `avarice onboard --restricted <repo>` then runs GSD's fast map once under the restricted launch (`claude -p ... --restricted`) in the staging copy and activates a
// record that says so: mapping mode fast, completeness partial and `restricted: true`, shown as `partial (restricted)`. A restricted record never stands in for a
// whole-repository map, and a contained run is refused on a project whose only record is restricted. The real ClaudeHostAdapter runs against a fake `claude` (version
// 2.2.0, a minor no admission rule accepts, whose `--help` lists `--restricted`); no model is called, and every profile, repository and configuration directory is a
// temp directory.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { makeFakeClaude } from '../helpers/fake-claude.ts';
import type { FakeClaude, FakeClaudeScript } from '../helpers/fake-claude.ts';
import { REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import { commitConventions, makeRunRepo, writeBrief } from '../helpers/run-fixtures.ts';
import { checkoutSnapshot, git, makeScratchRepo } from '../helpers/scratch-repo.ts';
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

// The hook policy of the onboarding's map invocation (its invocation directory is kept).
function policyOf(f: Fixture): { readRoots: string[] } {
  const [onboarding] = rows<{ onboarding_id: string }>(f.roots, 'SELECT onboarding_id FROM onboardings');
  const dir = join(f.roots.AVARICE_DATA_ROOT, 'onboard', onboarding?.onboarding_id as string);
  const mapDir = readdirSync(dir).find((name) => name.startsWith('map-'));
  assert.ok(mapDir !== undefined, 'the map invocation directory is kept');
  return JSON.parse(readFileSync(join(dir, mapDir, 'hook-policy.json'), 'utf8')) as { readRoots: string[] };
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

  // Second product defect of the live restricted onboarding (plan 04-34, owner ruling (a)): the restricted host confines the file tools to the working directory, so
  // the GSD specs sit inside it. The prompt names them there, relative to the working directory, and never a `~`, `$HOME` or absolute form.
  it('names, in the map prompt, the staged GSD specs relative to the working directory, with no home-directory or absolute form', () => {
    const f = fixture();
    assert.equal(onboard(f, '--restricted').code, 0);
    const [launch] = f.fake.argvs() as Array<{ argv: string[] }>;
    const prompt = launch?.argv[1] ?? '';
    assert.ok(prompt.startsWith('/gsd-map-codebase --fast'), 'the map command still comes first');
    assert.ok(prompt.includes('.claude/gsd-core/workflows/map-codebase.md'), `the map workflow at its staged path: ${prompt}`);
    assert.ok(prompt.includes('.claude/gsd-core/workflows/scan.md'), `and the fast scan workflow: ${prompt}`);
    assert.ok(!prompt.includes('~') && !/\$\{?HOME/.test(prompt), `no tilde and no $HOME in: ${prompt}`);
    const gsdCore = policyOf(f).readRoots.find((root) => root.endsWith('/gsd-core'));
    assert.ok(gsdCore !== undefined && isAbsolute(gsdCore), 'the hook policy still holds the absolute gsd-core read root (owner constraint: not loosened, not narrowed)');
    assert.ok(!prompt.includes(gsdCore), 'and the prompt names no absolute path outside the working directory');
  });

  it('has the closure of the specs in the staging copy at launch: read-only, equal to the canonical gsd-core files, and not writable by the host', () => {
    const f = fixture();
    assert.equal(onboard(f, '--restricted').code, 0);
    const [specs, ...more] = f.fake.specs();
    assert.ok(specs !== undefined && more.length === 0, 'the one launch found the staged specs');
    const [onboarding] = rows<{ staging_worktree: string }>(f.roots, 'SELECT staging_worktree FROM onboardings');
    assert.equal(specs.cwd, realpathSync(onboarding?.staging_worktree as string));
    const gsdCore = policyOf(f).readRoots.find((root) => root.endsWith('/gsd-core')) as string;
    const staged = specs.files.map((file) => file.path).filter((p) => p !== '.avarice-staged');
    for (const seed of ['workflows/map-codebase.md', 'workflows/scan.md', 'references/agent-skills-bootstrap.md']) assert.ok(staged.includes(seed), `${seed} is staged: ${staged.join(', ')}`);
    assert.ok(staged.length <= 32, 'a closure, not the gsd-core tree');
    for (const file of specs.files) {
      assert.equal(file.mode, 0o444, `${file.path} is read-only`);
      assert.ok(file.writeError === 'EACCES' || file.writeError === 'EPERM', `${file.path} cannot be opened for writing, got ${String(file.writeError)}`);
      if (file.path !== '.avarice-staged') assert.equal(file.text, readFileSync(join(gsdCore, file.path), 'utf8'), `${file.path} is the canonical gsd-core file`);
    }
  });

  it('gives the restricted line no read grant: no --add-dir, and the hook policy read roots are the ones the contained hook holds', () => {
    const f = fixture();
    assert.equal(onboard(f, '--restricted').code, 0);
    const [launch] = f.fake.argvs() as Array<{ argv: string[] }>;
    assert.ok(!(launch?.argv ?? []).includes('--add-dir'));
    const roots = policyOf(f).readRoots;
    assert.deepEqual(roots.map((root) => root.split('/').at(-1)).sort(), ['agents', 'gsd-core', 'gsd-map-codebase']);
  });

  it('takes the staged specs out when the invocation is settled: nothing is left in staging, in the record or among its artifacts, and validation saw no write outside the write set', () => {
    const f = fixture();
    const before = checkoutSnapshot(f.repo.path);
    assert.equal(onboard(f, '--restricted').code, 0);
    const [onboarding] = rows<{ staging_worktree: string }>(f.roots, 'SELECT staging_worktree FROM onboardings');
    assert.ok(!existsSync(join(onboarding?.staging_worktree as string, '.claude')), 'the staging copy holds no .claude directory');
    const { body } = activeRecord(f.roots);
    assert.ok(!JSON.stringify(body).includes('.claude/gsd-core'), 'the record names no staged file');
    const codebase = ((body as unknown as { artifacts: { codebase: Array<{ path: string }> } }).artifacts.codebase ?? []).map((a) => a.path);
    assert.ok(codebase.length > 0 && codebase.every((p) => p.startsWith('.planning/codebase/')), `the record's map artifacts are the map files: ${codebase.join(', ')}`);
    const validates = rows<{ result_json: string }>(f.roots, "SELECT result_json FROM onboarding_steps WHERE step = 'validate'");
    assert.ok(validates.length > 0);
    for (const v of validates) assert.deepEqual((JSON.parse(v.result_json) as { scopeViolations: string[] }).scopeViolations, [], 'no write outside the write set');
    const findings = rows<{ data_json: string }>(f.roots, "SELECT data_json FROM events WHERE type = 'containment.finding'");
    assert.deepEqual(findings, [], 'no containment finding');
    assert.deepEqual(checkoutSnapshot(f.repo.path), before, 'the user checkout is unchanged');
  });

  it('carries none of the staged specs into a --promote copy or a --promote commit', () => {
    const copied = fixture();
    assert.equal(onboard(copied, '--restricted', '--promote', 'copy').code, 0);
    assert.ok(!existsSync(join(copied.repo.path, '.claude')), 'the copy wrote no .claude into the checkout');
    assert.ok(existsSync(join(copied.repo.path, '.planning', 'codebase', 'STACK.md')), 'the accepted map was copied');

    const committed = fixture();
    const before = checkoutSnapshot(committed.repo.path);
    assert.equal(onboard(committed, '--restricted', '--promote', 'commit').code, 0);
    const [onboarding] = rows<{ onboarding_id: string }>(committed.roots, 'SELECT onboarding_id FROM onboardings');
    const branch = `avarice/onboard-${onboarding?.onboarding_id as string}`;
    const files = git(committed.repo.path, ['ls-tree', '-r', '--name-only', branch]).split('\n').filter((p) => p !== '');
    assert.ok(files.some((p) => p.startsWith('.planning/codebase/')), 'the branch holds the accepted map');
    assert.deepEqual(files.filter((p) => p.startsWith('.claude/')), [], 'and no staged spec');
    assert.deepEqual(checkoutSnapshot(committed.repo.path).status, before.status, 'the checkout working tree is untouched');
  });

  it('ends in a decision, with the repository file untouched and no host started, when the repository itself holds .claude/gsd-core', () => {
    const roots = makeRoots();
    const repo = makeScratchRepo({ files: { ...REPO_FILES, '.claude/gsd-core/workflows/scan.md': 'the repository own spec\n' } });
    const fake = makeFakeClaude({ version: '2.2.0 (Claude Code)', transcript: 'success', mapFiles: 'fast' });
    const configDir = join(roots.base, 'claude-config');
    for (const skill of ['gsd-map-codebase', 'graphify']) {
      mkdirSync(join(configDir, 'skills', skill), { recursive: true });
      writeFileSync(join(configDir, 'skills', skill, 'SKILL.md'), `---\nname: ${skill}\ndescription: stand-in\n---\n`);
    }
    cleanup.push(roots.base, repo.base, fake.dir);
    const f: Fixture = { roots, repo, fake, configDir };
    const before = checkoutSnapshot(repo.path);
    const r = onboard(f, '--restricted');
    assert.equal(r.code, 3, r.stdout + r.stderr);
    assert.match(r.stdout, /onboarding onb_[0-9A-Z]{26}: blocked/);
    assert.equal(fake.started(), false, 'no host was started');
    const [onboarding] = rows<{ staging_worktree: string }>(roots, 'SELECT staging_worktree FROM onboardings');
    assert.equal(readFileSync(join(onboarding?.staging_worktree as string, '.claude/gsd-core/workflows/scan.md'), 'utf8'), 'the repository own spec\n', "the repository's own file is not replaced");
    assert.deepEqual(checkoutSnapshot(repo.path), before);
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
    assert.deepEqual(rows(f.roots, "SELECT run_id FROM runs WHERE state != 'onboarding'"), [], 'no run was stored (the onboarding keeps its own runs row)');
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
