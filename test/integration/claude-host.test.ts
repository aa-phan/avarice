// The contained Claude Code host adapter end to end, with a fake claude binary (plan 01-15; no model is called, no
// spend). `bin/avarice.ts` is the production entry: composition picks ClaudeHostAdapter when an admitted `claude`,
// the sandbox and the hook entry are present, and otherwise keeps the host that refuses (SC3, ONB-12, CON-3).
// Every profile, repository and configuration directory is a temp directory; the user's own profile, Claude
// configuration and repositories are never touched.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { LocalArtifactStore } from '../../src/adapters/fs/artifact-store.ts';
import { createStagingWorkspace, STAGING_STRATEGY } from '../../src/adapters/git/staging-strategy.ts';
import { ClaudeHostAdapter } from '../../src/adapters/host-claude/claude-host.ts';
import type { ClaudeHostOptions } from '../../src/adapters/host-claude/claude-host.ts';
import { fingerprintGsdPreamble } from '../../src/adapters/gsd/preamble.ts';
import { locateGsdCore } from '../../src/adapters/gsd/locate.ts';
import { runOnboarding, startOnboarding } from '../../src/app/onboarding-service.ts';
import type { AppDeps } from '../../src/app/deps.ts';
import { createDeps } from '../../src/cli/composition.ts';
import type { AgentHost, InvocationOutcome, InvocationRequest } from '../../src/ports/agent-host.ts';
import type { Result } from '../../src/domain/result.ts';
import { PRODUCTION_ENTRY, REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';
import { makeFakeClaude } from '../helpers/fake-claude.ts';
import { writeFakeGraphify } from '../helpers/fake-graphify.ts';
import type { FakeClaude, FakeClaudeScript } from '../helpers/fake-claude.ts';

const REPO_FILES = {
  'README.md': '# scratch\n',
  'package.json': '{"name":"scratch"}\n',
  'src/index.ts': 'export const answer = 42;\n',
  'src/util/strings.ts': 'export const upper = (s: string): string => s.toUpperCase();\n',
  'docs/guide.md': '# guide\n',
};
// The fingerprint spike S0-A recorded for the GSD 1.17 shim preamble (spikes/slice-0-wave-0/README.md).
const GSD_PREAMBLE_SHA256 = 'c71090e895dc5a024a60e879e621d201f1b7f1fc4a9d5649e90dcabfba52622b';
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

// Plan 01-19 decision B through the real adapter: the generated settings, hook policy and launch line of the knowledge purpose, with
// a fake claude that writes the extraction files. No model is called.
describe('the knowledge purpose through the real ClaudeHostAdapter and a fake claude (decision B)', () => {
  it('launches with no shell, no skill, no agent, reads and writes confined, and the extraction becomes document nodes in the graph', () => {
    const s = setup({ transcript: 'success', mapFiles: 'all', intel: true, knowledge: true });
    const tools = mkdtempSync(join(tmpdir(), 'avarice-live-fakegraphify-'));
    cleanup.push(tools);
    const r = onboard(s, { AVARICE_GRAPHIFY_BIN: writeFakeGraphify(tools) });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(stateOf(s.roots), 'active');
    assert.equal(s.fake.launchesOf('knowledge').length, 1, 'one knowledge launch');
    const base = join(s.roots.AVARICE_DATA_ROOT, 'onboard', onboardingId(s.roots));
    const [dirName, ...more] = readdirSync(base).filter((n) => n.startsWith('knowledge-'));
    assert.ok(dirName && more.length === 0, 'one knowledge invocation directory');
    const dir = join(base, dirName);

    const settings = JSON.parse(readFileSync(join(dir, 'host-settings.json'), 'utf8')) as { permissions: { allow: string[]; deny: string[] } };
    const { allow, deny } = settings.permissions;
    assert.equal(allow.some((rule) => rule === 'Bash' || rule.startsWith('Bash(')), false, 'no Bash allow rule');
    assert.ok(deny.includes('Bash'), 'Bash is denied outright');
    for (const tool of ['Skill', 'Agent']) assert.equal(allow.includes(tool), false, tool);
    const reads = allow.filter((rule) => rule.startsWith('Read('));
    assert.equal(reads.length, 1, 'one Read rule: the corpus');
    assert.match(reads[0] ?? '', /\/\.avarice-knowledge\/\*\*\)$/);
    assert.equal(allow.filter((rule) => rule.startsWith('Edit(')).length, 1);
    assert.match(allow.find((rule) => rule.startsWith('Edit(')) ?? '', /\.avarice-knowledge\/\.extraction\/\*\*\)$/);

    const policy = JSON.parse(readFileSync(join(dir, 'hook-policy.json'), 'utf8')) as { commands: { strategy: string; readOnly: string[]; gsdReadVerbs: string[] }; subagentTypes: string[]; readConfine: string[]; writeRoots: string[]; purpose: string };
    assert.equal(policy.purpose, 'knowledge');
    assert.equal(policy.commands.strategy, 'none');
    assert.deepEqual([policy.commands.readOnly, policy.commands.gsdReadVerbs, policy.subagentTypes], [[], [], []]);
    assert.equal(policy.readConfine.length, 1);
    assert.match(policy.readConfine[0] ?? '', /\.avarice-knowledge$/);
    assert.match(policy.writeRoots[0] ?? '', /\.avarice-knowledge\/\.extraction$/);
    assert.deepEqual(readdirSync(join(dir, 'plugin', 'skills')), [], 'no skill is linked');
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, 'agents.json'), 'utf8')) as object), []);

    const argv = s.fake.argvs().find((a) => a.cwd.endsWith('.avarice-knowledge'));
    assert.ok(argv, 'the knowledge launch ran in the corpus directory');
    assert.equal(argv.argv.includes('--agent'), false);
    const prompt = argv.argv[argv.argv.indexOf('-p') + 1] ?? '';
    assert.match(prompt, /no shell, no skill, no subagent and no network/);
    assert.equal(prompt.includes('/graphify'), false);
    // No PATH directory for graphify and no secret-bearing variable (the knowledge pass runs no program).
    assert.equal(s.fake.envs().some((e) => (e['PATH'] ?? '').includes(tools)), false, 'the graphify directory is not on the host PATH');

    const record = rows<{ body_json: string }>(s.roots, 'SELECT body_json FROM project_records ORDER BY version DESC LIMIT 1')[0];
    const body = JSON.parse(record?.body_json ?? '{}') as { indexes: { graph?: { nodes: Record<string, number>; knowledge?: { documentNodes: number } } } };
    assert.ok((body.indexes.graph?.knowledge?.documentNodes ?? 0) > 0, 'document nodes joined the graph');
  });
});

