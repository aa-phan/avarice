// The dependency install of a run (plan 02-14; D-11, T-02-47, T-02-SC): the conventions' install command runs in the run clone before the first invocation, with
// network only through an allowlisting proxy whose allowlist is the registry hosts on 443, and never for the agent. The registry here is a local TCP server and
// the installer is a script the scratch repository commits: nothing is downloaded. The proxy the supervisor uses is the real one, wrapped by the test only so
// that it also admits the local server's port (the conventions can name a host, not a port).
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import type { Server } from 'node:net';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startAllowlistProxy } from '../../src/adapters/exec/allowlist-proxy.ts';
import { SandboxedExecutor } from '../../src/adapters/exec/sandboxed-executor.ts';
import { buildInvocationEnv } from '../../src/adapters/host-claude/env.ts';
import { err } from '../../src/domain/result.ts';
import type { CommandExecutor } from '../../src/ports/command-executor.ts';
import type { EgressProxy } from '../../src/ports/egress-proxy.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { CHECK_SCRIPTS, FIXED_SLUG, RUN_BRIEF, RUN_CONVENTIONS, commitConventions, ledgerRows, makeRunRepo, onboardRunRepo, runInProcess, writeBrief } from '../helpers/run-fixtures.ts';
import type { InProcessRun } from '../helpers/run-fixtures.ts';

