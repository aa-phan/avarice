// Test-only CLI entry: the production main() with the fake AgentHost injected. Options for the fake host
// arrive as JSON in AVARICE_FAKE_HOST. bin/avarice.ts never reads that variable and never imports this file.
import { main } from '../../src/cli/main.ts';
import { FakeAgentHost } from './fake-agent-host.ts';
import type { FakeHostOptions } from './fake-agent-host.ts';

// `node --test` with no file list also loads every file under test/. Under the runner NODE_TEST_CONTEXT is
// set (runCli deletes it for real invocations), so the helper does nothing instead of running main().
if (process.env['NODE_TEST_CONTEXT'] === undefined) {
  const raw = process.env['AVARICE_FAKE_HOST'];
  const options = (raw === undefined || raw === '' ? {} : JSON.parse(raw)) as FakeHostOptions;
  process.exitCode = await main(process.argv.slice(2), { host: new FakeAgentHost(options) });
}
