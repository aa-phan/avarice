// The CommandExecutor contract (plan 04-33; NFR-4): the behaviours every adapter of the port must show, as one case list. test/contract/local.test.ts runs it
// against the SandboxedExecutor and test/contract/fake-remote.test.ts against the fake-remote executor, so the two meet one contract. A Phase 7 adapter joins
// by adding a runner that passes its own factory to `runExecutorContract` (see test/contract/README.md).
//
// This module only defines cases and one registration function; importing it runs nothing (a bare `node --test` loads every file under test/).
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { Result } from '../../src/domain/result.ts';
import type { CommandExecutor, CommandResult, CommandSpec } from '../../src/ports/command-executor.ts';
import { makeScratchStaging, spec } from '../helpers/sandbox.ts';

export interface ExecutorContext {
  // A scratch tree: `root` is the working directory, `<root>/.planning` is the one directory the cases declare writable, `base` is outside it.
  root: string;
  base: string;
  // A command spec for this case with its own invocation identifier.
  spec(argv: readonly string[], overrides?: Partial<CommandSpec>): CommandSpec;
}

export interface ExecutorCase {
  name: string;
  run(executor: CommandExecutor, context: ExecutorContext): Promise<void>;
}

// A remote adapter may report a command it could not see the end of as an error that names the side effect; a local one reports the status on the result. The
// contract accepts either shape for the two endings that depend on a clock or a caller, and nothing else.
type Ending = 'timed_out' | 'cancelled';
function assertEnded(result: Result<CommandResult>, ending: Ending): void {
  if (result.ok) {
    assert.equal(result.value.status, ending, `status ${result.value.status}`);
    return;
  }
  const kind = ending === 'timed_out' ? 'timeout' : 'cancelled';
  assert.equal(result.error.kind, kind, JSON.stringify(result.error));
  assert.ok(result.error.kind === 'timeout' || result.error.kind === 'cancelled');
  assert.ok(result.error.sideEffect === 'none' || result.error.sideEffect === 'unknown', 'the error names the side effect');
}

async function runOk(executor: CommandExecutor, command: CommandSpec): Promise<CommandResult> {
  const result = await executor.run(command);
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}

