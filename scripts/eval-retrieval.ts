// The lean three-arm evaluation harness of AC-8 (plan 04-31; FR-3, FR-22; D-06, D-07, D-08). It replays the owner-approved historical commits of
// test/benchmark/phase4/eval-tasks.json under three arms and judges every run the same way:
//
//   A  the baseline (D-06): no AVARICE pack (`adapters.context` is the empty list) and the GSD codebase map the agent finds in its own checkout, plus files it finds itself.
//      The map is generated at the task's parent when the parent carries none (one throwaway fast onboarding with `--promote commit`) and committed into the arm's repository
//      before the onboarding that the run uses, because a run clones the onboarded revision only.
//   B  the pack built at the parent from the code-only graph (`adapters.context` gsd-intel and gsd-graph, `adapters.knowledgePass` false).
//   C  the same pack with the knowledge graph (`adapters.knowledgePass` true).
//
// Every arm runs in its own scratch repository at the task's parent: no commit after it, no remote and no other ref. The held-out test and every other path in `deniedReads`
// are removed from that repository (a changed test file is removed too, so its old version is not readable either); the held-out test is copied in from the target commit only
// in a separate judging clone, after the agent stopped. A task succeeds when every required check passes in the judging clone and the held-out test passes there.
//
// Modes (one is required):
//   --dry-run   Plans every run, prints its cap and the projected total against the Phase 4 spend ledger, and exits non-zero when the projection passes the ceiling (D-03).
//               It spends nothing, starts no model and writes nothing but its own output. It reads the source repositories through `git ls-tree` only.
//   --live      Runs the plan: refuses first when the whole plan would pass the ceiling, then checks the ceiling again before each model step and records each step's spend
//               in the Phase 4 ledger under AVARICE_PHASE4_PLAN (default 04-36). Needs --out. Plan 04-36 runs this after the owner authorizes the spend.
//
// Flags: --tasks <n> (the first n approved tasks, default all), --arms A,B,C, --cap-usd <n> (the per-run cost cap, default 0.40), --out <file> (the results JSON),
//        --tasks-file <file>, --repos-file <file>, --source <repository id>=<path> (repeatable; default the source in the repositories file), --node-modules <id>=<dir>
//        (repeatable; the dependency tree the judge copies into its clone; default the source checkout's own when its lockfile equals the parent's), --scratch <dir>, --keep.
//
// The projection is a cap bound, not a forecast: each run is charged its cap, each onboarding its cap, and arm A the cap of a map generation for every parent that carries
// no `.planning/codebase` map. The onboarding caps are assumptions the pilot replaces with measurements.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { SandboxedExecutor } from '../src/adapters/exec/sandboxed-executor.ts';
import { configPathFor } from '../src/adapters/fs/profile-config.ts';
import { matchesAny } from '../src/domain/glob.ts';
import { ROUTINE_PRESET } from '../src/domain/run-contract.ts';
import type { CommandExecutor } from '../src/ports/command-executor.ts';
import { ceilingRefusal, claudeVersion, fitsPhase4Ceiling, liveClaudeBin, phase4Ceiling, phase4Spent, recordPhase4Spend } from '../test/helpers/live-harness.ts';
import { REPO_ROOT, runCli } from '../test/helpers/run-cli.ts';
import type { CliRoots } from '../test/helpers/run-cli.ts';

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Arms, tasks and the plan
// ---------------------------------------------------------------------------------------------------------------------------------------------

export type ArmId = 'A' | 'B' | 'C';
export const ARM_IDS: readonly ArmId[] = ['A', 'B', 'C'];

export class EvalRefusal extends Error {}

export interface ArmProfileConfig {
  adapters: { context: string[]; knowledgePass: boolean };
}

// The profile configuration that makes an arm (the product's own switches only: adapters.context from plan 04-26, adapters.knowledgePass from this plan).
export function armProfileConfig(arm: ArmId): ArmProfileConfig {
  if (arm === 'A') return { adapters: { context: [], knowledgePass: false } };
  return { adapters: { context: ['gsd-intel', 'gsd-graph'], knowledgePass: arm === 'C' } };
}

export interface EvalCheck {
  name: string;
  argv: string[];
}

export interface EvalTask {
  id: string;
  repository: string;
  commit: string;
  parent: string;
  brief: string;
  checks: EvalCheck[];
  heldOutTest: string;
  heldOutCommand: string[];
  allowedReads: string[];
  deniedReads: string[];
  size: 'small' | 'medium';
}

