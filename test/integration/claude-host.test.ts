// The contained Claude Code host adapter end to end, with a fake claude binary (plan 01-15; no model is called, no
// spend). `bin/avarice.ts` is the production entry: composition picks ClaudeHostAdapter when an admitted `claude`,
// the sandbox and the hook entry are present, and otherwise keeps the host that refuses (SC3, ONB-12, CON-3).
// Every profile, repository and configuration directory is a temp directory; the user's own profile, Claude
// configuration and repositories are never touched.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { PRODUCTION_ENTRY, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';
import { makeFakeClaude } from '../helpers/fake-claude.ts';
import type { FakeClaude, FakeClaudeScript } from '../helpers/fake-claude.ts';

const REPO_FILES = {
  'README.md': '# scratch\n',
  'package.json': '{"name":"scratch"}\n',
  'src/index.ts': 'export const answer = 42;\n',
  'src/util/strings.ts': 'export const upper = (s: string): string => s.toUpperCase();\n',
  'docs/guide.md': '# guide\n',
};
const TTL_MS = 200;
const EXPIRY_WAIT_MS = 400;

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

interface Setup {
  roots: CliRoots;
  repo: ScratchRepo;
  fake: FakeClaude;
  configDir: string;
}

// A temp Claude configuration directory with the two skills the plugin directory links. GSD itself and its agents
// are found as for every other integration test (the real gsd-core under HOME), because discovery looks in
// CLAUDE_CONFIG_DIR/gsd-core first and finds nothing there.
function configDirWithSkills(): string {
  const roots = makeRoots();
  cleanup.push(roots.base);
  const configDir = join(roots.base, 'claude-config');
  for (const skill of ['gsd-map-codebase', 'graphify']) {
    mkdirSync(join(configDir, 'skills', skill), { recursive: true });
    writeFileSync(join(configDir, 'skills', skill, 'SKILL.md'), `---\nname: ${skill}\ndescription: stand-in\n---\n`);
  }
  return configDir;
}

function setup(script: FakeClaudeScript): Setup {
  const roots = makeRoots();
  const repo = makeScratchRepo({ files: REPO_FILES });
  const fake = makeFakeClaude(script);
  cleanup.push(roots.base, repo.base, fake.dir);
  return { roots, repo, fake, configDir: configDirWithSkills() };
}

function envFor(s: Setup, extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    AVARICE_CLAUDE_BIN: s.fake.bin,
    CLAUDE_CONFIG_DIR: s.configDir,
    AVARICE_GRAPHIFY_BIN: '/nonexistent',
    AVARICE_LEASE_TTL_MS: String(TTL_MS),
    // A credential in the parent environment must never reach the host.
    ANTHROPIC_API_KEY: 'sk-ant-api03-PARENT-ENV-MUST-NOT-LEAK-0123456789',
    ...extra,
  };
}

function onboard(s: Setup, extra: Record<string, string | undefined> = {}): CliResult {
  return runCli(['onboard', '--policy', 'onboarding', s.repo.path], { roots: s.roots, entry: PRODUCTION_ENTRY, env: envFor(s, extra), timeoutMs: 180_000 });
}

