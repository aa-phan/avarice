// Test-only CLI entry: the production main() with a fake AgentHost injected. Options for the fake host
// arrive as JSON in AVARICE_FAKE_HOST: an object with a `run` key selects the run host (test/helpers/fake-run-host.ts, which plays a
// `/gsd-quick` unit through the real hook entry), anything else the onboarding host. bin/avarice.ts never reads that variable and never
// imports this file.
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../../src/cli/main.ts';
import { FakeAgentHost } from './fake-agent-host.ts';
import { FakeRunHost } from './fake-run-host.ts';
import { InheritedSandboxExecutor } from './inherited-sandbox-executor.ts';
import type { FakeHostOptions } from './fake-agent-host.ts';
import type { Notifier } from '../../src/ports/notifier.ts';
import type { FakeRunOptions } from './fake-run-host.ts';

// `node --test` with no file list also loads every file under test/. Under the runner NODE_TEST_CONTEXT is
// set (runCli deletes it for real invocations), so the helper does nothing instead of running main().
// A test entry never posts a real banner: its notifier accepts every message and shows nothing. A test of the real osascript adapter sets
// AVARICE_TEST_NOTIFIER=local and points notify.local.osascriptPath in the profile config at test/helpers/fake-osascript.mjs.
const SILENT_NOTIFIER: Notifier = {
  descriptor: { port: 'notifier', adapter: 'test-silent', version: '0.0.0', capabilities: {}, offline: true },
  deliver: () => Promise.resolve({ ok: true, value: undefined }),
};

// Test-only hooks of the race suite (plan 03-26), both off unless their variable is set; bin/avarice.ts never reads either.
//
// AVARICE_TEST_HOLD=<dir>: a fault point (AVARICE_FAULT) that would kill this process holds it instead. The process writes `<dir>/reached`, waits for
//   `<dir>/go`, and then either goes on (the point is disarmed for the rest of the process) or, when `go` says `kill`, dies there as the fault would. This
//   lets a test act in another process in the exact window between two writes of the supervisor (the window `decide` races), which a kill cannot hold open.
//   The wait blocks the event loop on purpose: it is a process stopped at that point, and its lease is renewed by nobody meanwhile (a test that holds sets a
//   lease long enough).
// AVARICE_TEST_EXIT_LOG=<file>: every process of the test CLI appends {pid, argv, code} when it exits, so a test can read the exit code of the detached
//   supervisors that no one waits for.
if (process.env['NODE_TEST_CONTEXT'] === undefined) {
  const holdDir = process.env['AVARICE_TEST_HOLD'];
  if (holdDir !== undefined && holdDir !== '') {
    const realKill = process.kill.bind(process);
    let released = false;
    process.kill = ((pid: number, signal?: string | number): boolean => {
      if (pid !== process.pid || signal !== 'SIGKILL') return realKill(pid, signal);
      if (released) return true;
      const goFile = join(holdDir, 'go');
      writeFileSync(join(holdDir, 'reached.tmp'), `${JSON.stringify({ pid: process.pid, argv: process.argv.slice(2) })}\n`);
      renameSync(join(holdDir, 'reached.tmp'), join(holdDir, 'reached'));
      const giveUpAt = Date.now() + 120_000;
      while (!existsSync(goFile)) {
        if (Date.now() > giveUpAt) return realKill(pid, signal);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      }
      if (readFileSync(goFile, 'utf8').trim() === 'kill') return realKill(pid, signal);
      released = true;
      return true;
    }) as typeof process.kill;
  }
  const exitLog = process.env['AVARICE_TEST_EXIT_LOG'];
  if (exitLog !== undefined && exitLog !== '') {
    process.on('exit', (code) => {
      appendFileSync(exitLog, `${JSON.stringify({ pid: process.pid, argv: process.argv.slice(2), code })}\n`);
    });
  }
  const raw = process.env['AVARICE_FAKE_HOST'];
  const options = (raw === undefined || raw === '' ? {} : JSON.parse(raw)) as FakeHostOptions & { run?: FakeRunOptions };
  // Under the offline wrapper the whole process is already inside a sandbox, which cannot nest.
  const outer = process.env['AVARICE_TEST_OUTER_SANDBOX'] === '1';
  const host = options.run !== undefined ? new FakeRunHost(options.run) : new FakeAgentHost(options);
  process.exitCode = await main(process.argv.slice(2), { host, ...(process.env['AVARICE_TEST_NOTIFIER'] === 'local' ? {} : { notifier: SILENT_NOTIFIER }), ...(outer ? { executor: new InheritedSandboxExecutor() } : {}) });
}
