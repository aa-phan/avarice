// Helpers for the kill-point and lease suites: run the test CLI (production main() with the fake host) to
// completion, kill it at a named point, resume it, and normalize a project record for comparison. Every
// profile lives under a temp dir (makeRoots); nothing here touches the user's profile or a real model.
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { REPO_ROOT, makeRoots } from './run-cli.ts';
import type { CliResult, CliRoots } from './run-cli.ts';
import { runCli } from './run-cli.ts';
import { git } from './scratch-repo.ts';
import type { ScratchRepo } from './scratch-repo.ts';
import type { FakeHostOptions } from './fake-agent-host.ts';
import type { FakeRunOptions } from './fake-run-host.ts';

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
  // The supervisor dies inside the intel (or knowledge) invocation and a process carrying its session ID survives.
  'mid-invocation:intel',
  'after-checkpoint:index:knowledge',
  'mid-invocation:knowledge',
  'after-checkpoint:activate',
] as const;
export type KillPoint = (typeof KILL_POINTS)[number];

// Where the fake host writes the PID of the process it leaves running when it dies inside an invocation.
export function survivorPidFile(roots: CliRoots): string {
  return join(roots.base, 'survivor.pid');
}

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
  // These points are fake-host options, not env faults: the host kills its own process inside the invocation.
  let hostOptions = host;
  let armed = true;
  if (point === 'mid-invocation') {
    hostOptions = { ...host, killAfterFiles: 3 };
    armed = false;
  } else if (point === 'mid-invocation:intel' || point === 'mid-invocation:knowledge') {
    hostOptions = { ...host, killInPurpose: point === 'mid-invocation:intel' ? 'intel' : 'knowledge', survivorPidFile: survivorPidFile(roots) };
    armed = false;
  }
  const result = runCli(onboardArgs(repo), {
    roots,
    entry: TEST_CLI,
    env: hostEnv(hostOptions, armed ? { AVARICE_FAULT: point, ...env } : env),
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
  return new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly, timeout: 5000 });
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

// ---- runs (plan 02-17; FR-7, NFR-6, AC-3) ---------------------------------------------------------------------------------------------------
// A run is started through the test CLI with `--wait`. The supervisor that `start` spawns is the process the fault kills (it inherits
// AVARICE_FAULT), so `start --wait` itself survives, sees the supervisor gone with the lease lapsed and the run unfinished, and exits 3.
// The fake run host plays the unit; the host options travel as JSON in AVARICE_FAKE_HOST under a `run` key (test/helpers/test-cli.ts).

// The lease of a killed supervisor must lapse before resume can take it over. 400 ms is short enough for a suite of 24 points; the fake unit
// blocks its supervisor's event loop for about a second at a time, so the lease can lapse mid-unit, which is harmless (nobody else wants it).
export const RUN_LEASE_TTL_MS = 400;
// Generous: the lease lapses after RUN_LEASE_TTL_MS, and a loaded machine can delay the clock of a child by far more than that.
export const RUN_EXPIRY_WAIT_MS = 1500;
const RUN_CLI_TIMEOUT_MS = 300_000;

// Every point a run can be killed at (docs/contracts-and-state.md "Recovery rules"; SKELETON.md "Kill points"). A checkpoint that two code paths
// commit (the transition that names it, then the stage that takes it before its side effect) fires twice; `#2` arms the second. `mid-*` points
// sit inside an action: `mid-invocation:run` is a fake-host option (the supervisor dies inside the unit, leaving its host process behind), the
// others are env faults. `after-checkpoint:discard-attempt` is reached by a unit that crashes (the CON-16 recovery path).
export const RUN_KILL_POINTS = [
  // contract_ready: RUN_NEXT_ACTIONS.contract_ready
  'after-checkpoint:prepare-workspace',
  'after-checkpoint:configure-gsd',
  'after-checkpoint:install-deps',
  'after-checkpoint:validate-checks',
  'after-checkpoint:baseline',
  'after-checkpoint:verify-enforcement',
  // The run is `running` and its first checkpoint is `context-pack`: the transition commits it, then the stage commits it again.
  'after-transition:running',
  'after-checkpoint:context-pack',
  'after-checkpoint:context-pack#2',
  // running: RUN_NEXT_ACTIONS.running
  'after-checkpoint:launch:run',
  'mid-invocation:run',
  'after-checkpoint:classify',
  'after-checkpoint:discard-attempt',
  // Plan 03-19: gate G1 judges every unit's plan; the repair and gate G3 exist only for an item whose check a unit broke, so these three are reached by the
  // repair scenario (REPAIR_SCENARIO_POINTS), whose reference run is the one of S-52.
  'after-checkpoint:gate:g1',
  'after-checkpoint:gate:g2',
  'after-checkpoint:repair',
  'after-checkpoint:gate:g3',
  'after-checkpoint:commit',
  'mid-commit',
  // verifying: RUN_NEXT_ACTIONS.verifying; the commit's transition commits `verify:checks`, then the stage commits it again.
  'after-transition:verifying',
  'after-checkpoint:verify:checks',
  'after-checkpoint:verify:checks#2',
  'mid-verify',
  'after-checkpoint:gate:g4',
  'after-checkpoint:handoff:fetch',
  // `mid-handoff` is after the fetch and before its record (the resume repeats the idempotent fetch); `#2` is after the record, before the move.
  'mid-handoff',
  'mid-handoff#2',
] as const;
export type RunKillPoint = (typeof RUN_KILL_POINTS)[number];