function rows<T>(roots: CliRoots, sql: string, ...params: Array<string | number>): T[] {
  const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
  try {
    return (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    db.close();
  }
}

const stateOf = (roots: CliRoots): string => (rows<{ state: string }>(roots, 'SELECT state FROM onboardings')[0] as { state: string }).state;
const onboardingId = (roots: CliRoots): string => (rows<{ onboarding_id: string }>(roots, 'SELECT onboarding_id FROM onboardings')[0] as { onboarding_id: string }).onboarding_id;
const modeOf = (path: string): number => statSync(path).mode & 0o777;

function launchSteps(roots: CliRoots): Array<{ attempt: number; status: string; result: Record<string, unknown> }> {
  return rows<{ attempt: number; status: string; result_json: string }>(roots, "SELECT attempt, status, result_json FROM onboarding_steps WHERE step = 'launch:map' ORDER BY attempt").map((r) => ({
    attempt: r.attempt,
    status: r.status,
    result: JSON.parse(r.result_json) as Record<string, unknown>,
  }));
}

function invocationDirs(roots: CliRoots): string[] {
  const base = join(roots.AVARICE_DATA_ROOT, 'onboard', onboardingId(roots));
  return existsSync(base) ? readdirSync(base).filter((n) => n.startsWith('map-')).map((n) => join(base, n)) : [];
}

describe('onboarding through the real ClaudeHostAdapter and a fake claude', () => {
  it('reaches active, and the invocation directory holds the five generated inputs with modes 0600 and 0700', () => {
    const s = setup({ transcript: 'success', mapFiles: 'all' });
    const r = onboard(s);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(stateOf(s.roots), 'active');
    assert.equal(s.fake.launches().length, 1, 'one host launch');

    const [dir, ...more] = invocationDirs(s.roots);
    assert.ok(dir && more.length === 0, 'one invocation directory under onboard/{onb}/map-{inv}');
    for (const file of ['host-settings.json', 'hook-policy.json', 'agents.json', 'mcp.json']) {
      assert.equal(modeOf(join(dir, file)), 0o600, `${file} is 0600`);
    }
    assert.equal(modeOf(dir), 0o700, 'the invocation directory is 0700');
    assert.equal(modeOf(join(dir, 'plugin')), 0o700, 'the plugin directory is 0700');
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'mcp.json'), 'utf8')), { mcpServers: {} });
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, 'agents.json'), 'utf8')) as object), ['gsd-codebase-mapper']);
    assert.ok(existsSync(join(dir, 'plugin', 'skills', 'gsd-map-codebase')), 'the plugin carries the map skill');
    assert.ok(!existsSync(join(dir, 'plugin', 'skills', 'graphify')), 'and only the skills this purpose names');
  });

  it('records the contained host as the production agent-host, enforced, in adapter_configs', () => {
    const s = setup({ transcript: 'success', mapFiles: 'all' });
    assert.equal(onboard(s).code, 0);
    const [host] = rows<{ adapter: string; descriptor_json: string }>(s.roots, "SELECT adapter, descriptor_json FROM adapter_configs WHERE port = 'agent-host'");
    assert.equal(host?.adapter, 'claude-code');
    const descriptor = JSON.parse(host?.descriptor_json ?? '{}') as { attributes: Record<string, string> };
    assert.equal(descriptor.attributes['enforcement'], 'enforced');
    assert.equal(descriptor.attributes['claudeVersion'], '2.1.316');
  });

  it('launches with the generated argv only: never --bare, a permission bypass or auto, and in the staging copy', () => {
    const s = setup({ transcript: 'success', mapFiles: 'all' });
    assert.equal(onboard(s).code, 0);
    const [launch] = s.fake.argvs();
    assert.ok(launch, 'the fake claude was launched');
    const { argv } = launch;
    assert.equal(argv[0], '-p');
    for (const forbidden of ['--bare', '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', 'bypassPermissions', 'auto', '--add-dir', '--allowedTools']) {
      assert.ok(!argv.includes(forbidden), `argv has no ${forbidden}`);
    }
    assert.equal(argv[argv.indexOf('--permission-mode') + 1], 'dontAsk');
    assert.equal(argv[argv.indexOf('--setting-sources') + 1], '');
    assert.ok(argv.includes('--strict-mcp-config'));
    const [staging] = rows<{ staging_worktree: string }>(s.roots, 'SELECT staging_worktree FROM onboardings');
    assert.equal(launch.cwd, staging?.staging_worktree, 'the working directory is the staging copy');
    const sessionId = argv[argv.indexOf('--session-id') + 1];
    assert.match(sessionId ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const [step] = launchSteps(s.roots);
    assert.equal(step?.result['sessionId'], sessionId, 'the session ID is recorded in the ledger, so a resume can find the process');
  });

  it('starts the host with the allowlisted environment and no credential from the parent', () => {
    const s = setup({ transcript: 'success', mapFiles: 'all' });
    assert.equal(onboard(s).code, 0);
    const [env] = s.fake.envs();
    assert.ok(env, 'the fake claude recorded its environment');
    assert.equal(env['ANTHROPIC_API_KEY'], undefined);
    assert.equal(env['CLAUDE_CODE_DISABLE_CLAUDE_MDS'], '1');
    assert.equal(env['CLAUDE_CODE_DISABLE_AUTO_MEMORY'], '1');
    assert.ok((env['PATH'] ?? '').split(':')[0]?.endsWith('/gsd-core/bin'), 'the gsd-core bin leads PATH');
    assert.match(env['AVARICE_RUN'] ?? '', /^onb_/);
  });

  it('stores the transcript as an artifact only after redaction, and the invocation event carries counts, not text', () => {
    const secret = 'sk_live_4eC39HqLyjWDarjtT1zdp7dcREDACTME';
    const s = setup({ transcript: 'success', mapFiles: 'all', extraLines: [JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: `the key is ${secret}` }] } })] });
    assert.equal(onboard(s).code, 0);
    const [artifact] = rows<{ digest: string; size: number }>(s.roots, "SELECT digest, size FROM artifacts WHERE kind = 'transcript'");
    assert.ok(artifact, 'a transcript artifact is recorded');
    const hex = artifact.digest.replace('sha256:', '');
    const stored = readFileSync(join(s.roots.AVARICE_DATA_ROOT, 'artifacts', hex.slice(0, 2), hex), 'utf8');
    assert.ok(!stored.includes(secret), 'the secret is not in the stored transcript');
    assert.ok(stored.includes('"type":"result"'), 'the rest of the transcript is');

    const [finished] = rows<{ data_json: string }>(s.roots, "SELECT data_json FROM events WHERE type = 'invocation.finished'");
    assert.ok(finished, 'an invocation.finished event');
    const data = JSON.parse(finished.data_json) as Record<string, unknown>;
    assert.equal(data['outcome'], 'progressed');
    assert.equal(data['costUsd'], 0.01606839);
    assert.ok(!finished.data_json.includes('The scan finished'), 'no model text in the event');
    assert.ok(!finished.data_json.includes(secret));
  });
});

