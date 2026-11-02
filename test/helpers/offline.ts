// Runs the test CLI (production main() plus the fake AgentHost) under the macOS sandbox with every network
// operation denied, so a test proves a command finishes with no network (NFR-2). The wrapper itself is proven
// to deny network in offline.test.ts. Every profile is a temp root from makeRoots(); nothing here touches the
// user's real profile.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, runCli } from './run-cli.ts';
import type { CliResult, CliRoots } from './run-cli.ts';
import type { FakeHostOptions } from './fake-agent-host.ts';

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
export const NO_NETWORK_PROFILE = '(version 1)(allow default)(deny network*)';
export const TEST_CLI = join(REPO_ROOT, 'test', 'helpers', 'test-cli.ts');
// Short lease so a killed run's lease can be taken over after EXPIRY_WAIT_MS, as in the fault suite.
export const OFFLINE_LEASE_TTL_MS = 200;
export const OFFLINE_EXPIRY_WAIT_MS = 400;

export function offlineAvailable(): boolean {
  return existsSync(SANDBOX_EXEC);
}

export interface OfflineOptions {
  roots: CliRoots;
  // Options for the fake host (AVARICE_FAKE_HOST).
  host?: FakeHostOptions;
  // Extra environment, for example AVARICE_FAULT.
  env?: Record<string, string | undefined>;
  // The production entry instead of the test entry (no fake host).
  entry?: string;
}

// Wraps any command line in the no-network sandbox.
export function offlineWrap(): readonly string[] {
  return [SANDBOX_EXEC, '-p', NO_NETWORK_PROFILE];
}

export function runOffline(argv: readonly string[], options: OfflineOptions): CliResult {
  return runCli(argv, {
    roots: options.roots,
    entry: options.entry ?? TEST_CLI,
    wrap: offlineWrap(),
    env: {
      AVARICE_FAKE_HOST: JSON.stringify(options.host ?? {}),
      AVARICE_LEASE_TTL_MS: String(OFFLINE_LEASE_TTL_MS),
      // `sandbox-exec` cannot nest, so the test entry swaps the executor for one that relies on this wrapper.
      AVARICE_TEST_OUTER_SANDBOX: '1',
      ...options.env,
    },
  });
}