describe('onboarding through the real ClaudeHostAdapter and a fake claude', () => {
  it('reaches active, and the invocation directory holds the five generated inputs with modes 0600 and 0700', () => {
    const s = setup({ transcript: 'success', mapFiles: 'all', intel: true });
    const r = onboard(s);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(stateOf(s.roots), 'active');
    assert.equal(s.fake.launchesOf('map').length, 1, 'one map launch');
    assert.equal(s.fake.launchesOf('intel').length, 1, 'and one intel launch');

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

    const settingsText = readFileSync(join(dir, 'host-settings.json'), 'utf8');
    const settings = JSON.parse(settingsText) as { permissions: { defaultMode: string; disableBypassPermissionsMode: string }; sandbox: { enabled: boolean; allowUnsandboxedCommands: boolean } };
    assert.equal(settings.permissions.defaultMode, 'dontAsk');
    assert.equal(settings.permissions.disableBypassPermissionsMode, 'disable');
    assert.equal(settings.sandbox.enabled, true);
    assert.equal(settings.sandbox.allowUnsandboxedCommands, false);
    const policy = JSON.parse(readFileSync(join(dir, 'hook-policy.json'), 'utf8')) as { commands: { preambleSha256?: string; preambleLength?: number }; subagentTypes: string[]; invocationId: string };
    assert.deepEqual(policy.subagentTypes, ['gsd-codebase-mapper']);
    assert.equal(policy.commands.preambleSha256, GSD_PREAMBLE_SHA256, "the policy carries the fingerprint of the located GSD's own shim preamble");
    assert.equal(policy.commands.preambleLength, 2573);
  });

  it('runs the intel purpose through the real adapter: --agent, an agents file with the intel updater only, no skill, and an intel index in the record', () => {
    const s = setup({ transcript: 'success', mapFiles: 'all', intel: true });
    const r = onboard(s);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const base = join(s.roots.AVARICE_DATA_ROOT, 'onboard', onboardingId(s.roots));
    const [dir, ...more] = readdirSync(base).filter((n) => n.startsWith('intel-')).map((n) => join(base, n));
    assert.ok(dir && more.length === 0, 'one invocation directory under onboard/{onb}/intel-{inv}');
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, 'agents.json'), 'utf8')) as object), ['gsd-intel-updater']);
    assert.deepEqual(existsSync(join(dir, 'plugin', 'skills')) ? readdirSync(join(dir, 'plugin', 'skills')) : [], [], 'the intel purpose loads no skill');
    const settings = JSON.parse(readFileSync(join(dir, 'host-settings.json'), 'utf8')) as { sandbox: { enabled: boolean } };
    assert.equal(settings.sandbox.enabled, true);

    const intelArgv = s.fake.argvs().filter((a) => a.argv.includes('--agent'));
    assert.equal(intelArgv.length, 1);
    const argv = intelArgv[0]?.argv ?? [];
    assert.equal(argv[argv.indexOf('--agent') + 1], 'gsd-intel-updater');
    assert.equal(argv[argv.indexOf('-p') + 1], 'focus: full; project root: .');
    const [staging] = rows<{ staging_worktree: string }>(s.roots, 'SELECT staging_worktree FROM onboardings');
    assert.equal(intelArgv[0]?.cwd, realpathSync(staging?.staging_worktree ?? ''));

    const [record] = rows<{ body_json: string }>(s.roots, 'SELECT body_json FROM project_records ORDER BY version DESC LIMIT 1');
    const intel = (JSON.parse(record?.body_json ?? '{}') as { indexes: { intel?: { freshness: string; files: number } } }).indexes.intel;
    assert.deepEqual([intel?.freshness, intel?.files], ['fresh', 5]);
    const [step] = rows<{ status: string; result_json: string }>(s.roots, "SELECT status, result_json FROM onboarding_steps WHERE step = 'launch:intel'");
    assert.equal(step?.status, 'completed');
    assert.equal((JSON.parse(step?.result_json ?? '{}') as { kind: string }).kind, 'progressed');
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
    assert.equal(launch.cwd, realpathSync(staging?.staging_worktree ?? ''), 'the working directory is the staging copy');
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

