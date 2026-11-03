// Helpers for the kill-point and lease suites: run the test CLI (production main() with the fake host) to
// completion, kill it at a named point, resume it, and normalize a project record for comparison. Every
// profile lives under a temp dir (makeRoots); nothing here touches the user's profile or a real model.
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { REPO_ROOT, makeRoots } from './run-cli.ts';
import type { CliResult, CliRoots } from './run-cli.ts';
import { runCli } from './run-cli.ts';
import type { ScratchRepo } from './scratch-repo.ts';
import type { FakeHostOptions } from './fake-agent-host.ts';

export const TEST_CLI = join(REPO_ROOT, 'test', 'helpers', 'test-cli.ts');
export const SHORT_TTL_MS = 200;
// Long enough for a 200 ms lease to expire, with margin for a slow machine.
export const EXPIRY_WAIT_MS = 400;

export const REPO_FILES: Readonly<Record<string, string>> = {
  'README.md': '# scratch\n',
  'package.json': '{"name":"scratch"}\n',
  'src/index.ts': 'export const answer = 42;\n',
  'src/util/strings.ts': 'export const upper = (s: string): string => s.toUpperCase();\n',
  'docs/guide.md': '# guide\n',
};

// The kill-point catalog (SKELETON.md "Kill points"). `mid-invocation` is a fake-host option, not an env fault.
export const KILL_POINTS = [
  'after-transition:discovered',
  'after-transition:contract_proposed',
  'after-checkpoint:prepare-workspace',
  'after-checkpoint:configure-gsd',
  'after-checkpoint:verify-enforcement',
  'after-transition:mapping',
  'mid-invocation',
  'after-transition:validating',
  'after-checkpoint:validate',
  'after-transition:planning_ready',
  'after-checkpoint:index:code-graph',
  // The same checkpoint fires twice: once with the planning_ready transition that names it, once when the index
  // stage commits it before the step's side effect. `#2` arms the second, which is the gap between the two.
  'after-checkpoint:index:code-graph#2',
  'after-checkpoint:index:intel',
  'after-checkpoint:index:knowledge',
  'after-checkpoint:activate',
] as const;
export type KillPoint = (typeof KILL_POINTS)[number];

export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function hostEnv(host: FakeHostOptions, extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { AVARICE_FAKE_HOST: JSON.stringify(host), AVARICE_LEASE_TTL_MS: String(SHORT_TTL_MS), ...extra };
}

export function onboardArgs(repo: ScratchRepo): string[] {
  return ['onboard', '--policy', 'onboarding', repo.path];
}

// Onboards without any fault and returns the CLI result (callers assert on it).
export function runToCompletion(roots: CliRoots, repo: ScratchRepo, host: FakeHostOptions = {}): CliResult {
  return runCli(onboardArgs(repo), { roots, entry: TEST_CLI, env: hostEnv(host) });
}

// Onboards with the kill point armed and asserts the child ended by SIGKILL.
export function runWithFault(roots: CliRoots, repo: ScratchRepo, point: KillPoint, host: FakeHostOptions = {}, env: Record<string, string | undefined> = {}): CliResult {
  const midInvocation = point === 'mid-invocation';
  const result = runCli(onboardArgs(repo), {
    roots,
    entry: TEST_CLI,
    env: hostEnv(midInvocation ? { ...host, killAfterFiles: 3 } : host, midInvocation ? env : { AVARICE_FAULT: point, ...env }),
  });
  if (result.signal !== 'SIGKILL') {
    throw new Error(`kill point ${point}: expected the child to die by SIGKILL, got signal ${String(result.signal)} code ${String(result.code)}\n${result.stdout}${result.stderr}`);
  }
  return result;
}

export function resumeCli(roots: CliRoots, onboardingId: string, host: FakeHostOptions = {}, env: Record<string, string | undefined> = {}): CliResult {
  return runCli(['resume', onboardingId], { roots, entry: TEST_CLI, env: hostEnv(host, env) });
}

export function statusCli(roots: CliRoots, ...extra: string[]): CliResult {
  return runCli(['status', ...extra], { roots, entry: TEST_CLI, env: hostEnv({}) });
}

// Asynchronous variant, so two children can run at once.
export function spawnCli(argv: readonly string[], roots: CliRoots, host: FakeHostOptions = {}, env: Record<string, string | undefined> = {}): Promise<CliResult> {
  const childEnv: Record<string, string | undefined> = {
    ...process.env,
    AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME,
    AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT,
    AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT,
    ...hostEnv(host, env),
  };
  delete childEnv['NODE_TEST_CONTEXT'];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', TEST_CLI, ...argv], { env: childEnv as NodeJS.ProcessEnv });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, stdout, stderr, signal }));
  });
}

export function freshProfile(): CliRoots {
  return makeRoots();
}

export function openRaw(roots: CliRoots, readOnly = true): DatabaseSync {
  return new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly });
}

export function rows<T>(roots: CliRoots, sql: string, ...params: Array<string | number>): T[] {
  const db = openRaw(roots);
  try {
    return (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    db.close();
  }
}

export function onboardingIdOf(roots: CliRoots): string {
  const [row] = rows<{ onboarding_id: string }>(roots, 'SELECT onboarding_id FROM onboardings');
  if (!row) throw new Error('no onboarding was registered');
  return row.onboarding_id;
}

export interface TransitionEvent {
  from: string;
  to: string;
}

// Every committed lifecycle transition, oldest first.
export function transitionsOf(roots: CliRoots): TransitionEvent[] {
  return rows<{ data_json: string }>(roots, "SELECT data_json FROM events WHERE type = 'onboarding.transition' ORDER BY seq").map((r) => {
    const data = JSON.parse(r.data_json) as { from: string; to: string };
    return { from: data.from, to: data.to };
  });
}

const ID_WITH_ULID = /\b(proj_|onb_|run_|inv_|att_|ckp_)[0-9A-HJKMNP-TV-Z]{26}\b/g;
const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
// Anything up to and including the mkdtemp directory of makeRoots(); the platform prefix differs
// (/var/folders/... versus /private/var/folders/...).
const TEMP_ROOT = /[^"\s]*avarice-cli-[A-Za-z0-9]{6}/g;

export function normalizeText(text: string): string {
  return text.replace(ID_WITH_ULID, '$1<ulid>').replace(ISO_TIMESTAMP, '<ts>').replace(TEMP_ROOT, '<tmp>');
}

// Replaces ULIDs, ISO timestamps and absolute temp-dir prefixes with placeholders. The snapshot manifest
// digest is replaced too, because the manifest embeds the onboarding ID; tests compare the manifests
// themselves after normalization. The contract digest is replaced for the same reason: the contract embeds
// the onboarding and run IDs, so two runs of one repository never share it (plan 01-10 records it).
export function normalizeRecord(body: unknown): unknown {
  const parsed = JSON.parse(normalizeText(JSON.stringify(body))) as { artifacts?: { snapshot?: unknown }; contract?: { digest?: unknown } | null };
  if (parsed.artifacts !== undefined && typeof parsed.artifacts.snapshot === 'string') parsed.artifacts.snapshot = '<manifest-digest>';
  if (parsed.contract != null && typeof parsed.contract.digest === 'string') parsed.contract.digest = '<contract-digest>';
  return parsed;
}
