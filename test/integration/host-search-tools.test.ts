// The no-spend probe of the pinned host: does a session launched with AVARICE's own launch line keep the host's Glob and Grep tools, for the unit and for each run agent? (plan 03-69;
// AUT-1, CON-15; the owner's brief-harness-defect ruling on run 3's attempt 1, D-26, D-27.) The admitted host removes Glob and Grep from a session that has a shell, and from every
// agent that session resolves, unless the launch line names one of them. Run 3's verifier and executor therefore had no content search, and the hook refuses shell grep by design.
//
// No spend, no credential. The real host binary named by AVARICE_CLAUDE_BIN (skipped unless it names an admitted version) is started with the argument list, working directory and
// environment that the real ClaudeHostAdapter produced for a run invocation (read back from a fake claude that records them), except that HOME and CLAUDE_CONFIG_DIR are fresh
// temporary directories and the model server is a node http server bound to 127.0.0.1 on a free port. The server records only the path and the `tools[].name` list of each POST under
// /v1/messages and answers 500 with an error body, with a dummy key. The host runs detached in its own process group; once both its init event and one recorded request with
// tools are seen, the group is killed with SIGKILL and the server closed. A launch times out after 120 s with the stderr tail. The probe never reads or prints the owner's
// credentials, a request header or a prompt.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalArtifactStore } from '../../src/adapters/fs/artifact-store.ts';
import { createStagingWorkspace, STAGING_STRATEGY } from '../../src/adapters/git/staging-strategy.ts';
import { ClaudeHostAdapter } from '../../src/adapters/host-claude/claude-host.ts';
import { ADMITTED_CLAUDE_VERSIONS } from '../../src/adapters/host-claude/launch-preflight.ts';
import { fingerprintGsdPreamble } from '../../src/adapters/gsd/preamble.ts';
import { locateGsdCore } from '../../src/adapters/gsd/locate.ts';
import { computeRunScope, runScopeDirs } from '../../src/domain/invocation-scope.ts';
import type { InvocationRequest } from '../../src/ports/agent-host.ts';
import { makeFakeClaude } from '../helpers/fake-claude.ts';
import { REPO_ROOT, makeRoots } from '../helpers/run-cli.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';

const HOOK_ENTRY = join(REPO_ROOT, 'src', 'hook', 'pre-tool-use.ts');
const REPO_FILES = { 'README.md': '# scratch\n', 'package.json': '{"name":"scratch"}\n', 'src/index.ts': 'export const answer = 42;\n' };
const RUN_AGENTS = ['gsd-planner', 'gsd-plan-checker', 'gsd-executor', 'gsd-verifier'] as const;
const LAUNCH_TIMEOUT_MS = 120_000;

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

// The host named by AVARICE_CLAUDE_BIN, when it is an admitted version.
function skipReason(): string | false {
  const bin = process.env['AVARICE_CLAUDE_BIN'] ?? '';
  if (bin === '') return 'AVARICE_CLAUDE_BIN is not set: the probe needs the real pinned claude binary';
  const ran = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 30_000 });
  const version = /^(\d+\.\d+\.\d+)/.exec(ran.stdout ?? '')?.[1];
  if (version === undefined || !ADMITTED_CLAUDE_VERSIONS.includes(version)) return `AVARICE_CLAUDE_BIN reports ${version ?? 'no version'}, which is not an admitted host version`;
  return false;
}

interface Launched {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
}