// ---------------------------------------------------------------------------------------------------------------
// In-process runs: the adapter is built here, so a test can reach the seams a command line cannot (a hook between
// the write and the launch checks, the sandbox probe, the wall clock, the hook counts). The rest is production code:
// the same composition, ledger, staging, artifact store and stage loop as the command line.
// ---------------------------------------------------------------------------------------------------------------
const HOOK_ENTRY = join(REPO_ROOT, 'src', 'hook', 'pre-tool-use.ts');

// Shortens the wall clock the contract grants (whole minutes at the least) so a test can reach the timeout.
class ClampedHost implements AgentHost {
  readonly #inner: AgentHost;
  readonly #wallClockMs: number;
  constructor(inner: AgentHost, wallClockMs: number) {
    this.#inner = inner;
    this.#wallClockMs = wallClockMs;
  }
  get descriptor(): AgentHost['descriptor'] {
    return this.#inner.descriptor;
  }
  invoke(req: InvocationRequest, signal: AbortSignal): Promise<Result<InvocationOutcome>> {
    return this.#inner.invoke({ ...req, wallClockMs: this.#wallClockMs }, signal);
  }
}

interface RunResult {
  deps: AppDeps;
  onboardingId: string;
  state: string;
  reason: string | null;
}

async function inProcess(s: Setup, adapterOptions: Partial<ClaudeHostOptions> = {}, wrap?: (adapter: AgentHost) => AgentHost): Promise<RunResult> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...envFor(s),
    AVARICE_CONFIG_HOME: s.roots.AVARICE_CONFIG_HOME,
    AVARICE_DATA_ROOT: s.roots.AVARICE_DATA_ROOT,
    AVARICE_WORK_ROOT: s.roots.AVARICE_WORK_ROOT,
  };
  const composed = createDeps(env);
  assert.ok(composed.ok, 'composition');
  const located = locateGsdCore(env);
  assert.ok(located.ok, 'gsd-core is installed');
  const preamble = fingerprintGsdPreamble(located.value.gsdCoreDir);
  assert.ok(preamble.ok, 'the GSD preamble is found');
  const { deps } = composed.value;
  try {
    const adapter = new ClaudeHostAdapter({
      claudeBin: s.fake.bin,
      hookEntry: HOOK_ENTRY,
      ledgerPath: join(deps.profile.dataRoot, 'state.db'),
      dataRoot: deps.profile.dataRoot,
      gsd: {
        gsdCoreDir: located.value.gsdCoreDir,
        agentsDir: join(located.value.gsdCoreDir, '..', 'agents'),
        skillsRoot: join(s.configDir, 'skills'),
        preamble: preamble.value,
      },
      artifacts: deps.artifacts,
      staging: deps.staging,
      countHookDenies: (id) => deps.ledger.countHookDenials(id),
      env,
      ...adapterOptions,
    });
    const wired: AppDeps = { ...deps, host: wrap === undefined ? adapter : wrap(adapter) };
    const started = startOnboarding(wired, { repoPath: s.repo.path, policy: 'onboarding', mode: 'full' });
    assert.ok(started.ok, 'registration');
    const outcome = await runOnboarding(wired, started.value.onboardingId);
    // A host error the stage does not turn into a state (a cancelled invocation) ends the loop with that error.
    if (!outcome.ok) return { deps: wired, onboardingId: started.value.onboardingId, state: `error:${outcome.error.kind}`, reason: null };
    return { deps: wired, onboardingId: started.value.onboardingId, state: outcome.value.state, reason: outcome.value.reason };
  } finally {
    composed.value.close();
  }
}