const cleanup: string[] = [];
const servers: Server[] = [];
after(() => {
  for (const server of servers) server.close();
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const LOCKFILE = '{\n  "name": "slugger",\n  "lockfileVersion": 3,\n  "packages": {}\n}\n';

// A registry that answers `pong` to anything.
async function registry(): Promise<number> {
  const server = createServer((socket) => {
    socket.on('data', () => socket.write('pong'));
    socket.on('error', () => undefined);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as { port: number }).port;
}

// The real allowlisting proxy, plus the local registry's port: the production code asks for `127.0.0.1:443`.
function proxyAlso(extra: readonly string[]): EgressProxy {
  return { start: (input) => startAllowlistProxy({ ...input, allow: [...input.allow, ...extra] }) };
}

interface Fixture {
  roots: CliRoots;
  brief: string;
  repo: ReturnType<typeof makeRunRepo>;
}

// A repository with a lockfile, a `.gitignore` for node_modules and the scripts, onboarded, with the conventions on top.
function fixture(dependencies: Record<string, unknown> | undefined): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepo({ ...CHECK_SCRIPTS, 'package-lock.json': LOCKFILE, '.gitignore': 'node_modules/\n' });
  cleanup.push(roots.base, repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo, { ...RUN_CONVENTIONS, agentCommands: ['npm test'], ...(dependencies !== undefined ? { dependencies } : {}) });
  return { roots, repo, brief: writeBrief(join(roots.base, 'briefs'), RUN_BRIEF) };
}

const install = (target: string, ...more: string[]): Record<string, unknown> => ({
  install: ['node', 'scripts/fake-install.mjs', target, ...more],
  lockfile: 'package-lock.json',
  registryHosts: ['127.0.0.1'],
});

const FIX = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' as const };

interface StepDb {
  step: string;
  status: string;
  result: Record<string, unknown>;
}
const stepsOf = (f: Fixture, runId: string): StepDb[] =>
  ledgerRows<{ step: string; status: string; result_json: string }>(f.roots, 'SELECT step, status, result_json FROM run_steps WHERE run_id = ? ORDER BY rowid', runId).map((s) => ({ step: s.step, status: s.status, result: JSON.parse(s.result_json) as Record<string, unknown> }));
const stepNamed = (f: Fixture, runId: string, name: string): StepDb | undefined => stepsOf(f, runId).find((s) => s.step === name);

describe('the install runs through the proxy, before the first invocation, and records what it did (D-11)', async () => {
  const port = await registry();
  const f = fixture(install(`127.0.0.1:${port}`));
  const ran: InProcessRun = await runInProcess(f.roots, f.repo, f.brief, FIX, { egress: proxyAlso([`127.0.0.1:${port}`]) });

  it('completes the step with the lockfile digest, the exit, the duration and the proxy attempt by host', () => {
    assert.equal(ran.state, 'ready_for_review');
    const step = stepNamed(f, ran.runId, 'deps:install');
    assert.equal(step?.status, 'completed');
    assert.equal(step?.result['outcome'], 'installed');
    assert.equal(step?.result['lockfileDigest'], `sha256:${createHash('sha256').update(LOCKFILE).digest('hex')}`);
    assert.equal(step?.result['exitCode'], 0);
    assert.equal(typeof step?.result['durationMs'], 'number');
    assert.deepEqual(step?.result['attempts'], [{ host: '127.0.0.1', port, allowed: true, count: 1 }]);
  });

  it('leaves node_modules in the run clone, and the step comes before validation, the baseline and the unit', () => {
    const clone = ledgerRows<{ workspace_path: string }>(f.roots, 'SELECT workspace_path FROM runs WHERE run_id = ?', ran.runId)[0]?.workspace_path as string;
    assert.ok(existsSync(join(clone, 'node_modules', 'x', 'index.js')));
    const names = stepsOf(f, ran.runId).map((s) => s.step);
    assert.ok(names.indexOf('deps:install') < names.indexOf('checks:validate'));
    assert.ok(names.indexOf('checks:validate') < names.indexOf('baseline'));
    assert.ok(names.indexOf('baseline') < names.indexOf('launch:run'));
  });

  it('installs again in the validation clone for the checks, and records that install in the validation step', () => {
    const validation = stepNamed(f, ran.runId, 'checks:validate');
    const summary = validation?.result['install'] as Record<string, unknown> | undefined;
    assert.equal(summary?.['outcome'], 'installed');
    assert.deepEqual(summary?.['attempts'], [{ host: '127.0.0.1', port, allowed: true, count: 1 }]);
  });

  it('gives the unit invocation no proxy variable and no network scope, whatever the supervisor process has', () => {
    const request = ran.host.calls[0];
    assert.ok(request, 'the unit was launched');
    assert.deepEqual(request.scope.allowedDomains, []);
    assert.doesNotMatch(JSON.stringify(request), /proxy|loopback/i);
    const env = buildInvocationEnv(
      { ...process.env, HTTPS_PROXY: 'http://127.0.0.1:1', https_proxy: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1', npm_config_proxy: 'http://127.0.0.1:1', npm_config_https_proxy: 'http://127.0.0.1:1' },
      { gsdCoreBin: '/gsd/bin', onboardingId: request.runId, marker: request.runId, scratchDir: join(f.roots.AVARICE_WORK_ROOT, request.runId, 'scratch') },
    );
    assert.deepEqual(Object.keys(env).filter((name) => /proxy/i.test(name)), [], 'no environment variable of the invocation names a proxy');
  });
});

describe('without a declared install the step is skipped and nothing is spawned', async () => {
  const f = fixture(undefined);
  const ran = await runInProcess(f.roots, f.repo, f.brief, FIX);

  it('records `skipped` with reason no-dependencies, and the run goes on', () => {
    assert.equal(ran.state, 'ready_for_review');
    const step = stepNamed(f, ran.runId, 'deps:install');
    assert.equal(step?.status, 'skipped');
    assert.equal(step?.result['reason'], 'no-dependencies');
    assert.deepEqual(step?.result['attempts'], []);
  });
});

describe('an install that goes wrong is a decision or an enforcement failure, never a run that goes on (D-11)', () => {
  it('a host that is not an allowed registry is refused by the proxy: blocked (decision) with a permission decision naming it', async () => {
    const f = fixture(install('example.invalid:443'));
    const ran = await runInProcess(f.roots, f.repo, f.brief, FIX);
    assert.deepEqual([ran.state, ran.reason], ['blocked_on_decision', 'decision']);
    const decision = ledgerRows<{ class: string; issue: string }>(f.roots, 'SELECT class, issue FROM decisions WHERE run_id = ?', ran.runId);
    assert.equal(decision[0]?.class, 'permission');
    assert.match(decision[0]?.issue as string, /example\.invalid:443/);
    const step = stepNamed(f, ran.runId, 'deps:install');
    assert.equal(step?.status, 'failed');
    assert.deepEqual(step?.result['attempts'], [{ host: 'example.invalid', port: 443, allowed: false, count: 1 }]);
    assert.equal(ran.host.calls.length, 0, 'no invocation');
    assert.equal(stepNamed(f, ran.runId, 'checks:validate'), undefined, 'no repository command ran after the failed install');
  });

  it('a failing install (exit 3) is blocked (decision) with a repeated_failure decision', async () => {
    const f = fixture(install('127.0.0.1:1', 'fail'));
    const ran = await runInProcess(f.roots, f.repo, f.brief, FIX);
    assert.deepEqual([ran.state, ran.reason], ['blocked_on_decision', 'decision']);
    const decision = ledgerRows<{ class: string; issue: string }>(f.roots, 'SELECT class, issue FROM decisions WHERE run_id = ?', ran.runId);
    assert.equal(decision[0]?.class, 'repeated_failure');
    assert.match(decision[0]?.issue as string, /exited 3/);
    assert.match(decision[0]?.issue as string, /install failed on purpose/);
  });

  it('no sandbox for the install is an enforcement failure, and so is a proxy that cannot start', async () => {
    const real = new SandboxedExecutor();
    const noInstall: CommandExecutor = { descriptor: real.descriptor, run: (cmd, signal) => (cmd.argv[1] === 'scripts/fake-install.mjs' ? Promise.resolve(err({ kind: 'unavailable', cause: 'forced' })) : real.run(cmd, signal)) };
    const f = fixture(install('127.0.0.1:1'));
    const first = await runInProcess(f.roots, f.repo, f.brief, FIX, { executor: noInstall });
    assert.deepEqual([first.state, first.reason], ['blocked_on_decision', 'enforcement_failure']);
    assert.equal(stepNamed(f, first.runId, 'deps:install')?.status, 'failed');

    const g = fixture(install('127.0.0.1:1'));
    const noProxy: EgressProxy = { start: () => Promise.resolve(err({ kind: 'unavailable', cause: 'forced' })) };
    const second = await runInProcess(g.roots, g.repo, g.brief, FIX, { egress: noProxy });
    assert.deepEqual([second.state, second.reason], ['blocked_on_decision', 'enforcement_failure']);
    assert.equal(second.host.calls.length, 0);
  });
});
