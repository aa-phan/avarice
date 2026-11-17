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
import { makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import { checkoutSnapshot, makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

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
  const [row] = rows<{ version: number; body_json: string }>(roots, "SELECT version, body_json FROM project_records WHERE state = 'active'");
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