// The invocations of one purpose (the map unless told otherwise), oldest first.
const finishedEvents = (roots: CliRoots, purpose = 'map'): Array<Record<string, unknown>> =>
  rows<{ data_json: string }>(roots, "SELECT data_json FROM events WHERE type = 'invocation.finished' ORDER BY seq")
    .map((r) => JSON.parse(r.data_json) as Record<string, unknown>)
    .filter((event) => event['purpose'] === purpose);

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('every containment layer is checked at launch, after the files are written (SC3)', () => {
  const MUTATIONS: ReadonlyArray<readonly [name: string, rule: string, mutate: (settingsFile: string) => void]> = [
    ['the settings file is gone', 'enforcement_failure:settings-missing', (f) => rmSync(f)],
    [
      'the sandbox is switched off in the settings',
      'enforcement_failure:settings-key:sandbox.enabled',
      (f) => edit(f, (j) => ((j['sandbox'] as Record<string, unknown>)['enabled'] = false)),
    ],
    [
      'the permission mode is bypassPermissions',
      'enforcement_failure:settings-key:permissions.defaultMode',
      (f) => edit(f, (j) => ((j['permissions'] as Record<string, unknown>)['defaultMode'] = 'bypassPermissions')),
    ],
    ['the hooks are removed', 'enforcement_failure:hook-missing', (f) => edit(f, (j) => delete j['hooks'])],
    [
      'the hook no longer blocks on failure',
      'enforcement_failure:hook-not-blocking',
      (f) => edit(f, (j) => delete (((j['hooks'] as Record<string, unknown[]>)['PreToolUse'] as Array<{ hooks: Array<Record<string, unknown>> }>)[0] as { hooks: Array<Record<string, unknown>> }).hooks[0]?.['onFailure']),
    ],
    [
      'the hook script is not there',
      'enforcement_failure:hook-script-unreadable',
      (f) =>
        edit(f, (j) => {
          const entry = (((j['hooks'] as Record<string, unknown[]>)['PreToolUse'] as Array<{ hooks: Array<{ args: string[] }> }>)[0] as { hooks: Array<{ args: string[] }> }).hooks[0] as { args: string[] };
          entry.args = entry.args.map((a) => (a.endsWith('pre-tool-use.ts') ? '/nonexistent/pre-tool-use.ts' : a));
        }),
    ],
  ];

  function edit(file: string, change: (json: Record<string, unknown>) => unknown): void {
    const json = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    change(json);
    writeFileSync(file, JSON.stringify(json));
  }

  for (const [name, rule, mutate] of MUTATIONS) {
    it(`blocks with enforcement_failure and starts nothing when ${name}`, async () => {
      const s = setup({ transcript: 'success', mapFiles: 'all' });
      const run = await inProcess(s, { onBeforeSpawn: ({ files }) => mutate(files.settingsFile) });
      assert.deepEqual([run.state, run.reason], ['blocked', 'enforcement_failure']);
      assert.equal(s.fake.started(), false, 'the host was never started');
      const [step] = launchSteps(s.roots);
      assert.equal(step?.status, 'failed');
      assert.equal(step?.result['rule'], rule);
    });
  }

  it('blocks with enforcement_failure when the sandbox probe fails, before anything is launched', async () => {
    const s = setup({ transcript: 'success', mapFiles: 'all' });
    const run = await inProcess(s, { sandboxProbe: ['/usr/bin/false'] });
    assert.deepEqual([run.state, run.reason], ['blocked', 'enforcement_failure']);
    assert.equal(s.fake.started(), false);
    assert.equal(launchSteps(s.roots).length, 0, 'no launch was even recorded: the enforcement check came first');
  });

  it('refuses when the hook allows the synthetic write: a hook that would not stop a write is no enforcement', () => {
    for (const [name, source] of [['allows everything', 'process.exit(0);\n'], ['crashes', 'process.exit(1);\n'], ['prints an allow', 'console.log(JSON.stringify({ hookSpecificOutput: { permissionDecision: "allow" } }));\n']] as const) {
      const s = setup({ transcript: 'success', mapFiles: 'all' });
      const hook = join(s.fake.dir, 'hook.mjs');
      writeFileSync(hook, source);
      const r = onboard(s, { AVARICE_HOOK_ENTRY: hook });
      assert.match(r.stdout + r.stderr, /blocked \(enforcement_failure\)/, `${name}: ${r.stdout}${r.stderr}`);
      assert.equal(s.fake.started(), false, `${name}: the host was never started`);
      assert.equal(launchSteps(s.roots)[0]?.result['rule'], 'enforcement_failure:hook-self-test', name);
    }
  });

  it('records why the production host is the unavailable one, in the descriptor adapter_configs keeps', () => {
    const s = setup({ version: '2.1.400 (Claude Code)', transcript: 'success' });
    onboard(s);
    const [host] = rows<{ adapter: string; descriptor_json: string }>(s.roots, "SELECT adapter, descriptor_json FROM adapter_configs WHERE port = 'agent-host'");
    assert.equal(host?.adapter, 'unavailable');
    const attributes = (JSON.parse(host?.descriptor_json ?? '{}') as { attributes: Record<string, string> }).attributes;
    assert.equal(attributes['enforcement'], 'none');
    assert.equal(attributes['reason'], 'enforcement_failure:host-version-not-admitted:2.1.400');
  });
});

