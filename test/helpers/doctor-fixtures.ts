// Fixtures of the `avarice doctor` tests (plan 04-25): a profile under a temp directory, a temp HOME, a gsd-core of a chosen version that is not the owner's, and the
// shape of the report. The test files register `after(disposeDoctorFixtures)`. A file under test/ that no test spawns must do nothing at import time, so nothing here runs.
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFakeGsdCore } from './fake-gsd-core.ts';
import { PRODUCTION_ENTRY, makeRoots, runCli } from './run-cli.ts';
import type { CliResult, CliRoots } from './run-cli.ts';

const cleanup: string[] = [];
export function disposeDoctorFixtures(): void {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export interface Finding {
  level: 'error' | 'warning';
  area: string;
  message: string;
  fix: string;
}

// The report as the tests read it; only the keys a case asserts on are typed.
export interface Report {
  profile: { name: string | null; class: string | null; roots: { configHome: string; dataRoot: string; workRoot: string } | null; local: boolean | null; credentials: Array<{ name: string; reference: string }> };
  runtime: { node: { version: string; engines: string | null; ok: boolean }; sqlite: { version: string | null; ok: boolean } };
  store: { path: string | null; state: string; schema: number | null; expectedSchema: number; journalMode: string | null; integrity: string | null; lastBackup: string | null };
  host: { claudeBin: string | null; claudeVersion: string | null; admission: string; refusal: string | null; restricted: boolean; enforcement: string; sandbox: string; hookEntry: string; attended: string; configDir: string };
  gsd: { state: string; version: string | null; location: string | null; admitted: string; detail: string | null };
  graphify: { state: string; version: string | null; path: string | null };
  adapters: Array<{ name: string; port: string; adapter: string }>;
  runs: { read: boolean; total: number; byState: Record<string, number>; interrupted: Array<{ kind: string; id: string; resume: string }> };
  records: Array<{ projectId: string; repoPath: string; version: number; onboardedRevision: string; gsdVersion: string; compatibility: string; reason: string | null }>;
  findings: Finding[];
  online?: { checks: Array<{ name: string; reference: string; status: string }>; note: string | null };
  repair?: { removed: number; kept: number };
  extensions?: { activeConfigDir: string; configDirs: Array<{ path: string; active: boolean; exists: boolean; attendedHookEntries: number; skills: string[] }> };
}

export interface DoctorFixture {
  roots: CliRoots;
  // The temp directory standing in for the owner's home: `~/.claude` is `<home>/.claude`.
  home: string;
  env: Record<string, string>;
}

export function temp(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `avarice-${prefix}-`)));
  cleanup.push(dir);
  return dir;
}

export function fakeGsd(version: string): string {
  return writeFakeGsdCore(temp(`doctor-gsd-${version}`), { version });
}

// A profile under a temp directory, a temp HOME, a gsd-core 1.17.0 that is not the owner's, no claude and no graphify. Nothing under the real home is read or written.
export function doctorFixture(extraEnv: Record<string, string> = {}): DoctorFixture {
  const roots = makeRoots();
  cleanup.push(roots.base);
  const home = realpathSync(roots.base);
  return { roots, home, env: { HOME: home, GSD_HOME: fakeGsd('1.17.0'), AVARICE_GRAPHIFY_BIN: '/nonexistent', ...extraEnv } };
}

export function doctor(f: DoctorFixture, argv: readonly string[] = [], extraEnv: Record<string, string | undefined> = {}, cwd?: string): CliResult {
  return runCli(['doctor', ...argv], { roots: f.roots, entry: PRODUCTION_ENTRY, env: { ...f.env, ...extraEnv }, ...(cwd !== undefined ? { cwd } : {}) });
}

export function reportOf(r: CliResult): Report {
  assert.ok([0, 3].includes(r.code ?? -1), `doctor ends 0 or 3, got ${String(r.code)}: ${r.stderr}`);
  return JSON.parse(r.stdout) as Report;
}

// Creates the profile's store (a read-only command migrates a missing one) so that doctor has a store to read.
export function initStore(f: DoctorFixture): void {
  const r = runCli(['status'], { roots: f.roots, entry: PRODUCTION_ENTRY, env: f.env });
  assert.equal(r.code, 0, r.stderr);
}

export const statePath = (f: DoctorFixture): string => join(f.roots.AVARICE_DATA_ROOT, 'state.db');

// Registers a directory a test made so that disposeDoctorFixtures removes it.
export function track(dir: string): string {
  cleanup.push(dir);
  return dir;
}