export interface ApprovedTasks {
  tasks: EvalTask[];
  approvedBy: string;
  approvedAt: string;
  digest: string;
  file: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');
const SHA = /^[0-9a-f]{40}$/;
const CHECK_NAME = /^[a-z][a-z0-9:_-]{0,63}$/;

// A repository-relative path that cannot leave the repository or read as a git option.
function safeRelative(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !isAbsolute(value) && !value.startsWith('-') && !value.includes('\0') && !value.split('/').some((segment) => segment === '..' || segment === '');
}

// Reads eval-tasks.json and refuses it unless the owner approved it (`approvedBy` and `approvedAt` both set, D-07) and every task has the shape the harness relies on. The
// digest is of the file's bytes, so a results file names exactly the list it ran.
export function loadApprovedTasks(file: string): ApprovedTasks {
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch {
    throw new EvalRefusal(`cannot read the task list ${file}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new EvalRefusal(`${file} is not valid JSON`);
  }
  if (!isRecord(parsed) || parsed['schema'] !== 1) throw new EvalRefusal(`${file} is not an eval-tasks list of schema 1`);
  const { approvedBy, approvedAt } = parsed;
  if (typeof approvedBy !== 'string' || approvedBy === '' || typeof approvedAt !== 'string' || approvedAt === '') {
    throw new EvalRefusal(`${file} is not approved: approvedBy and approvedAt must both be set by the owner before any spend`);
  }
  const list = parsed['tasks'];
  if (!Array.isArray(list) || list.length === 0) throw new EvalRefusal(`${file} holds no tasks`);
  const seen = new Set<string>();
  const tasks: EvalTask[] = [];
  for (const [index, raw] of list.entries()) {
    const where = `${file} task ${index + 1}`;
    if (!isRecord(raw)) throw new EvalRefusal(`${where} is not an object`);
    const id = raw['id'];
    if (typeof id !== 'string' || id === '' || seen.has(id)) throw new EvalRefusal(`${where} has no unique id`);
    seen.add(id);
    const bad = (field: string): never => {
      throw new EvalRefusal(`${id}: ${field} is missing or malformed`);
    };
    if (typeof raw['repository'] !== 'string' || raw['repository'] === '') bad('repository');
    if (typeof raw['commit'] !== 'string' || !SHA.test(raw['commit'])) bad('commit');
    if (typeof raw['parent'] !== 'string' || !SHA.test(raw['parent'])) bad('parent');
    if (typeof raw['brief'] !== 'string' || raw['brief'].trim() === '') bad('brief');
    const checks = raw['checks'];
    if (!Array.isArray(checks) || checks.length === 0) bad('checks');
    for (const check of checks as unknown[]) {
      if (!isRecord(check) || typeof check['name'] !== 'string' || !CHECK_NAME.test(check['name']) || !isStringList(check['argv']) || check['argv'].length === 0) bad('checks');
    }
    if (!safeRelative(raw['heldOutTest'])) bad('heldOutTest');
    if (!isStringList(raw['heldOutCommand']) || raw['heldOutCommand'].length === 0) bad('heldOutCommand');
    if (!isStringList(raw['allowedReads'])) bad('allowedReads');
    if (!isStringList(raw['deniedReads']) || !raw['deniedReads'].every(safeRelative)) bad('deniedReads');
    if (raw['size'] !== 'small' && raw['size'] !== 'medium') bad('size');
    // The held-out test is always denied, whatever the list says: deniedReads takes precedence over allowedReads.
    const denied = [...new Set([...(raw['deniedReads'] as string[]), raw['heldOutTest'] as string])];
    tasks.push({
      id,
      repository: raw['repository'] as string,
      commit: raw['commit'] as string,
      parent: raw['parent'] as string,
      brief: raw['brief'] as string,
      checks: (checks as Array<Record<string, unknown>>).map((c) => ({ name: c['name'] as string, argv: c['argv'] as string[] })),
      heldOutTest: raw['heldOutTest'] as string,
      heldOutCommand: raw['heldOutCommand'] as string[],
      allowedReads: raw['allowedReads'] as string[],
      deniedReads: denied,
      size: raw['size'] as 'small' | 'medium',
    });
  }
  return { tasks, approvedBy, approvedAt, digest: createHash('sha256').update(bytes).digest('hex'), file };
}

// What a fast onboarding is allowed to cost (the cap of `--budget costUsdPerRun`), per arm, and what a map generation for arm A is. Assumptions from the Phase 3 fast onboarding
// (0.6 USD, plans 03-xx); arm C's is larger by its knowledge invocation. The pilot (plan 04-36) measures the real figures.
export const ONBOARD_CAP_USD: Readonly<Record<ArmId, number>> = { A: 0.6, B: 0.6, C: 0.9 };
export const MAP_CAP_USD = 0.6;
export const DEFAULT_RUN_CAP_USD = 0.4;

export interface PlannedRun {
  n: number;
  task: EvalTask;
  arm: ArmId;
  runCapUsd: number;
  onboardCapUsd: number;
  // Arm A only: the cap of generating the GSD codebase map at a parent that carries none; 0 when the parent has one or for another arm.
  mapCapUsd: number;
}

export interface PlanOptions {
  capUsd: number;
  mapPresent: (task: EvalTask) => boolean;
}

export function planRuns(tasks: readonly EvalTask[], arms: readonly ArmId[], options: PlanOptions): PlannedRun[] {
  const plan: PlannedRun[] = [];
  for (const task of tasks) {
    const mapPresent = options.mapPresent(task);
    for (const arm of arms) {
      plan.push({ n: plan.length + 1, task, arm, runCapUsd: options.capUsd, onboardCapUsd: ONBOARD_CAP_USD[arm], mapCapUsd: arm === 'A' && !mapPresent ? MAP_CAP_USD : 0 });
    }
  }
  return plan;
}

export interface Projection {
  runs: number;
  runUsd: number;
  onboardUsd: number;
  mapUsd: number;
  mapParents: number;
  totalUsd: number;
}

export function projection(plan: readonly PlannedRun[]): Projection {
  const sum = (pick: (r: PlannedRun) => number): number => plan.reduce((total, r) => total + pick(r), 0);
  const runUsd = sum((r) => r.runCapUsd);
  const onboardUsd = sum((r) => r.onboardCapUsd);
  const mapUsd = sum((r) => r.mapCapUsd);
  return { runs: plan.length, runUsd, onboardUsd, mapUsd, mapParents: plan.filter((r) => r.mapCapUsd > 0).length, totalUsd: runUsd + onboardUsd + mapUsd };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Verdict arithmetic (AC-8, D-08): pure, so nobody computes it by hand (T-04-87)
// ---------------------------------------------------------------------------------------------------------------------------------------------

export interface ArmTotals {
  success: number;
  tokens: number;
  // The number of tasks the arm ran. When every compared arm states it, success rates are compared; otherwise the success counts.
  tasks?: number;
}

export interface Ac8Verdict {
  pass: boolean;
  via: 'B' | 'C' | null;
  reason: string;
  arms: Partial<Record<'B' | 'C', { successOk: boolean; tokensOk: boolean; tokenShare: number }>>;
}

function rateOf(arm: ArmTotals, byRate: boolean): number {
  return byRate && arm.tasks !== undefined && arm.tasks > 0 ? arm.success / arm.tasks : arm.success;
}

const usesRates = (...arms: ArmTotals[]): boolean => arms.every((a) => a.tasks !== undefined && a.tasks > 0);

// AC-8: arm B or arm C has a success rate at least arm A's at no more than half of arm A's tokens. Exactly half passes; one token over fails.
export function verdict(arms: { A?: ArmTotals; B?: ArmTotals; C?: ArmTotals }): Ac8Verdict {
  const a = arms.A;
  if (a === undefined) return { pass: false, via: null, reason: 'arm A has no totals, so there is nothing to compare against', arms: {} };
  if (a.tokens <= 0) return { pass: false, via: null, reason: 'arm A measured no tokens, so no token share can be computed', arms: {} };
  const detail: Ac8Verdict['arms'] = {};
  let via: 'B' | 'C' | null = null;
  for (const name of ['B', 'C'] as const) {
    const arm = arms[name];
    if (arm === undefined) continue;
    const byRate = usesRates(a, arm);
    const successOk = rateOf(arm, byRate) + 1e-12 >= rateOf(a, byRate);
    const tokensOk = arm.tokens * 2 <= a.tokens;
    detail[name] = { successOk, tokensOk, tokenShare: arm.tokens / a.tokens };
    if (via === null && successOk && tokensOk) via = name;
  }
  if (via !== null) return { pass: true, via, reason: `arm ${via} succeeds at least as often as A at ${(100 * (detail[via]?.tokenShare ?? 0)).toFixed(1)}% of A's tokens`, arms: detail };
  if (detail.B === undefined && detail.C === undefined) return { pass: false, via: null, reason: 'neither arm B nor arm C has totals', arms: detail };
  return { pass: false, via: null, reason: 'no pack arm both matches the success of A and stays within half of its tokens', arms: detail };
}

export interface KnowledgeOutcome {
  outcome: 'on' | 'off';
  reason: string;
}

// D-08: the knowledge pass stays on unless arm C shows no success gain over arm B and also costs more tokens than arm B.
export function knowledgeRule(b: ArmTotals, c: ArmTotals): KnowledgeOutcome {
  const byRate = usesRates(b, c);
  const gain = rateOf(c, byRate) > rateOf(b, byRate) + 1e-12;
  const costsMore = c.tokens > b.tokens;
  if (!gain && costsMore) return { outcome: 'off', reason: `arm C has no success gain over B and costs more tokens (${c.tokens} against ${b.tokens})` };
  return { outcome: 'on', reason: gain ? 'arm C succeeds more often than B' : 'arm C does not cost more tokens than B' };
}

export interface RunSummaryInput {
  arm: ArmId;
  success: boolean;
  tokens: number;
  costUsd: number;
  judgeError?: string;
}

export interface ArmSummary {
  runs: number;
  success: number;
  tokens: number;
  costUsd: number;
  judgeErrors: number;
}

export interface EvaluationSummary {
  arms: Partial<Record<ArmId, ArmSummary>>;
  ac8: Ac8Verdict;
  knowledge: KnowledgeOutcome;
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

export function summarize(results: readonly RunSummaryInput[]): EvaluationSummary {
  const arms: Partial<Record<ArmId, ArmSummary>> = {};
  for (const arm of ARM_IDS) {
    const own = results.filter((r) => r.arm === arm);
    if (own.length === 0) continue;
    arms[arm] = {
      runs: own.length,
      success: own.filter((r) => r.success).length,
      tokens: own.reduce((sum, r) => sum + r.tokens, 0),
      costUsd: round6(own.reduce((sum, r) => sum + r.costUsd, 0)),
      judgeErrors: own.filter((r) => r.judgeError !== undefined).length,
    };
  }
  const totals = (arm: ArmId): ArmTotals | undefined => {
    const s = arms[arm];
    return s === undefined ? undefined : { success: s.success, tokens: s.tokens, tasks: s.runs };
  };
  const a = totals('A');
  const b = totals('B');
  const c = totals('C');
  const ac8 = verdict({ ...(a !== undefined ? { A: a } : {}), ...(b !== undefined ? { B: b } : {}), ...(c !== undefined ? { C: c } : {}) });
  const knowledge: KnowledgeOutcome = b !== undefined && c !== undefined ? knowledgeRule(b, c) : { outcome: 'on', reason: 'arms B and C were not both run, so the pass stays on' };
  return { arms, ac8, knowledge };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The arm workspace and the judging clone (T-04-85)
// ---------------------------------------------------------------------------------------------------------------------------------------------

const GIT_ENV: NodeJS.ProcessEnv = {
  PATH: process.env['PATH'] ?? '/usr/bin:/bin',
  HOME: tmpdir(),
  LANG: 'C',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
};

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, env: GIT_ENV, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function gitStatus(cwd: string, args: readonly string[]): number | null {
  return spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, env: GIT_ENV, encoding: 'utf8' }).status;
}

const SETUP_IDENTITY = ['-c', 'user.name=AVARICE evaluation', '-c', 'user.email=eval@localhost.invalid', '-c', 'commit.gpgsign=false'];

// The conventions file a run needs (`.avarice/config.json`): the task's checks as required checks, a write set of every top-level directory and every top-level file that
// is not protected, and the dependency install when the parent has an npm lockfile. Derived, not copied from the owner's repository.
export function conventionsFor(task: EvalTask, topLevelDirs: readonly string[], topLevelFiles: readonly string[], hasNpmLock: boolean): Record<string, unknown> {
  const write = [...topLevelDirs.filter((d) => !d.startsWith('.') && d !== 'node_modules').map((d) => `${d}/**`), ...topLevelFiles.filter((f) => !f.startsWith('.') && !matchesAny(f, ROUTINE_PRESET.protected))];
  return {
    schema: 1,
    checks: task.checks.map((c) => ({ name: c.name, argv: c.argv, timeoutSec: 900, required: true })),
    paths: { write: write.length > 0 ? write : ['**'], protected: [], artifacts: [] },
    ...(hasNpmLock ? { dependencies: { install: ['npm', 'ci'], lockfile: 'package-lock.json', registryHosts: ['registry.npmjs.org'] } } : {}),
  };
}

const PLANNING_STUBS: Readonly<Record<string, string>> = {
  '.planning/PROJECT.md': '# Project\n\nA repository replayed by the AVARICE retrieval evaluation.\n',
  '.planning/ROADMAP.md': '# Roadmap\n\n## Phase 1: Maintenance\n\nGoal: small fixes to the existing code.\n',
  '.planning/STATE.md': '# State\n\nPhase 1 in progress.\n',
};

export interface ArmWorkspace {
  path: string;
  head: string;
}

// The repository an arm starts from: a clone of `source` reduced to the task's parent (no later commit, no remote, one branch), the paths in `deniedReads` removed (the held-out
// test among them) and one setup commit that adds the conventions and, where the parent has none, a minimal GSD planning directory. `source` is only read.
export function prepareArmWorkspace(options: { source: string; task: EvalTask; dest: string }): ArmWorkspace {
  const { source, task, dest } = options;
  mkdirSync(dirname(dest), { recursive: true });
  execFileSync('git', ['clone', '--no-local', '--no-checkout', '-q', source, dest], { env: GIT_ENV, stdio: 'pipe' });
  git(dest, ['checkout', '-q', '-B', 'eval', task.parent]);
  // Nothing but the branch at the parent: no remote, no other branch, no tag.
  spawnSync('git', ['remote', 'remove', 'origin'], { cwd: dest, env: GIT_ENV });
  for (const ref of git(dest, ['for-each-ref', '--format=%(refname)']).split('\n').filter((r) => r !== '' && r !== 'refs/heads/eval')) git(dest, ['update-ref', '-d', ref]);
  for (const denied of task.deniedReads) git(dest, ['rm', '-q', '-r', '-f', '--ignore-unmatch', '--', `:(literal)${denied}`]);
  const dirs = git(dest, ['ls-tree', '-d', '--name-only', 'HEAD']).split('\n').filter((l) => l !== '');
  const files = git(dest, ['ls-tree', '--name-only', 'HEAD']).split('\n').filter((l) => l !== '' && !dirs.includes(l));
  const conventions = conventionsFor(task, dirs, files, files.includes('package-lock.json'));
  const setup: Record<string, string> = { '.avarice/config.json': `${JSON.stringify(conventions, null, 2)}\n` };
  for (const [path, text] of Object.entries(PLANNING_STUBS)) if (!existsSync(join(dest, path))) setup[path] = text;
  for (const [path, text] of Object.entries(setup)) {
    mkdirSync(dirname(join(dest, path)), { recursive: true });
    writeFileSync(join(dest, path), text);
  }
  git(dest, ['add', '-f', '--', ...Object.keys(setup)]);
  git(dest, [...SETUP_IDENTITY, 'commit', '-q', '--no-verify', '--allow-empty', '-m', `chore(eval): setup for ${task.id}`]);
  // The clone carried the whole history of the source; only what the parent reaches stays.
  git(dest, ['reflog', 'expire', '--expire=now', '--all']);
  git(dest, ['gc', '-q', '--prune=now']);
  assertNoLeak(dest, task);
  return { path: dest, head: git(dest, ['rev-parse', 'HEAD']).trim() };
}

// Stops the evaluation when an arm could read the answer: the held-out test or a denied read in the working tree, the target commit in the object store, a remote, or a ref
// beyond the branch. Run before every arm starts.
export function assertNoLeak(repo: string, task: EvalTask): void {
  for (const denied of task.deniedReads) {
    if (existsSync(join(repo, denied))) throw new EvalRefusal(`${task.id}: ${denied === task.heldOutTest ? 'the held-out test' : 'a denied read'} ${denied} is in the arm workspace`);
  }
  if (existsSync(join(repo, task.heldOutTest))) throw new EvalRefusal(`${task.id}: the held-out test ${task.heldOutTest} is in the arm workspace`);
  if (gitStatus(repo, ['cat-file', '-e', `${task.commit}^{commit}`]) === 0) throw new EvalRefusal(`${task.id}: the target commit ${task.commit} is in the arm repository`);
  if (git(repo, ['remote']).trim() !== '') throw new EvalRefusal(`${task.id}: the arm repository has a remote`);
  const refs = git(repo, ['for-each-ref', '--format=%(refname)']).split('\n').filter((r) => r !== '');
  if (refs.length !== 1 || refs[0] !== 'refs/heads/eval') throw new EvalRefusal(`${task.id}: the arm repository holds refs beyond its branch (${refs.join(', ')})`);
}

// The clone a run is judged in: the run's result (`ref` of `workspace`) with the held-out test copied in from the target commit of `source`. The arm workspace never gets the file.
export function prepareJudgeClone(options: { workspace: string; ref: string; source: string; task: EvalTask; dest: string }): string {
  const { workspace, ref, source, task, dest } = options;
  const sha = git(workspace, ['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  mkdirSync(dirname(dest), { recursive: true });
  execFileSync('git', ['clone', '--no-local', '--no-checkout', '-q', workspace, dest], { env: GIT_ENV, stdio: 'pipe' });
  git(dest, ['checkout', '-q', '--detach', sha]);
  const bytes = execFileSync('git', ['-C', source, 'show', `${task.commit}:${task.heldOutTest}`], { env: GIT_ENV, maxBuffer: 64 * 1024 * 1024 });
  const target = join(dest, task.heldOutTest);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  return dest;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The brief of a run
// ---------------------------------------------------------------------------------------------------------------------------------------------

// The task's commit message as a brief: the subject is the title, the whole message is the Behavior section (a line that would open a section is escaped, and control
// characters are dropped), and one acceptance criterion names every required check as its proof.
export function briefFor(task: EvalTask): string {
  const clean = task.brief.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
  const lines = clean.split('\n');
  const title = (lines[0] ?? '').trim().slice(0, 200).replace(/^["']|["']$/g, '') || task.id;
  const behavior = lines.map((line) => (/^\s{0,3}#{1,6}(\s|$)/.test(line) ? line.replace('#', '\\#') : line)).join('\n').trim();
  return [
    '---',
    `title: ${title.replace(/^\s+|\s+$/g, '')}`,
    `size: ${task.size}`,
    '---',
    '## Behavior',
    behavior,
    '',
    '## Acceptance criteria',
    `- AC1: The change described above is made and the required checks pass | verifiedBy: ${task.checks.map((c) => `check:${c.name}`).join(', ')}`,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Judging
// ---------------------------------------------------------------------------------------------------------------------------------------------

export interface JudgeResult {
  success: boolean;
  checks: Array<{ name: string; status: string; exitCode: number | null }>;
  heldOut?: { status: string; exitCode: number | null };
  // Set when the judging could not be done (no dependencies, no sandbox): the task is then neither a pass nor a failure of the arm.
  error?: string;
}

const JUDGE_TIMEOUT_MS = 15 * 60_000;

// Runs the task's required checks and then its held-out test in `cwd` (a judging clone) through the sandboxed executor, which can write only below `cwd`. Output is not kept: the
// repositories are private, so the result holds statuses and exit codes only. Dependencies: a clone with a package.json gets `nodeModules` copied in (symbolic links kept as
// links); without a tree to copy the judging stops with `dependencies-missing` rather than count the task as failed.
export async function judgeClone(options: { cwd: string; task: EvalTask; executor: CommandExecutor; nodeModules: string | undefined; skipDependencies?: boolean }): Promise<JudgeResult> {
  const { cwd, task, executor } = options;
  if (options.skipDependencies !== true && existsSync(join(cwd, 'package.json'))) {
    if (options.nodeModules === undefined) return { success: false, checks: [], error: 'dependencies-missing: pass --node-modules <repository id>=<dir> so the judge has the repository dependencies' };
    cpSync(options.nodeModules, join(cwd, 'node_modules'), { recursive: true, verbatimSymlinks: true });
  }
  const home = join(cwd, '.eval-home');
  const tmp = join(cwd, '.eval-tmp');
  mkdirSync(home, { recursive: true });
  mkdirSync(tmp, { recursive: true });
  const env = { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: home, TMPDIR: tmp, CI: '1', LANG: 'C' };
  const run = async (argv: readonly string[], label: string): Promise<{ status: string; exitCode: number | null } | { error: string }> => {
    const result = await executor.run({ argv, cwd, env, timeoutMs: JUDGE_TIMEOUT_MS, invocationId: `judge-${task.id}-${label}`, writePaths: [cwd], denyReadPaths: [] });
    if (!result.ok) return { error: `${label}: ${result.error.kind}` };
    return { status: result.value.status, exitCode: result.value.exitCode };
  };
  const checks: JudgeResult['checks'] = [];
  for (const check of task.checks) {
    const ran = await run(check.argv, check.name);
    if ('error' in ran) return { success: false, checks, error: `judge-unavailable: ${ran.error}` };
    checks.push({ name: check.name, ...ran });
  }
  const held = await run(task.heldOutCommand, 'held-out');
  if ('error' in held) return { success: false, checks, error: `judge-unavailable: ${held.error}` };
  return { success: checks.every((c) => c.status === 'passed') && held.status === 'passed', checks, heldOut: held };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The live driver (plan 04-36 runs it; nothing in plan 04-31 does)
// ---------------------------------------------------------------------------------------------------------------------------------------------

export interface RunResult {
  task: string;
  arm: ArmId;
  success: boolean;
  tokens: number;
  costUsd: number;
  runId: string;
  state: string;
  tokensComplete: boolean;
  setup: { costUsd: number; tokens: number; mapCostUsd: number };
  judge?: JudgeResult;
  judgeError?: string;
  note?: string;
}

class CeilingStop extends Error {}

interface LiveContext {
  scratch: string;
  claudeBin: string;
  claudeVersion: string;
  plan: string;
  sources: Map<string, string>;
  nodeModules: Map<string, string>;
  keep: boolean;
  executor: CommandExecutor;
  log: (line: string) => void;
}

interface LedgerCosts {
  chargedUsd: number;
  tokens: number;
  finished: number;
  tokensComplete: boolean;
}

// The cost and tokens of the invocations a ledger recorded: the onboarding's (events that name an onboarding) or the run's (those that do not).
function costsOf(dataRoot: string, onboarding: boolean): LedgerCosts {
  const total: LedgerCosts = { chargedUsd: 0, tokens: 0, finished: 0, tokensComplete: true };
  const file = join(dataRoot, 'state.db');
  if (!existsSync(file)) return total;
  const db = new DatabaseSync(file, { readOnly: true, timeout: 5000 });
  try {
    for (const row of db.prepare("SELECT data_json FROM events WHERE type = 'invocation.finished' ORDER BY seq").all() as Array<{ data_json: string }>) {
      const data = JSON.parse(row.data_json) as Record<string, unknown>;
      if ((data['onboardingId'] !== undefined) !== onboarding) continue;
      total.finished += 1;
      const charged = typeof data['costChargedUsd'] === 'number' ? data['costChargedUsd'] : typeof data['costUsd'] === 'number' ? data['costUsd'] : 0;
      total.chargedUsd += charged;
      if (typeof data['tokens'] === 'number') total.tokens += data['tokens'];
      else total.tokensComplete = false;
    }
  } finally {
    db.close();
  }
  return total;
}

function rootsIn(base: string): CliRoots {
  return { base, AVARICE_CONFIG_HOME: join(base, 'config'), AVARICE_DATA_ROOT: join(base, 'data'), AVARICE_WORK_ROOT: join(base, 'work') };
}

function cli(ctx: LiveContext, roots: CliRoots, args: readonly string[], cwd: string, timeoutMs: number): ReturnType<typeof runCli> {
  return runCli(args, { roots, cwd, env: { AVARICE_CLAUDE_BIN: ctx.claudeBin }, timeoutMs });
}

// Writes the arm's profile configuration over the config `avarice init` created.
function writeArmProfile(ctx: LiveContext, roots: CliRoots, arm: ArmId): void {
  const init = cli(ctx, roots, ['init'], REPO_ROOT, 60_000);
  if (init.code !== 0) throw new Error(`avarice init failed: ${init.stderr || init.stdout}`);
  const path = configPathFor(roots.AVARICE_CONFIG_HOME, 'personal-local');
  const existing: unknown = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path, `${JSON.stringify({ ...(isRecord(existing) ? existing : {}), ...armProfileConfig(arm) }, null, 2)}\n`, { mode: 0o600 });
}

// One model-spending step: the ceiling is checked against the step's cap first, and the cost the ledger shows afterwards (what the budgets charged: a killed invocation is
// charged its reservation) is recorded in the Phase 4 spend ledger. A step the CLI never finished (the process was killed by the timeout, so the host may have run and left
// no record) is recorded at its cap, the way the Phase 3 tools did for a cost the host did not report.
async function spendStep<T extends { code: number | null }>(ctx: LiveContext, label: string, capUsd: number, roots: CliRoots, onboarding: boolean, fn: () => T): Promise<{ result: T; costs: LedgerCosts }> {
  if (!fitsPhase4Ceiling(capUsd)) throw new CeilingStop(ceilingRefusal(label, capUsd));
  const result = fn();
  const costs = costsOf(roots.AVARICE_DATA_ROOT, onboarding);
  const spent = costs.finished > 0 ? costs.chargedUsd : result.code === null ? capUsd : 0;
  if (spent > 0) recordPhase4Spend({ plan: ctx.plan, case: label, costUsd: spent, claudeVersion: ctx.claudeVersion });
  return { result, costs };
}

function onboardArgs(capUsd: number, promote: boolean, repo: string): string[] {
  const budgets = [`costUsdPerInvocation=${capUsd}`, `costUsdPerRun=${capUsd}`, 'retry=1', 'wallClockMinutes=20'].flatMap((b) => ['--budget', b]);
  return ['onboard', '--policy', 'onboarding', '--mode', 'fast', ...budgets, ...(promote ? ['--promote', 'commit'] : []), repo];
}

function resolveNodeModules(ctx: LiveContext, task: EvalTask, source: string): string | undefined {
  const named = ctx.nodeModules.get(task.repository);
  if (named !== undefined) return named;
  const own = join(source, 'node_modules');
  if (!existsSync(own)) return undefined;
  // The checkout's own tree is used only when its lockfile is the one the parent committed.
  const parentLock = spawnSync('git', ['-C', source, 'show', `${task.parent}:package-lock.json`], { env: GIT_ENV });
  if (parentLock.status !== 0) return own;
  const checkoutLock = join(source, 'package-lock.json');
  return existsSync(checkoutLock) && createHash('sha256').update(readFileSync(checkoutLock)).digest('hex') === createHash('sha256').update(parentLock.stdout).digest('hex') ? own : undefined;
}

async function runOne(ctx: LiveContext, run: PlannedRun): Promise<RunResult> {
  const { task, arm } = run;
  const source = ctx.sources.get(task.repository);
  if (source === undefined) throw new EvalRefusal(`${task.id}: no source for repository ${task.repository}`);
  const dir = mkdtempSync(join(ctx.scratch, `${task.id}-${arm}-`));
  const repo = join(dir, 'repo');
  const base: RunResult = { task: task.id, arm, success: false, tokens: 0, costUsd: 0, runId: '', state: 'not-started', tokensComplete: true, setup: { costUsd: 0, tokens: 0, mapCostUsd: 0 } };
  try {
    prepareArmWorkspace({ source, task, dest: repo });
    if (arm === 'A' && run.mapCapUsd > 0) {
      // The map at the parent: a throwaway fast onboarding that promotes its accepted map as one commit on a branch, which the arm's repository then fast-forwards to.
      const roots = rootsIn(join(dir, 'map'));
      writeArmProfile(ctx, roots, 'B');
      const { result, costs } = await spendStep(ctx, `eval-${task.id}-${arm}-map`, run.mapCapUsd, roots, true, () => cli(ctx, roots, onboardArgs(run.mapCapUsd, true, repo), REPO_ROOT, 25 * 60_000));
      base.setup.mapCostUsd = costs.chargedUsd;
      base.setup.costUsd += costs.chargedUsd;
      base.setup.tokens += costs.tokens;
      const branch = git(repo, ['for-each-ref', '--format=%(refname)', 'refs/heads/avarice/onboard-*']).trim();
      if (result.code !== 0 || branch === '') return { ...base, state: 'map-failed', note: `map generation ended with exit ${result.code}` };
      git(repo, ['checkout', '-q', '-B', 'eval', branch]);
      git(repo, ['update-ref', '-d', branch]);
    }
    const roots = rootsIn(join(dir, 'arm'));
    writeArmProfile(ctx, roots, arm);
    const onboard = await spendStep(ctx, `eval-${task.id}-${arm}-onboard`, run.onboardCapUsd, roots, true, () => cli(ctx, roots, onboardArgs(run.onboardCapUsd, false, repo), REPO_ROOT, 25 * 60_000));
    base.setup.costUsd += onboard.costs.chargedUsd;
    base.setup.tokens += onboard.costs.tokens;
    if (onboard.result.code !== 0) return { ...base, state: 'onboarding-failed', note: `onboarding ended with exit ${onboard.result.code}` };

    const brief = join(dir, 'brief.md');
    writeFileSync(brief, briefFor(task));
    const cap = run.runCapUsd;
    const started = await spendStep(
      ctx,
      `eval-${task.id}-${arm}-run`,
      cap,
      roots,
      false,
      () => cli(ctx, roots, ['start', '--brief', brief, '--policy', 'routine', '--budget', `costUsdPerRun=${cap}`, '--budget', `costUsdPerInvocation=${cap}`, '--wait'], repo, 150 * 60_000),
    );
    const runId = /^run (\S+): /m.exec(started.result.stdout)?.[1] ?? '';
    const finalLine = started.result.stdout.split('\n').reverse().find((l) => /^run \S+: /.test(l)) ?? '';
    const state = finalLine.replace(/^run \S+: /, '') || `exit ${started.result.code}`;
    const result: RunResult = { ...base, runId, state, tokens: started.costs.tokens, costUsd: started.costs.chargedUsd, tokensComplete: started.costs.tokensComplete };
    if (runId === '' || gitStatus(repo, ['rev-parse', '--verify', '-q', `refs/heads/avarice/${runId}`]) !== 0) return { ...result, note: 'the run left no branch to judge' };

    const judgeDir = join(dir, 'judge');
    prepareJudgeClone({ workspace: repo, ref: `refs/heads/avarice/${runId}`, source, task, dest: judgeDir });
    const judge = await judgeClone({ cwd: judgeDir, task, executor: ctx.executor, nodeModules: resolveNodeModules(ctx, task, source) });
    return { ...result, success: judge.success, judge, ...(judge.error !== undefined ? { judgeError: judge.error } : {}) };
  } finally {
    if (!ctx.keep) rmSync(dir, { recursive: true, force: true });
    else ctx.log(`kept ${dir}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------------------------------------------------------

interface Options {
  dryRun: boolean;
  live: boolean;
  tasks: number | undefined;
  arms: ArmId[];
  capUsd: number;
  out: string | undefined;
  tasksFile: string;
  reposFile: string;
  sources: Map<string, string>;
  nodeModules: Map<string, string>;
  scratch: string | undefined;
  keep: boolean;
}

const USAGE = 'usage: node scripts/eval-retrieval.ts (--dry-run | --live --out <file>) [--tasks <n>] [--arms A,B,C] [--cap-usd <n>] [--tasks-file <file>] [--repos-file <file>] [--source <id>=<path>] [--node-modules <id>=<dir>] [--scratch <dir>] [--keep]';

class UsageError extends Error {}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    dryRun: false,
    live: false,
    tasks: undefined,
    arms: [...ARM_IDS],
    capUsd: DEFAULT_RUN_CAP_USD,
    out: undefined,
    tasksFile: join(REPO_ROOT, 'test', 'benchmark', 'phase4', 'eval-tasks.json'),
    reposFile: join(REPO_ROOT, 'test', 'benchmark', 'phase4', 'ac14-repositories.json'),
    sources: new Map(),
    nodeModules: new Map(),
    scratch: undefined,
    keep: false,
  };
  const pair = (value: string, flag: string): [string, string] => {
    const at = value.indexOf('=');
    if (at <= 0 || at === value.length - 1) throw new UsageError(`${flag} needs <id>=<path>`);
    return [value.slice(0, at), value.slice(at + 1)];
  };
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i] as string;
    const eq = raw.indexOf('=');
    const flag = raw.startsWith('--') && eq > 0 ? raw.slice(0, eq) : raw;
    const inline = raw.startsWith('--') && eq > 0 ? raw.slice(eq + 1) : undefined;
    const value = (): string => {
      const v = inline ?? argv[++i];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--live':
        options.live = true;
        break;
      case '--keep':
        options.keep = true;
        break;
      case '--tasks': {
        const n = Number(value());
        if (!Number.isInteger(n) || n < 1) throw new UsageError('--tasks needs a whole number of at least 1');
        options.tasks = n;
        break;
      }
      case '--arms': {
        const names = value().split(',');
        const arms = names.map((n) => ARM_IDS.find((a) => a === n));
        if (arms.some((a) => a === undefined) || new Set(names).size !== names.length) throw new UsageError('--arms needs a list of A, B and C without repeats');
        options.arms = arms as ArmId[];
        break;
      }
      case '--cap-usd': {
        const n = Number(value());
        if (!Number.isFinite(n) || n <= 0) throw new UsageError('--cap-usd needs a positive number');
        options.capUsd = n;
        break;
      }
      case '--out':
        options.out = resolve(value());
        break;
      case '--tasks-file':
        options.tasksFile = resolve(value());
        break;
      case '--repos-file':
        options.reposFile = resolve(value());
        break;
      case '--scratch':
        options.scratch = resolve(value());
        break;
      case '--source': {
        const [id, path] = pair(value(), '--source');
        options.sources.set(id, resolve(path));
        break;
      }
      case '--node-modules': {
        const [id, path] = pair(value(), '--node-modules');
        options.nodeModules.set(id, resolve(path));
        break;
      }
      default:
        throw new UsageError(`unknown argument ${raw}`);
    }
  }
  if (options.dryRun === options.live) throw new UsageError('name exactly one of --dry-run and --live');
  if (options.live && options.out === undefined) throw new UsageError('--live needs --out <file>');
  return options;
}

// The source repository of each id: --source first, then the repositories file (a path with `~` expanded; a public URL is not a source this harness reads).
function resolveSources(options: Options): Map<string, string> {
  const sources = new Map<string, string>(options.sources);
  try {
    const parsed = JSON.parse(readFileSync(options.reposFile, 'utf8')) as { repositories?: Array<{ id?: unknown; source?: unknown; sourceKind?: unknown }> };
    for (const entry of parsed.repositories ?? []) {
      if (typeof entry.id !== 'string' || typeof entry.source !== 'string' || entry.sourceKind !== 'owner-path' || sources.has(entry.id)) continue;
      sources.set(entry.id, entry.source.startsWith('~') ? join(homedir(), entry.source.slice(1)) : resolve(entry.source));
    }
  } catch {
    // No repositories file: only the --source paths count.
  }
  return sources;
}

// Whether the parent already carries a GSD codebase map, read from git objects only. An unreadable source counts as no map, so the projection is not too low.
function mapPresentAt(source: string | undefined, parent: string): boolean {
  if (source === undefined) return false;
  const result = spawnSync('git', ['-C', source, 'ls-tree', '-r', '--name-only', parent, '--', '.planning/codebase'], { env: GIT_ENV, encoding: 'utf8' });
  return result.status === 0 && result.stdout.trim() !== '';
}

const usd = (n: number): string => n.toFixed(2);

function printPlan(plan: readonly PlannedRun[], project: Projection, approved: ApprovedTasks, sources: Map<string, string>): string {
  const lines: string[] = [];
  lines.push(`eval-retrieval: ${plan.length} planned runs (tasks file approved by ${approved.approvedBy} at ${approved.approvedAt}, sha256 ${approved.digest})`);
  lines.push('run  task  arm  size    repository               run-cap  onboard-cap  map-cap');
  for (const r of plan) {
    lines.push(`${String(r.n).padStart(3)}  ${r.task.id.padEnd(4)}  ${r.arm}    ${r.task.size.padEnd(6)}  ${r.task.repository.padEnd(23)}  ${usd(r.runCapUsd).padStart(7)}  ${usd(r.onboardCapUsd).padStart(11)}  ${usd(r.mapCapUsd).padStart(7)}`);
  }
  const unknown = [...new Set(plan.map((r) => r.task.repository))].filter((id) => !sources.has(id));
  lines.push(`${plan.length} planned runs`);
  lines.push(`projected (cap bound, not a forecast): runs ${usd(project.runUsd)} + onboarding ${usd(project.onboardUsd)} + arm A map generation ${usd(project.mapUsd)} (${project.mapParents} parent(s) without a map) = ${usd(project.totalUsd)} USD`);
  if (unknown.length > 0) lines.push(`note: no source for ${unknown.join(', ')}; their parents are counted as carrying no map`);
  lines.push(`Phase 4 spend ${usd(phase4Spent())} of ${usd(phase4Ceiling())} USD (D-03), headroom ${usd(phase4Ceiling() - phase4Spent())}`);
  return `${lines.join('\n')}\n`;
}

function writeResults(file: string, header: Record<string, unknown>, results: readonly RunResult[], stopped: string | undefined): void {
  const summary = summarize(results);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...header, runs: results, summary, ...(stopped !== undefined ? { stopped } : {}) }, null, 2)}\n`);
}

export async function main(argv: readonly string[]): Promise<number> {
  let options: Options;
  try {
    options = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`eval-retrieval: ${(e as Error).message}\n${USAGE}\n`);
    return 64;
  }
  let approved: ApprovedTasks;
  try {
    approved = loadApprovedTasks(options.tasksFile);
  } catch (e) {
    if (!(e instanceof EvalRefusal)) throw e;
    process.stderr.write(`eval-retrieval: refused: ${e.message}\n`);
    return 3;
  }
  const tasks = approved.tasks.slice(0, options.tasks ?? approved.tasks.length);
  const sources = resolveSources(options);
  const plan = planRuns(tasks, options.arms, { capUsd: options.capUsd, mapPresent: (task) => mapPresentAt(sources.get(task.repository), task.parent) });
  const project = projection(plan);
  process.stdout.write(printPlan(plan, project, approved, sources));
  if (!fitsPhase4Ceiling(project.totalUsd)) {
    process.stderr.write(`eval-retrieval: ${ceilingRefusal('evaluation', project.totalUsd)}\n`);
    return 3;
  }
  if (options.dryRun) return 0;

  // --live: nothing below runs unless the whole plan fits the ceiling (checked above) and every model step fits it again when it starts.
  const scratch = options.scratch ?? mkdtempSync(join(tmpdir(), 'avarice-eval-'));
  mkdirSync(scratch, { recursive: true });
  const bin = liveClaudeBin();
  const ctx: LiveContext = {
    scratch: realpathSync(scratch),
    claudeBin: bin,
    claudeVersion: claudeVersion(bin),
    plan: process.env['AVARICE_PHASE4_PLAN'] ?? '04-36',
    sources,
    nodeModules: options.nodeModules,
    keep: options.keep,
    executor: new SandboxedExecutor(),
    log: (line) => process.stderr.write(`${line}\n`),
  };
  const header = {
    schema: 1,
    kind: 'avarice-ac8-evaluation',
    generatedAt: new Date().toISOString(),
    tasksFile: { path: options.tasksFile, sha256: approved.digest, approvedBy: approved.approvedBy, approvedAt: approved.approvedAt },
    claudeVersion: ctx.claudeVersion,
    caps: { runUsd: options.capUsd, onboardUsd: ONBOARD_CAP_USD, mapUsd: MAP_CAP_USD },
    projection: project,
  };
  const results: RunResult[] = [];
  let stopped: string | undefined;
  for (const run of plan) {
    try {
      const result = await runOne(ctx, run);
      results.push(result);
      ctx.log(`${run.task.id} ${run.arm}: ${result.success ? 'success' : 'no success'} (${result.state}), ${result.tokens} tokens, ${usd(result.costUsd)} USD`);
    } catch (e) {
      stopped = e instanceof CeilingStop ? `ceiling: ${e.message}` : `${run.task.id} ${run.arm}: ${(e as Error).message}`;
      break;
    } finally {
      writeResults(options.out as string, header, results, stopped);
    }
  }
  writeResults(options.out as string, header, results, stopped);
  if (stopped !== undefined) {
    process.stderr.write(`eval-retrieval: stopped: ${stopped}\n`);
    return stopped.startsWith('ceiling:') ? 3 : 1;
  }
  const summary = summarize(results);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      process.stderr.write(`eval-retrieval: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exitCode = 1;
    },
  );
}