describe('fail closed before any process starts (SC3)', () => {
  function assertBlockedBeforeLaunch(s: Setup, r: CliResult): void {
    assert.match(r.stdout + r.stderr, /blocked \(enforcement_failure\)/, r.stdout + r.stderr);
    assert.equal(stateOf(s.roots), 'blocked');
    assert.equal(s.fake.started(), false, 'the host was never started');
    assert.deepEqual(s.fake.launches(), []);
  }

  it('blocks with enforcement_failure when the hook entry is missing', () => {
    const s = setup({ transcript: 'success', mapFiles: 'all' });
    assertBlockedBeforeLaunch(s, onboard(s, { AVARICE_HOOK_ENTRY: '/nonexistent/pre-tool-use.ts' }));
  });

  it('blocks with enforcement_failure when claude reports a version that is not admitted', () => {
    const s = setup({ version: '2.1.400 (Claude Code)', transcript: 'success', mapFiles: 'all' });
    assertBlockedBeforeLaunch(s, onboard(s));
  });

  it('blocks with enforcement_failure when the claude binary is not there', () => {
    const s = setup({ transcript: 'success', mapFiles: 'all' });
    assertBlockedBeforeLaunch(s, onboard(s, { AVARICE_CLAUDE_BIN: '/nonexistent/claude' }));
  });
});

describe('what the host reports decides the next state, and never the model text', () => {
  it('ends blocked (budget_exhausted) when the host hit its budget', () => {
    const s = setup({ transcript: 'maxBudget' });
    const r = onboard(s);
    assert.match(r.stdout + r.stderr, /blocked \(budget_exhausted\)/, r.stdout + r.stderr);
    assert.equal(launchSteps(s.roots)[0]?.result['kind'], 'budget_exhausted');
  });

  it('ends blocked (decision) for an is_error result even though its subtype says success', () => {
    const s = setup({ transcript: 'apiError' });
    const r = onboard(s);
    assert.match(r.stdout + r.stderr, /blocked \(decision\)/, r.stdout + r.stderr);
    assert.equal(launchSteps(s.roots)[0]?.result['kind'], 'failed');
  });

  it('ends blocked (decision) for a refused call and no files, whatever the model said it did', () => {
    const s = setup({ transcript: 'hookBlock' });
    const r = onboard(s);
    assert.match(r.stdout + r.stderr, /blocked \(decision\)/, r.stdout + r.stderr);
    assert.equal(launchSteps(s.roots)[0]?.result['kind'], 'denied');
  });
});

describe('a supervisor killed while the host runs (T-01-44)', () => {
  it('is reaped by its session ID on resume, then the onboarding is reconciled and completes', async () => {
    const s = setup({ transcript: 'success', mapFiles: 'all', sleepMs: 120_000, sleepFirstOnly: true });
    const env: Record<string, string | undefined> = { ...process.env, ...envFor(s), AVARICE_CONFIG_HOME: s.roots.AVARICE_CONFIG_HOME, AVARICE_DATA_ROOT: s.roots.AVARICE_DATA_ROOT, AVARICE_WORK_ROOT: s.roots.AVARICE_WORK_ROOT };
    delete env['NODE_TEST_CONTEXT'];
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', PRODUCTION_ENTRY, 'onboard', '--policy', 'onboarding', s.repo.path], { env: env as NodeJS.ProcessEnv, stdio: 'ignore' });
    const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
    const deadline = Date.now() + 60_000;
    let gone = false;
    void exited.then(() => (gone = true));
    while (!s.fake.started() && !gone && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    assert.ok(s.fake.started(), 'the supervisor launched the fake claude');
    child.kill('SIGKILL');
    await exited;

    const [launch] = s.fake.launches();
    assert.ok(launch);
    const alive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    assert.ok(alive(launch.pid), 'the host outlives its killed supervisor');
    await new Promise((r) => setTimeout(r, EXPIRY_WAIT_MS));

    const resumed = runCli(['resume', onboardingId(s.roots)], { roots: s.roots, entry: PRODUCTION_ENTRY, env: envFor(s), timeoutMs: 180_000 });
    assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
    assert.equal(alive(launch.pid), false, 'resume terminated the process that carried the session ID');
    assert.equal(stateOf(s.roots), 'active');
    const steps = launchSteps(s.roots);
    assert.equal(steps[0]?.status, 'interrupted');
    assert.equal(steps.at(-1)?.status, 'completed');
  });
});