// The points the kill suite runs against the repair scenario (S-52: item B breaks a test item A added, and one repair fixes it) instead of the single-item
// reference: the repair and gate G3 are reached only there, and gate G1 is killed at the first item's gate, with a second item and a repair still to come.
export const REPAIR_SCENARIO_POINTS: ReadonlySet<RunKillPoint> = new Set<RunKillPoint>(['after-checkpoint:gate:g1', 'after-checkpoint:repair', 'after-checkpoint:gate:g3']);

// The kill points inside an item-local block (plan 03-18), reached only by a run whose item asks (test/fault/run-park.test.ts): right after the `park`
// checkpoint (the delta is still in the tree), between the park step and the decision, and after the supervisor released its lease on a blocked run.
export const PARK_KILL_POINTS = ['after-checkpoint:park', 'mid-park', 'after-release:blocked'] as const;
export type ParkKillPoint = (typeof PARK_KILL_POINTS)[number];

// The kill points inside the resume of an answered item (plan 03-22), reached only by a run whose answered item resumes its own session
// (test/fault/run-resume-session.test.ts): right after the `unpark` checkpoint (the delta may or may not be back in the tree), after the delta was put back and
// before the host is launched (`mid-unpark`), and inside the resumed unit (`mid-invocation:run`, with the host process of the resumed session left behind).
export const RESUME_KILL_POINTS = ['after-checkpoint:unpark', 'mid-unpark', 'mid-invocation:run'] as const;
export type ResumeKillPoint = (typeof RESUME_KILL_POINTS)[number];

export function runHostEnv(host: FakeRunOptions, extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { AVARICE_FAKE_HOST: JSON.stringify({ run: host }), AVARICE_LEASE_TTL_MS: String(RUN_LEASE_TTL_MS), ...extra };
}

export function startRunArgs(briefPath: string): string[] {
  return ['start', '--brief', briefPath, '--policy', 'routine', '--wait'];
}

export const runIdFromOutput = (stdout: string): string => {
  const match = /^run (run_[0-9A-Z]{26}): /m.exec(stdout);
  if (match === null) throw new Error(`no run ID in the output:\n${stdout}`);
  return match[1] as string;
};

export interface KilledRun {
  runId: string;
  // The `start --wait` process: it survives the kill of its supervisor.
  start: CliResult;
}

// Where the fake run host writes the PID of the process it leaves running when its supervisor dies inside the unit.
export function runSurvivorPidFile(roots: CliRoots): string {
  return join(roots.base, 'run-survivor.pid');
}

// Starts a run with the point armed and asserts that its supervisor was killed there: `start --wait` finds the run unfinished with nobody
// holding the lease and exits 3 with `interrupted in <state>`. A point that is never reached lets the run finish, which fails here (a missed
// kill point would otherwise pass for a resume that had nothing to do). `host` is what the fake unit does before the kill.
export function runRunWithFault(
  roots: CliRoots,
  repo: ScratchRepo,
  briefPath: string,
  point: RunKillPoint | ParkKillPoint | undefined,
  host: FakeRunOptions = {},
  env: Record<string, string | undefined> = {},
  extraArgs: readonly string[] = [],
): KilledRun {
  let hostOptions = host;
  let armed = true;
  if (point === 'mid-invocation:run') {
    // The supervisor dies inside the unit after it wrote one file; its host process (carrying the session ID) is left running.
    hostOptions = { ...host, killInUnit: { afterFiles: ['src/slug.ts'], survivorPidFile: runSurvivorPidFile(roots) } };
    armed = false;
  }
  const start = runCli([...startRunArgs(briefPath), ...extraArgs], {
    roots,
    cwd: repo.path,
    entry: TEST_CLI,
    env: runHostEnv(hostOptions, armed && point !== undefined ? { AVARICE_FAULT: point, ...env } : env),
    timeoutMs: RUN_CLI_TIMEOUT_MS,
  });
  const runId = runIdFromOutput(start.stdout);
  if (start.code !== 3 || !/interrupted in /.test(start.stdout)) {
    throw new Error(`kill point ${String(point)}: expected the supervisor to be killed and \`start --wait\` to exit 3 with an interrupted run, got code ${String(start.code)} signal ${String(start.signal)}\n${start.stdout}${start.stderr}`);
  }
  return { runId, start };
}

// `resume <run_id> --wait` through the test CLI with the host options of the resumed supervisor (a fresh process: its host plays `host` from
// its first invocation, so the options are those of the attempt the resume starts, not the killed one's).
export function resumeRunCli(roots: CliRoots, runId: string, host: FakeRunOptions = {}, env: Record<string, string | undefined> = {}, extraArgs: readonly string[] = ['--wait']): CliResult {
  return runCli(['resume', runId, ...extraArgs], { roots, entry: TEST_CLI, env: runHostEnv(host, env), timeoutMs: RUN_CLI_TIMEOUT_MS });
}