describe('the wall clock, the process group and the outcome kinds (ONB-8, CON-13)', () => {
  it('ends an overrunning host with SIGTERM, leaves no process in its group, and retries once before it blocks', async () => {
    const s = setup({ transcript: 'success', mapFiles: 'all', sleepMs: 120_000, background: true });
    const run = await inProcess(s, { killGraceMs: 400 }, (adapter) => new ClampedHost(adapter, 600));
    assert.deepEqual([run.state, run.reason], ['blocked', 'decision']);
    const launches = s.fake.launches();
    assert.equal(launches.length, 2, 'one launch and the one retry the contract allows');
    for (const l of launches) assert.equal(alive(l.pid), false, 'the host is gone');
    assert.equal(s.fake.children().length, 2, 'each launch started a background process in its group');
    for (const pid of s.fake.children()) assert.equal(alive(pid), false, 'and so is everything the host left running in its group');
    const finished = finishedEvents(s.roots);
    assert.deepEqual(finished.map((f) => [f['outcome'], f['timedOut'], f['signal']]), [['inconclusive', true, 'SIGTERM'], ['inconclusive', true, 'SIGTERM']]);
    assert.deepEqual(launchSteps(s.roots).map((l) => l.result['kind']), ['inconclusive', 'inconclusive']);
  });

  it('judges an inconclusive ending by what staging holds: the retry rule completes a run whose second launch finishes', async () => {
    const s = setup({ transcript: 'success', mapFiles: 'all', sleepMs: 120_000, sleepFirstOnly: true });
    const run = await inProcess(s, { killGraceMs: 400 }, (adapter) => new ClampedHost(adapter, 600));
    assert.deepEqual([run.state, run.reason], ['active', null]);
    assert.deepEqual(finishedEvents(s.roots).map((f) => f['outcome']), ['inconclusive', 'progressed']);
  });

  it('follows SIGTERM with SIGKILL after the grace when the host ignores SIGTERM', async () => {
    const s = setup({ transcript: 'success', mapFiles: 'all', sleepMs: 120_000, ignoreSigterm: true });
    const started = Date.now();
    const run = await inProcess(s, { killGraceMs: 300 }, (adapter) => new ClampedHost(adapter, 300));
    assert.equal(run.state, 'blocked');
    const [first] = finishedEvents(s.roots);
    assert.deepEqual([first?.['outcome'], first?.['timedOut'], first?.['signal']], ['inconclusive', true, 'SIGKILL']);
    for (const l of s.fake.launches()) assert.equal(alive(l.pid), false);
    assert.ok(Date.now() - started < 30_000, 'the host did not hold the run');
  });

  it('calls a moved staging HEAD a containment finding and failed, even though the map files are there', async () => {
    const s = setup({ transcript: 'success', mapFiles: 'all', commit: true });
    const run = await inProcess(s);
    assert.deepEqual([run.state, run.reason], ['blocked', 'decision']);
    assert.equal(launchSteps(s.roots)[0]?.result['kind'], 'failed');
    assert.equal(finishedEvents(s.roots)[0]?.['headMoved'], true);
    const findings = rows<{ data_json: string }>(s.roots, "SELECT data_json FROM events WHERE type = 'containment.finding'").map((r) => JSON.parse(r.data_json) as Record<string, unknown>);
    assert.ok(findings.some((f) => f['check'] === 'staging-head-moved'), 'a staging-head-moved finding is recorded');
  });

  it('maps hook budget_exhausted denials to budget_exhausted, even when the host says success and the files are there', async () => {
    const s = setup({ transcript: 'success', mapFiles: 'all' });
    const run = await inProcess(s, { countHookDenies: () => ({ ok: true, value: { total: 2, budget: 2 } }) });
    assert.deepEqual([run.state, run.reason], ['blocked', 'budget_exhausted']);
    assert.equal(launchSteps(s.roots)[0]?.result['kind'], 'budget_exhausted');
  });

  it('reads stdout that arrives in small pieces, and keeps at most the transcript cap of it', async () => {
    const s = setup({ transcript: 'success', mapFiles: 'all', chunkBytes: 37 });
    const run = await inProcess(s, { maxTranscriptBytes: 1500 });
    assert.equal(run.state, 'active', 'the result was parsed from all of the output, not only the kept part');
    const [artifact] = rows<{ digest: string; size: number }>(s.roots, "SELECT digest, size FROM artifacts WHERE kind = 'transcript'");
    assert.ok(artifact);
    const hex = artifact.digest.replace('sha256:', '');
    const stored = readFileSync(join(s.roots.AVARICE_DATA_ROOT, 'artifacts', hex.slice(0, 2), hex), 'utf8');
    assert.match(stored, /\[avarice: transcript truncated at 1500 bytes\]/);
    assert.ok(Buffer.byteLength(stored) < 1500 + 100);
  });

  it('returns cancelled and starts nothing when the signal is already aborted', async () => {
    const s = setup({ transcript: 'success' });
    let seen: Result<InvocationOutcome> | undefined;
    const run = await inProcess(s, {}, (adapter) => ({
      get descriptor() {
        return adapter.descriptor;
      },
      async invoke(req, _signal) {
        seen = await adapter.invoke(req, AbortSignal.abort());
        return seen;
      },
    }));
    assert.deepEqual(seen && !seen.ok ? seen.error : seen, { kind: 'cancelled', sideEffect: 'none' });
    assert.equal(run.state, 'error:cancelled');
    assert.equal(s.fake.started(), false);
  });
});