// One run-purpose invocation of the real ClaudeHostAdapter against a fake claude, built as claude-host.test.ts builds a run owner; what the fake recorded is what the adapter produced.
async function adapterLaunch(): Promise<Launched> {
  const roots = makeRoots();
  const repo = makeScratchRepo({ files: REPO_FILES });
  const fake = makeFakeClaude({ transcript: 'success' });
  cleanup.push(roots.base, repo.base, fake.dir);
  const configDir = join(roots.base, 'claude-config');
  mkdirSync(join(configDir, 'skills', 'gsd-quick'), { recursive: true });
  writeFileSync(join(configDir, 'skills', 'gsd-quick', 'SKILL.md'), '---\nname: gsd-quick\ndescription: stand-in\n---\n');
  mkdirSync(roots.AVARICE_DATA_ROOT, { recursive: true });
  const runId = 'run_probe';
  const scratch = join(roots.AVARICE_WORK_ROOT, runId, 'scratch');
  mkdirSync(scratch, { recursive: true });
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CONFIG_DIR: configDir };
  const located = locateGsdCore(env);
  assert.ok(located.ok, 'gsd-core is installed');
  const preamble = fingerprintGsdPreamble(located.value.gsdCoreDir);
  assert.ok(preamble.ok, 'the GSD preamble is found');
  const files = { write: ['src/index.ts'], create: [], artifacts: ['.planning/quick/**'], protected: ['package.json'], secretGlobs: ['**/.env'] };
  const contract = { files, execution: { commands: ['npm test'] }, budgets: { subagentsTotal: 10, subagentsConcurrent: 2 } };
  const entries = (dir: string): string[] => (existsSync(join(repo.path, dir)) ? readdirSync(join(repo.path, dir)).sort() : []);
  const scope = computeRunScope({
    contract,
    clonePath: repo.path,
    repoPath: join(roots.base, 'source-repo'),
    dataRoot: roots.AVARICE_DATA_ROOT,
    home: join(roots.base, 'home'),
    workRoot: roots.AVARICE_WORK_ROOT,
    scratchDir: scratch,
    workspace: {
      topLevelEntries: readdirSync(repo.path).filter((name) => name !== '.git'),
      entriesByDir: Object.fromEntries(runScopeDirs(files).map((dir) => [dir, entries(dir)])),
      gitPaths: [join(repo.path, '.git')],
      repoReadAllow: [],
    },
    readRoots: [located.value.gsdCoreDir],
  });
  const adapter = new ClaudeHostAdapter({
    claudeBin: fake.bin,
    hookEntry: HOOK_ENTRY,
    ledgerPath: join(roots.AVARICE_DATA_ROOT, 'state.db'),
    dataRoot: roots.AVARICE_DATA_ROOT,
    gsd: { gsdCoreDir: located.value.gsdCoreDir, agentsDir: join(located.value.gsdCoreDir, '..', 'agents'), skillsRoot: join(configDir, 'skills'), preamble: preamble.value },
    artifacts: new LocalArtifactStore(roots.AVARICE_DATA_ROOT),
    staging: createStagingWorkspace(STAGING_STRATEGY),
    countHookDenies: () => ({ ok: true, value: { total: 0, budget: 0 } }),
    env,
  });
  const request: InvocationRequest = {
    onboardingId: 'onb_project',
    runId,
    invocationId: 'inv_probe',
    purpose: 'run',
    contractVersion: 1,
    contractDigest: 'd'.repeat(64),
    prompt: 'Say hello.',
    cwd: repo.path,
    model: 'sonnet',
    costCapUsd: 1,
    wallClockMs: 60_000,
    scope,
    extensions: { skills: ['gsd-quick'], agents: [...RUN_AGENTS] },
    expectedFiles: [],
    ownerKind: 'run',
    ownerId: runId,
  };
  const launched = await adapter.invoke(request, new AbortController().signal);
  assert.ok(launched.ok, JSON.stringify(launched));
  const [logged] = fake.argvs();
  const [loggedEnv] = fake.envs();
  assert.ok(logged !== undefined && loggedEnv !== undefined, 'the fake claude recorded the launch');
  return { argv: logged.argv, cwd: logged.cwd, env: loggedEnv };
}

interface Seen {
  // The tool names of the `system/init` event.
  init: string[];
  // The tool names of the first model request that carried tools.
  request: string[];
}

