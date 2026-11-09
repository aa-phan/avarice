// Test-only CLI entry: the production main() with a fake AgentHost injected. Options for the fake host
// arrive as JSON in AVARICE_FAKE_HOST: an object with a `run` key selects the run host (test/helpers/fake-run-host.ts, which plays a
// `/gsd-quick` unit through the real hook entry), anything else the onboarding host. bin/avarice.ts never reads that variable and never
// imports this file.
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

if (process.env['NODE_TEST_CONTEXT'] === undefined) {
  const raw = process.env['AVARICE_FAKE_HOST'];
  const options = (raw === undefined || raw === '' ? {} : JSON.parse(raw)) as FakeHostOptions & { run?: FakeRunOptions };
  // Under the offline wrapper the whole process is already inside a sandbox, which cannot nest.
  const outer = process.env['AVARICE_TEST_OUTER_SANDBOX'] === '1';
  const host = options.run !== undefined ? new FakeRunHost(options.run) : new FakeAgentHost(options);
  process.exitCode = await main(process.argv.slice(2), { host, ...(process.env['AVARICE_TEST_NOTIFIER'] === 'local' ? {} : { notifier: SILENT_NOTIFIER }), ...(outer ? { executor: new InheritedSandboxExecutor() } : {}) });
}