export interface RunStatusJson {
  runId: string;
  state: string;
  reason: string | null;
  lastCheckpoint: { nextAction: string } | null;
  commit: string | null;
  evidence: Array<{ name: string; kind: string; status: string; revision: string }>;
  gates: Array<{ gate: string; passed: boolean }>;
  budgets: Array<{ name: string; used: number; limit: number }>;
  interrupted?: { state: string; presentedAs: string; reason: string; attemptId: string | null; step: string; nextAction: string; resumeCommand: string };
}

// The run as `status --json` shows it.
export function runStatusJson(roots: CliRoots, runId: string): RunStatusJson {
  const out = statusCli(roots, '--json');
  if (out.code !== 0) throw new Error(`status --json failed: ${out.stderr}`);
  for (const project of JSON.parse(out.stdout) as Array<{ runs?: RunStatusJson[] }>) {
    const found = project.runs?.find((r) => r.runId === runId);
    if (found !== undefined) return found;
  }
  throw new Error(`status --json does not list ${runId}`);
}

// What the ledger says was in flight, read straight from the tables and not through `status`: the attempt that has no end and the action
// of the last checkpoint that names one, with the step that was `started` after that checkpoint (an invocation in flight), if any.
export interface LedgerInterruption {
  openAttemptId: string | null;
  nextAction: string | null;
  startedStep: string | null;
}

export function ledgerInterruption(roots: CliRoots, runId: string): LedgerInterruption {
  const open = rows<{ attempt_id: string }>(roots, 'SELECT attempt_id FROM attempts WHERE run_id = ? AND ended_at IS NULL ORDER BY ordinal DESC', runId)[0];
  const checkpoints = rows<{ next_action: string; created_at: string }>(roots, "SELECT next_action, created_at FROM checkpoints WHERE run_id = ? AND next_action != 'none' ORDER BY seq DESC", runId);
  const last = checkpoints[0];
  const started = rows<{ step: string; started_at: string }>(roots, "SELECT step, started_at FROM run_steps WHERE run_id = ? AND status = 'started' ORDER BY rowid DESC", runId)[0];
  const startedAfter = started !== undefined && (last === undefined || started.started_at >= last.created_at) ? started.step : null;
  return { openAttemptId: open?.attempt_id ?? null, nextAction: last?.next_action ?? null, startedStep: startedAfter };
}

export interface RunResult {
  state: string;
  // The tree of the commit the run handed over, and what that commit changed against the pin.
  tree: string;
  changedFiles: string[];
  commitCount: number;
  subject: string;
  // The latest evidence of each kind and name of the final pass, as [kind, name, status].
  evidence: Array<[string, string, string]>;
  // The latest verdict of each gate, as [gate, passed].
  gates: Array<[string, boolean]>;
}

// The parts of a finished run that two runs of the same brief must share whether or not one of them was killed and resumed: the committed
// tree and file list, the evidence statuses and the gate verdicts. IDs, times, attempt trailers and paths differ by design and are left out.
export function normalizeRunResult(roots: CliRoots, runId: string): RunResult {
  const run = rows<{ state: string; workspace_path: string; base_revision: string }>(roots, 'SELECT state, workspace_path, base_revision FROM runs WHERE run_id = ?', runId)[0];
  if (run === undefined) throw new Error(`no run ${runId}`);
  const clone = run.workspace_path;
  const evidenceRows = rows<{ kind: string; name: string; status: string; environment_json: string }>(
    roots,
    'SELECT e.kind, e.name, e.status, e.environment_json FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ? ORDER BY e.rowid',
    runId,
  );
  const latest = new Map<string, [string, string, string]>();
  for (const row of evidenceRows) {
    const label = (JSON.parse(row.environment_json) as { label?: string }).label;
    // `base` and `g2` rows belong to earlier passes; the final pass (and the model-review and diff rows, which carry no label) is what is compared.
    if (label !== undefined && label !== 'final') continue;
    latest.set(`${row.kind}:${row.name}`, [row.kind, row.name, row.status]);
  }
  const gates = new Map<string, [string, boolean]>();
  for (const row of rows<{ gate: string; passed: number }>(roots, 'SELECT gate, passed FROM gate_results WHERE run_id = ? ORDER BY rowid', runId)) gates.set(row.gate, [row.gate, row.passed === 1]);
  return {
    state: run.state,
    tree: git(clone, ['rev-parse', 'HEAD^{tree}']).trim(),
    changedFiles: git(clone, ['diff', '--name-only', run.base_revision, 'HEAD']).trim().split('\n').filter((line) => line !== ''),
    commitCount: Number(git(clone, ['rev-list', '--count', `${run.base_revision}..HEAD`]).trim()),
    subject: git(clone, ['log', '-1', '--format=%s']).trim(),
    evidence: [...latest.values()].sort((a, b) => (a.join('|') < b.join('|') ? -1 : 1)),
    gates: [...gates.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  };
}