// Starts the real host with `argv` toward a local recorder and returns what it reported, then ends its process group.
async function probeHost(bin: string, launched: Launched, extraArgs: readonly string[]): Promise<Seen> {
  const home = mkdtempSync(join(tmpdir(), 'avarice-probe-home-'));
  const config = mkdtempSync(join(tmpdir(), 'avarice-probe-config-'));
  cleanup.push(home, config);
  // Each launch is its own session: a session ID that an earlier launch used is refused by the host.
  const argv = [...launched.argv];
  argv[argv.indexOf('--session-id') + 1] = randomUUID();
  argv.push(...extraArgs);

  const requests: string[][] = [];
  let wake: () => void = () => {};
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      if (req.method === 'POST' && (req.url ?? '').startsWith('/v1/messages')) {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { tools?: Array<{ name?: unknown }> };
          requests.push((body.tools ?? []).map((tool) => String(tool.name)));
        } catch {
          requests.push([]);
        }
      }
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'avarice offline probe' } }));
      wake();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  const env: Record<string, string> = {
    ...launched.env,
    HOME: home,
    CLAUDE_CONFIG_DIR: config,
    ANTHROPIC_API_KEY: 'sk-ant-dummy-probe-key',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
  const child = spawn(bin, argv, { cwd: launched.cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let init: string[] | undefined;
  let buffered = '';
  let stderrTail = '';
  let exited = false;
  child.stdout.on('data', (chunk: Buffer) => {
    buffered += chunk.toString('utf8');
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('{')) continue;
      try {
        const event = JSON.parse(line) as { type?: string; subtype?: string; tools?: unknown };
        if (event.type === 'system' && event.subtype === 'init' && Array.isArray(event.tools)) init = event.tools.map(String);
      } catch {
        // not an event line
      }
    }
    wake();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderrTail = `${stderrTail}${chunk.toString('utf8')}`.slice(-2000);
  });
  child.on('exit', () => {
    exited = true;
    wake();
  });
  const firstWithTools = (): string[] | undefined => requests.find((tools) => tools.length > 0);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`the host reported no init event and request within ${LAUNCH_TIMEOUT_MS / 1000} s; stderr tail: ${stderrTail}`)), LAUNCH_TIMEOUT_MS);
      wake = (): void => {
        if (init !== undefined && firstWithTools() !== undefined) {
          clearTimeout(timer);
          resolve();
        } else if (exited) {
          clearTimeout(timer);
          reject(new Error(`the host exited before its init event and a request with tools (init ${init === undefined ? 'missing' : 'seen'}, ${requests.length} requests); stderr tail: ${stderrTail}`));
        }
      };
      wake();
    });
    return { init: init ?? [], request: firstWithTools() ?? [] };
  } finally {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
    } catch {
      // already gone
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('the pinned host keeps Glob and Grep under AVARICE\'s own launch line (plan 03-69)', { skip: skipReason() }, () => {
  const bin = process.env['AVARICE_CLAUDE_BIN'] as string;
  let launched: Launched;
  before(async () => {
    launched = await adapterLaunch();
  });

  it('puts `--allowedTools Glob,Grep` on the launch line exactly once', () => {
    const at = launched.argv.reduce<number[]>((all, token, i) => (token === '--allowedTools' ? [...all, i] : all), []);
    assert.equal(at.length, 1, `--allowedTools occurs ${at.length} times in the adapter's argument list`);
    assert.equal(launched.argv[(at[0] as number) + 1], 'Glob,Grep');
  });

  it('gives the session Glob and Grep, in its init tools and in its first model request, and neither WebFetch nor WebSearch', async (t) => {
    const seen = await probeHost(bin, launched, []);
    t.diagnostic(`session init tools: ${seen.init.join(',')}; first request tools: ${seen.request.join(',')}`);
    for (const [where, tools] of [['init', seen.init], ['first request', seen.request]] as const) {
      assert.ok(tools.includes('Glob'), `${where} tools lack Glob: ${tools.join(',')}`);
      assert.ok(tools.includes('Grep'), `${where} tools lack Grep: ${tools.join(',')}`);
      assert.ok(!tools.includes('WebFetch') && !tools.includes('WebSearch'), `${where} tools hold a web tool: ${tools.join(',')}`);
    }
  });

  const agents = (): Record<string, { tools?: string[]; disallowedTools?: string[] }> =>
    JSON.parse(readFileSync(launched.argv[launched.argv.indexOf('--agents') + 1] as string, 'utf8')) as Record<string, { tools?: string[]; disallowedTools?: string[] }>;

  it('defines the four run agents with Grep and Glob among their tools', () => {
    const defined = agents();
    for (const name of RUN_AGENTS) {
      const tools = defined[name]?.tools ?? [];
      assert.ok(tools.includes('Grep') && tools.includes('Glob'), `${name} tools: ${tools.join(',')}`);
    }
  });

  for (const name of RUN_AGENTS) {
    it(`gives ${name}, launched as that agent, Grep and Glob and none of its disallowed tools`, async (t) => {
      const disallowed = agents()[name]?.disallowedTools ?? [];
      const seen = await probeHost(bin, launched, ['--agent', name]);
      t.diagnostic(`${name} init tools: ${seen.init.join(',')}; first request tools: ${seen.request.join(',')}`);
      for (const [where, tools] of [['init', seen.init], ['first request', seen.request]] as const) {
        assert.ok(tools.includes('Grep') && tools.includes('Glob'), `${name} ${where} tools lack Grep or Glob: ${tools.join(',')}`);
        for (const tool of disallowed) assert.ok(!tools.includes(tool), `${name} ${where} tools hold the disallowed ${tool}: ${tools.join(',')}`);
      }
    });
  }
});