describe('ClaudeHostAdapter.reap', () => {
  // reap needs none of the launch inputs: it searches the process table for the session ID.
  function reaper(): ClaudeHostAdapter {
    const root = makeRoots();
    cleanup.push(root.base);
    return new ClaudeHostAdapter({
      claudeBin: '/nonexistent/claude',
      hookEntry: HOOK_ENTRY,
      ledgerPath: join(root.base, 'state.db'),
      dataRoot: root.AVARICE_DATA_ROOT,
      gsd: { gsdCoreDir: root.base, agentsDir: root.base, skillsRoot: root.base },
      artifacts: new LocalArtifactStore(root.AVARICE_DATA_ROOT),
      staging: createStagingWorkspace(STAGING_STRATEGY),
      countHookDenies: () => ({ ok: true, value: { total: 0, budget: 0 } }),
    });
  }

  it('ends a process that carries the session ID, with its group, and reports one terminated', async () => {
    const adapter = reaper();
    // Unique per run: reap finds processes by this ID in the whole process table, so a fixed ID lets two suites on one machine end each other's child.
    const sessionId = randomUUID();
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)', '--', '--session-id', sessionId], { detached: true, stdio: 'ignore' });
    child.unref();
    assert.ok(child.pid !== undefined && alive(child.pid));
    // The process must still be running after node has parsed its arguments, or reap has nothing to find and the result
    // depends on whether pgrep wins a race with the child's start-up.
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.ok(alive(child.pid), 'the process that carries the session ID is still running');
    const reaped = await adapter.reap({ sessionId });
    assert.deepEqual(reaped, { ok: true, value: { terminated: 1 } });
    assert.equal(alive(child.pid), false);
  });

  it('reports none terminated when no process carries the session ID, and refuses an ID that is not a UUID', async () => {
    const adapter = reaper();
    assert.deepEqual(await adapter.reap({ sessionId: '11111111-2222-4333-8444-555555555555' }), { ok: true, value: { terminated: 0 } });
    const refused = await adapter.reap({ sessionId: '.* --session-id' });
    assert.equal(refused.ok, false);
  });
});

describe('the GSD shim preamble fingerprint', () => {
  it('is read from the located gsd-core and equals the fingerprint spike S0-A recorded', () => {
    const located = locateGsdCore(process.env);
    assert.ok(located.ok, 'gsd-core is installed');
    const fingerprint = fingerprintGsdPreamble(located.value.gsdCoreDir);
    assert.ok(fingerprint.ok);
    const recorded = (JSON.parse(readFileSync(join(REPO_ROOT, 'spikes', 'slice-0-wave-0', 'results.json'), 'utf8')) as { spikes: Record<string, { preamble: { sha256: string; chars: number } }> }).spikes['S0-A']?.preamble;
    assert.deepEqual(fingerprint.value, { sha256: recorded?.sha256, length: recorded?.chars });
    assert.equal(fingerprint.value.sha256, GSD_PREAMBLE_SHA256);
  });

  it('is not found in a directory without the workflow, which keeps the production host from being admitted', () => {
    const empty = realpathSync(makeRoots().base);
    cleanup.push(empty);
    const fingerprint = fingerprintGsdPreamble(empty);
    assert.equal(fingerprint.ok, false);
  });
});