export const EXECUTOR_CASES: readonly ExecutorCase[] = [
  {
    name: 'reports a passing command: exit status 0, its output captured',
    async run(executor, context) {
      const result = await runOk(executor, context.spec(['sh', '-c', 'echo out; echo err >&2']));
      assert.equal(result.status, 'passed');
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, 'out\n');
      assert.equal(result.stderr, 'err\n');
      assert.equal(result.truncated, false);
    },
  },
  {
    name: 'reports a failing command: its own exit status and the output it wrote before it failed',
    async run(executor, context) {
      const result = await runOk(executor, context.spec(['sh', '-c', 'echo before; exit 3']));
      assert.equal(result.status, 'failed');
      assert.equal(result.exitCode, 3);
      assert.equal(result.stdout, 'before\n');
    },
  },
  {
    name: 'cuts a stream at the output limit and says so',
    async run(executor, context) {
      const result = await runOk(executor, context.spec(['sh', '-c', 'yes x | head -c 100000'], { outputLimitBytes: 1000 }));
      assert.equal(result.truncated, true);
      assert.ok(result.stdout.length < 1200, `stdout kept ${result.stdout.length} characters`);
      assert.match(result.stdout, /output truncated/);
    },
  },
  {
    name: 'a command over its timeout ends timed_out',
    async run(executor, context) {
      const started = Date.now();
      const result = await executor.run(context.spec(['sh', '-c', 'sleep 30'], { timeoutMs: 1000 }));
      assertEnded(result, 'timed_out');
      assert.ok(Date.now() - started < 15_000, 'it ended long before the sleep would');
    },
  },
  {
    name: 'an abort through the signal ends the command cancelled',
    async run(executor, context) {
      const controller = new AbortController();
      const started = Date.now();
      const pending = executor.run(context.spec(['sh', '-c', 'sleep 30'], { timeoutMs: 60_000 }), controller.signal);
      setTimeout(() => controller.abort(), 300);
      assertEnded(await pending, 'cancelled');
      assert.ok(Date.now() - started < 15_000, 'it ended long before the sleep would');
    },
  },
  {
    name: 'a signal that is already aborted runs nothing',
    async run(executor, context) {
      const marker = join(context.root, '.planning', 'ran.txt');
      const controller = new AbortController();
      controller.abort();
      const result = await executor.run(context.spec(['sh', '-c', `echo ran > ${marker}`], { writePaths: [join(context.root, '.planning')] }), controller.signal);
      assertEnded(result, 'cancelled');
      assert.equal(existsSync(marker), false, 'the command was never started');
    },
  },
  {
    name: 'gives the command only the environment it was given',
    async run(executor, context) {
      const result = await runOk(executor, context.spec(['/usr/bin/env'], { env: { PATH: '/usr/bin:/bin', ONLY: 'this' } }));
      const lines = result.stdout.trim().split('\n').filter((l) => !/^(PWD|OLDPWD|_|SHLVL)=/.test(l));
      assert.deepEqual(lines.sort(), ['ONLY=this', 'PATH=/usr/bin:/bin']);
    },
  },
  {
    name: 'denies the network, a local server included',
    async run(executor, context) {
      let hits = 0;
      const server = createServer((_req, res) => {
        hits += 1;
        res.end('reachable');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
        const result = await runOk(executor, context.spec(['curl', '-sS', '--noproxy', '*', '--max-time', '5', url]));
        assert.equal(result.status, 'failed');
        assert.notEqual(result.exitCode, 0);
        assert.equal(hits, 0, 'the server saw no request');
      } finally {
        server.close();
      }
    },
  },
  {
    name: 'a write outside the declared roots fails and changes nothing; a write inside them works',
    async run(executor, context) {
      const writable = join(context.root, '.planning');
      const outside = join(context.root, 'src', 'b.ts');
      const denied = await runOk(executor, context.spec(['sh', '-c', `echo hostile > ${outside}`], { writePaths: [writable] }));
      assert.equal(denied.status, 'failed', denied.stderr);
      assert.equal(existsSync(outside), false, 'nothing was written outside the declared roots');
      assert.equal(readFileSync(join(context.root, 'src', 'a.ts'), 'utf8'), 'export const a = 1;\n');
      const allowed = await runOk(executor, context.spec(['sh', '-c', 'echo fine > .planning/ok.txt'], { writePaths: [writable] }));
      assert.equal(allowed.status, 'passed', allowed.stderr);
      assert.equal(readFileSync(join(writable, 'ok.txt'), 'utf8'), 'fine\n');
    },
  },
  {
    name: 'a read of a denied path fails and the same read elsewhere works',
    async run(executor, context) {
      const secret = join(context.base, 'secrets');
      mkdirSync(secret, { recursive: true });
      writeFileSync(join(secret, 'token'), 'hunter2\n');
      const denied = await runOk(executor, context.spec(['cat', join(secret, 'token')], { denyReadPaths: [secret] }));
      assert.equal(denied.status, 'failed');
      assert.ok(!denied.stdout.includes('hunter2'));
      const allowed = await runOk(executor, context.spec(['cat', join(secret, 'token')]));
      assert.equal(allowed.stdout, 'hunter2\n');
    },
  },
  {
    name: 'refuses a spec that is not a runnable command with `invalid`, and runs nothing',
    async run(executor, context) {
      const marker = join(context.root, '.planning', 'ran.txt');
      for (const bad of [context.spec([]), context.spec(['sh', '-c', `echo ran > ${marker}`], { cwd: 'relative/dir', writePaths: [join(context.root, '.planning')] }), context.spec(['true'], { timeoutMs: 0 })]) {
        const result = await executor.run(bad);
        assert.ok(!result.ok, JSON.stringify(result));
        assert.equal(result.error.kind, 'invalid');
      }
      assert.equal(existsSync(marker), false);
    },
  },
];

export interface ExecutorContractOptions {
  // Skip the whole list, with the reason (the sandbox is macOS-only).
  skip?: string | false;
}

// Registers every case against the executor the factory makes. The factory is called once per case, so a case never inherits the state of another.
export function runExecutorContract(make: () => CommandExecutor, cleanup: string[], options: ExecutorContractOptions = {}): void {
  let counter = 0;
  for (const contract of EXECUTOR_CASES) {
    it(contract.name, { skip: options.skip ?? false }, async () => {
      const staging = makeScratchStaging();
      cleanup.push(staging.base);
      counter += 1;
      const invocation = `contract-${counter}`;
      await contract.run(make(), { root: staging.root, base: staging.base, spec: (argv, overrides = {}) => spec(staging.root, argv, { invocationId: invocation, ...overrides }) });
    });
  }
}

// For a runner's own `after`: removes the scratch trees the cases made.
export function removeAll(paths: readonly string[]): void {
  for (const path of paths) rmSync(path, { recursive: true, force: true });
}
