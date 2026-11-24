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
//   --authorize The owner's spend authorization (WR-33): refuses unless stdin and stdout are both an interactive terminal, prints the plan and its projection, asks the owner to
//               type `authorize`, and writes the record (list digest, task ids, arms, cap, ownerConfirmedAt, terminal) to the file named by --authorization. Starts no model.
//   --live      Runs the plan: needs AVARICE_LIVE=1 and --authorization naming a record that equals this run's list digest, task ids and arms, whose cap covers the projection and
//               that the owner confirmed within the last 24 hours (checked before any clone, onboarding or ledger write; exit 3 otherwise), refuses when the whole plan would pass
//               the ceiling, then checks the ceiling again before each model step and records each step's spend in the Phase 4 ledger under AVARICE_PHASE4_PLAN (default 04-36).
//               Needs --out.
//
// The authorization record is a procedural guard: an agent running as the owner's user could write the file by hand, so the Phase 4 spend ledger's ceiling is the mechanical
// guard, and every step is recorded there at no less than it may have cost.
//
// Flags: --tasks <n> (the first n approved tasks, default all), --task-ids T01,T07 (exactly these approved tasks, in this order; an id off the approved list is refused; not with
//        --tasks), --merge (needs --out: keep the runs the file already holds, skip their (task, arm) pairs and add the rest; refused when the file came from another approved list;
//        a live start over a file that holds runs is refused without it), --arms A,B,C, --cap-usd <n> (the per-run cost cap, default 0.40), --out <file> (the results JSON),
//        --authorization <file> (the spend authorization record: written by --authorize, read by --live), --tasks-file <file>, --repos-file <file>, --source <repository id>=<path> (repeatable; default the source in the repositories file), --node-modules <id>=<dir>
//        (repeatable; the dependency tree the judge copies into its clone; default the source checkout's own when its lockfile equals the parent's), --scratch <dir>, --keep,
//        --evidence-dir <dir> (before a run's scratch is removed, copy its decision records, rows, steps, events and host transcript into <dir>/<task>-<arm>; redacted, at most
//        5 MB a run, truncations recorded in the run's manifest.json).
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
import { processRedactor } from '../src/adapters/redaction/process-redactor.ts';
import { matchesAny } from '../src/domain/glob.ts';
import { redactLeaves } from '../src/domain/redactor.ts';
import type { Redactor } from '../src/domain/redactor.ts';
import { ROUTINE_PRESET } from '../src/domain/run-contract.ts';
import type { CommandExecutor } from '../src/ports/command-executor.ts';
import { ceilingRefusal, claudeVersion, fitsPhase4Ceiling, liveClaudeBin, phase4Ceiling, phase4Spent, recordPhase4Spend } from '../test/helpers/live-harness.ts';
import { REPO_ROOT, runCli } from '../test/helpers/run-cli.ts';
import type { CliRoots } from '../test/helpers/run-cli.ts';
import { authorizeRefusal, realAuthorizeIo } from './exit-run-phase4-tools.ts';
import type { AuthorizeIo } from './exit-run-phase4-tools.ts';

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
// (0.6 USD, plans 03-xx); arm C's is larger by its knowledge invocation: 1.10 USD since the owner's ruling of plan 04-36, because the knowledge pass on the largest repository
// (auto_search_workflow) cost 0.974 USD in the AC-14 benchmark, above the 0.90 USD first assumed. The pilot (plan 04-36) measures the real figures.
export const ONBOARD_CAP_USD: Readonly<Record<ArmId, number>> = { A: 0.6, B: 0.6, C: 1.1 };
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

// The tasks of a run: the named approved tasks in the order given (`ids`, plan 04-36), else the first `first` approved tasks, else all of them. An id that is not on the approved
// list is refused, so a run can never replay a task the owner did not approve; the approved file and its digest are untouched.
export function selectTasks(approved: ApprovedTasks, selection: { first?: number; ids?: readonly string[] }): EvalTask[] {
  if (selection.ids === undefined) return approved.tasks.slice(0, selection.first ?? approved.tasks.length);
  if (selection.ids.length === 0) throw new EvalRefusal('--task-ids names no task');
  const byId = new Map(approved.tasks.map((t) => [t.id, t] as const));
  const chosen: EvalTask[] = [];
  for (const id of selection.ids) {
    const task = byId.get(id);
    if (task === undefined) throw new EvalRefusal(`${id} is not on the approved task list ${approved.file}`);
    if (chosen.includes(task)) throw new EvalRefusal(`${id} is named twice in --task-ids`);
    chosen.push(task);
  }
  return chosen;
}

// What is left to run once the (task, arm) pairs of an earlier invocation are set aside, renumbered (plan 04-36): a recorded pair is never run again, so a merge cannot
// duplicate it or pay for it twice.
export function skipRecorded(plan: readonly PlannedRun[], recorded: ReadonlyArray<{ task: string; arm: string }>): PlannedRun[] {
  const done = new Set(recorded.map((r) => `${r.task}\0${r.arm}`));
  return plan.filter((r) => !done.has(`${r.task.id}\0${r.arm}`)).map((r, index) => ({ ...r, n: index + 1 }));
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

// ADR-016: the AC-8 token bound, as a whole percentage of arm A's tokens. It is an integer so that the inclusive comparison below is exact.
export const AC8_TOKEN_BOUND_PERCENT = 95;

// AC-8 (ADR-016): arm B or arm C has a success rate at least arm A's at no more than AC8_TOKEN_BOUND_PERCENT of arm A's tokens. Exactly the bound passes; one token over fails.
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
    const tokensOk = arm.tokens * 100 <= a.tokens * AC8_TOKEN_BOUND_PERCENT;
    detail[name] = { successOk, tokensOk, tokenShare: arm.tokens / a.tokens };
    if (via === null && successOk && tokensOk) via = name;
  }
  if (via !== null) return { pass: true, via, reason: `arm ${via} succeeds at least as often as A at ${(100 * (detail[via]?.tokenShare ?? 0)).toFixed(1)}% of A's tokens`, arms: detail };
  if (detail.B === undefined && detail.C === undefined) return { pass: false, via: null, reason: 'neither arm B nor arm C has totals', arms: detail };
  return { pass: false, via: null, reason: `no pack arm both matches the success of A and stays within ${AC8_TOKEN_BOUND_PERCENT}% of its tokens`, arms: detail };
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
// Re-judging recorded runs (ADR-016)
// ---------------------------------------------------------------------------------------------------------------------------------------------

export interface RejudgedArm {
  runs: number;
  success: number;
  tokens: number;
  // The arm's tokens as a share of arm A's, rounded to four decimals.
  shareOfA: number;
}

export interface Rejudgement {
  schema: 1;
  kind: 'avarice-ac8-rejudgement';
  decision: 'ADR-016';
  boundPercent: number;
  sourceSha256: string;
  arms: Partial<Record<ArmId, RejudgedArm>>;
  verdict: Ac8Verdict;
  knowledge: KnowledgeOutcome;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// Judges recorded runs against the current AC-8 bound. It starts no model and spends nothing; `sourceSha256` names the results file it was read from ('' for runs given directly).
export function rejudge(runs: readonly RunSummaryInput[], sourceSha256 = ''): Rejudgement {
  const summary = summarize(runs);
  const baseline = summary.arms.A?.tokens ?? 0;
  const arms: Partial<Record<ArmId, RejudgedArm>> = {};
  for (const arm of ARM_IDS) {
    const own = summary.arms[arm];
    if (own === undefined) continue;
    arms[arm] = { runs: own.runs, success: own.success, tokens: own.tokens, shareOfA: baseline > 0 ? round4(own.tokens / baseline) : 0 };
  }
  return { schema: 1, kind: 'avarice-ac8-rejudgement', decision: 'ADR-016', boundPercent: AC8_TOKEN_BOUND_PERCENT, sourceSha256, arms, verdict: summary.ac8, knowledge: summary.knowledge };
}

// Reads a results file the harness wrote and judges its runs again. The file is only read, so its digest is the same afterwards.
export function rejudgeResultsFile(file: string): Rejudgement {
  const raw = readFileSync(file);
  const parsed = JSON.parse(raw.toString('utf8')) as { runs?: unknown };
  if (!isRecord(parsed) || !Array.isArray(parsed['runs'])) throw new EvalRefusal(`${file} holds no runs to judge`);
  const runs = parsed['runs'].map((r: unknown): RunSummaryInput => {
    if (!isRecord(r) || !ARM_IDS.some((a) => a === r['arm']) || typeof r['success'] !== 'boolean' || typeof r['tokens'] !== 'number' || typeof r['costUsd'] !== 'number') throw new EvalRefusal(`${file} holds a run that is not a recorded evaluation run`);
    return { arm: r['arm'] as ArmId, success: r['success'], tokens: r['tokens'], costUsd: r['costUsd'], ...(typeof r['judgeError'] === 'string' ? { judgeError: r['judgeError'] } : {}) };
  });
  return rejudge(runs, createHash('sha256').update(raw).digest('hex'));
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Re-judging recorded runs with brief coverage (ADR-017, G-04-3)
// ---------------------------------------------------------------------------------------------------------------------------------------------
//
// An AC-8 success used to mean the required checks and the held-out test passed, so a run that skipped a bullet its brief asked for still counted (the owner's decision of
// 2026-11-23, G-04-3: count it as partial). The functions below judge the recorded runs again from recorded data and files only: they start no model, spend nothing and write
// nothing. The coverage of each run is a record a person made and the owner approved; the amended success rule is its own file, pinned to the digest of the approved task list,
// which is never edited.

// The bullets of a brief: the lines of the commit message after the subject. A line starting `- ` opens a bullet and a following indented line continues it (joined with one
// space); any other non-empty line opens an item of its own; a message with no body has one bullet, its subject.
export function briefBullets(task: { brief: string }): string[] {
  const lines = task.brief.replace(/\r\n/g, '\n').split('\n');
  const subject = (lines[0] ?? '').trim();
  const items: string[] = [];
  let open = false;
  for (const line of lines.slice(1)) {
    if (line.trim() === '') {
      open = false;
    } else if (line.startsWith('- ')) {
      items.push(line.slice(2).trim());
      open = true;
    } else if (open && /^\s/.test(line)) {
      items[items.length - 1] = `${items[items.length - 1] ?? ''} ${line.trim()}`;
    } else {
      items.push(line.trim());
      open = false;
    }
  }
  return items.length > 0 ? items : [subject];
}

export type CoverageStatus = 'delivered' | 'partly' | 'skipped';
const COVERAGE_STATUSES: readonly string[] = ['delivered', 'partly', 'skipped'];

export interface BulletCoverage {
  text: string;
  status: CoverageStatus;
  evidence: string;
}

export interface RunCoverage {
  task: string;
  arm: ArmId;
  runId: string;
  bullets: BulletCoverage[];
}

export interface BriefCoverage {
  schema: 1;
  kind: 'avarice-eval-brief-coverage';
  decision: 'ADR-017';
  resultsSha256: string;
  tasksSha256: string;
  judgedBy: string;
  judgedAt: string;
  method: string;
  runs: RunCoverage[];
}

export interface SuccessAmendment {
  schema: 1;
  kind: 'avarice-eval-success-amendment';
  decision: 'ADR-017';
  amends: { file: string; sha256: string; field: 'successRule' };
  successRule: string;
  partialRule: string;
  // Both null in a draft; both set by the owner when approved.
  approvedBy: string | null;
  approvedAt: string | null;
}

// A recorded run of the results file, with the fields the coverage judgement reads.
export interface RecordedRun extends RunSummaryInput {
  task: string;
  runId?: string;
}

export type CoverageOutcome = 'success' | 'partial' | 'failure';

export interface JudgedRun {
  task: string;
  arm: ArmId;
  recordedSuccess: boolean;
  outcome: CoverageOutcome;
  skipped: string[];
  partly: string[];
}

export interface CoverageArm {
  runs: number;
  success: number;
  partial: number;
  tokens: number;
}

export interface CoverageJudgement {
  arms: Partial<Record<ArmId, CoverageArm>>;
  runs: JudgedRun[];
  verdict: Ac8Verdict;
  knowledge: KnowledgeOutcome;
}

const sha256Of = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

function readJsonRecord(file: string, what: string): { bytes: Buffer; value: Record<string, unknown> } {
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch {
    throw new EvalRefusal(`cannot read the ${what} ${file}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new EvalRefusal(`${file} is not valid JSON`);
  }
  if (!isRecord(parsed) || parsed['schema'] !== 1) throw new EvalRefusal(`${file} is not a ${what} of schema 1`);
  return { bytes, value: parsed };
}

const RFC_3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const AMENDED_TASKS_FILE = 'test/benchmark/phase4/eval-tasks.json';

export type LoadedCoverage = BriefCoverage & { digest: string };
export type LoadedAmendment = SuccessAmendment & { digest: string };

// Reads a brief coverage record. `runs` are the recorded runs of the results file the record judges (see readCoverageRuns).
export function loadCoverage(file: string, resultsSha256: string, tasks: ApprovedTasks, runs: readonly RecordedRun[]): LoadedCoverage {
  const { bytes, value } = readJsonRecord(file, 'brief coverage record');
  const text = (field: string): string => {
    const v = value[field];
    if (typeof v !== 'string') throw new EvalRefusal(`${file}: ${field} is missing or not text`);
    return v;
  };
  if (value['kind'] !== 'avarice-eval-brief-coverage') throw new EvalRefusal(`${file}: kind is not avarice-eval-brief-coverage`);
  if (value['decision'] !== 'ADR-017') throw new EvalRefusal(`${file}: decision is not ADR-017`);
  const list = value['runs'];
  if (!Array.isArray(list)) throw new EvalRefusal(`${file}: runs is missing or not a list`);
  const entries = list.map((raw: unknown, index): RunCoverage => {
    const where = `${file}: runs[${index}]`;
    if (!isRecord(raw) || typeof raw['task'] !== 'string' || !ARM_IDS.some((a) => a === raw['arm']) || typeof raw['runId'] !== 'string' || !Array.isArray(raw['bullets'])) throw new EvalRefusal(`${where} is not a run coverage entry`);
    const bullets = raw['bullets'].map((b: unknown, i): BulletCoverage => {
      if (!isRecord(b) || typeof b['text'] !== 'string' || typeof b['status'] !== 'string' || typeof b['evidence'] !== 'string') throw new EvalRefusal(`${where}.bullets[${i}] is not a bullet coverage entry`);
      return { text: b['text'], status: b['status'] as CoverageStatus, evidence: b['evidence'] };
    });
    return { task: raw['task'], arm: raw['arm'] as ArmId, runId: raw['runId'], bullets };
  });
  if (text('resultsSha256') !== resultsSha256) throw new EvalRefusal(`${file}: resultsSha256 does not match the results file being judged`);
  if (text('tasksSha256') !== tasks.digest) throw new EvalRefusal(`${file}: tasksSha256 does not match the approved task list ${tasks.file}`);
  // Every recorded run has exactly one entry (and the run id it recorded), and no entry names a run that was not recorded.
  for (const run of runs) {
    const own = entries.filter((e) => e.task === run.task && e.arm === run.arm);
    if (own.length === 0) throw new EvalRefusal(`${file}: ${run.task} arm ${run.arm} has no coverage entry`);
    if (own.length > 1) throw new EvalRefusal(`${file}: ${run.task} arm ${run.arm} has ${own.length} coverage entries, not one`);
    if (run.runId !== undefined && own[0]?.runId !== run.runId) throw new EvalRefusal(`${file}: ${run.task} arm ${run.arm} names runId ${own[0]?.runId ?? ''}, the results record ${run.runId}`);
  }
  for (const entry of entries) {
    if (!runs.some((r) => r.task === entry.task && r.arm === entry.arm)) throw new EvalRefusal(`${file}: ${entry.task} arm ${entry.arm} is not a recorded run of the results file`);
  }
  // Each entry judges exactly the bullets of its task's brief, in the brief's order, with a known status and a stated piece of evidence.
  for (const entry of entries) {
    const where = `${file}: ${entry.task} arm ${entry.arm}`;
    const task = tasks.tasks.find((t) => t.id === entry.task);
    if (task === undefined) throw new EvalRefusal(`${where}: the task is not on the approved task list ${tasks.file}`);
    const expected = briefBullets(task);
    if (entry.bullets.length !== expected.length) throw new EvalRefusal(`${where}: ${entry.bullets.length} bullets, the brief has ${expected.length}`);
    for (const [i, bullet] of entry.bullets.entries()) {
      if (bullet.text !== expected[i]) throw new EvalRefusal(`${where}: bullet ${i + 1} text differs from the bullet of the brief`);
      if (!COVERAGE_STATUSES.includes(bullet.status)) throw new EvalRefusal(`${where}: status of bullet ${i + 1} is ${JSON.stringify(bullet.status)}, not delivered, partly or skipped`);
      if (bullet.evidence.trim() === '') throw new EvalRefusal(`${where}: evidence of bullet ${i + 1} is empty`);
    }
  }
  return {
    schema: 1,
    kind: 'avarice-eval-brief-coverage',
    decision: 'ADR-017',
    resultsSha256: text('resultsSha256'),
    tasksSha256: text('tasksSha256'),
    judgedBy: text('judgedBy'),
    judgedAt: text('judgedAt'),
    method: text('method'),
    runs: entries,
    digest: sha256Of(bytes),
  };
}

// Reads the amended success rule. `tasksSha256` is the digest of the approved task list the amendment must be pinned to.
export function loadAmendment(file: string, tasksSha256: string): LoadedAmendment {
  const { bytes, value } = readJsonRecord(file, 'success amendment');
  const text = (field: string): string => {
    const v = value[field];
    if (typeof v !== 'string') throw new EvalRefusal(`${file}: ${field} is missing or not text`);
    return v;
  };
  const amends = value['amends'];
  if (value['kind'] !== 'avarice-eval-success-amendment') throw new EvalRefusal(`${file}: kind is not avarice-eval-success-amendment`);
  if (value['decision'] !== 'ADR-017') throw new EvalRefusal(`${file}: decision is not ADR-017`);
  if (!isRecord(amends) || typeof amends['file'] !== 'string' || typeof amends['sha256'] !== 'string' || amends['field'] !== 'successRule') throw new EvalRefusal(`${file}: amends is missing or malformed`);
  const approval = (field: string): string | null => {
    const v = value[field];
    return typeof v === 'string' ? v : null;
  };
  // The owner approves the amendment as the owner approved the task list: both fields set, the time an RFC 3339 time. A draft holds both as null.
  const approvedBy = approval('approvedBy');
  const approvedAt = approval('approvedAt');
  const isSet = (v: string | null): v is string => v !== null && v.trim() !== '';
  if (!isSet(approvedBy) && !isSet(approvedAt)) throw new EvalRefusal(`${file} is not approved: approvedBy and approvedAt must both be set by the owner`);
  if (!isSet(approvedBy)) throw new EvalRefusal(`${file} is half approved: approvedBy is not set`);
  if (!isSet(approvedAt)) throw new EvalRefusal(`${file} is half approved: approvedAt is not set`);
  if (!RFC_3339.test(approvedAt) || Number.isNaN(Date.parse(approvedAt))) throw new EvalRefusal(`${file}: approvedAt is not an RFC 3339 time`);
  if (amends['file'] !== AMENDED_TASKS_FILE) throw new EvalRefusal(`${file}: amends.file is not ${AMENDED_TASKS_FILE}`);
  if (amends['sha256'] !== tasksSha256) throw new EvalRefusal(`${file}: amends.sha256 is not the digest of the approved task list (${tasksSha256})`);
  return {
    schema: 1,
    kind: 'avarice-eval-success-amendment',
    decision: 'ADR-017',
    amends: { file: amends['file'], sha256: amends['sha256'], field: 'successRule' },
    successRule: text('successRule'),
    partialRule: text('partialRule'),
    approvedBy,
    approvedAt,
    digest: sha256Of(bytes),
  };
}

// The runs of a results file with the task and run id, refusing a run that is not a recorded evaluation run.
export function readCoverageRuns(file: string): { runs: RecordedRun[]; sha256: string } {
  const { bytes, value } = readJsonRecord(file, 'results file');
  const list = value['runs'];
  if (!Array.isArray(list)) throw new EvalRefusal(`${file} holds no runs to judge`);
  const runs = list.map((r: unknown): RecordedRun => {
    if (!isRecord(r) || typeof r['task'] !== 'string' || !ARM_IDS.some((a) => a === r['arm']) || typeof r['success'] !== 'boolean' || typeof r['tokens'] !== 'number' || typeof r['costUsd'] !== 'number') throw new EvalRefusal(`${file} holds a run that is not a recorded evaluation run`);
    return { task: r['task'], arm: r['arm'] as ArmId, success: r['success'], tokens: r['tokens'], costUsd: r['costUsd'], ...(typeof r['runId'] === 'string' ? { runId: r['runId'] } : {}), ...(typeof r['judgeError'] === 'string' ? { judgeError: r['judgeError'] } : {}) };
  });
  return { runs, sha256: sha256Of(bytes) };
}

// Judges recorded runs with their brief coverage. Pure. A recorded success is a success only when every bullet of its brief is delivered, otherwise it is partial; a recorded
// failure stays a failure whatever its coverage. The verdict and the knowledge outcome come from the existing functions over the success counts, so a partial counts for nothing.
export function judgeWithCoverage(runs: readonly RecordedRun[], coverage: Pick<BriefCoverage, 'runs'>): CoverageJudgement {
  const judged: JudgedRun[] = runs.map((run) => {
    const entries = coverage.runs.filter((c) => c.task === run.task && c.arm === run.arm);
    const entry = entries[0];
    if (entry === undefined || entries.length !== 1) throw new EvalRefusal(`${run.task} arm ${run.arm} has ${entries.length} coverage entries, not one`);
    const skipped = entry.bullets.filter((b) => b.status === 'skipped').map((b) => b.text);
    const partly = entry.bullets.filter((b) => b.status === 'partly').map((b) => b.text);
    const outcome: CoverageOutcome = !run.success ? 'failure' : skipped.length === 0 && partly.length === 0 ? 'success' : 'partial';
    return { task: run.task, arm: run.arm, recordedSuccess: run.success, outcome, skipped, partly };
  });
  const summary = summarize(runs.map((run, i) => ({ arm: run.arm, success: judged[i]?.outcome === 'success', tokens: run.tokens, costUsd: run.costUsd })));
  const arms: Partial<Record<ArmId, CoverageArm>> = {};
  for (const arm of ARM_IDS) {
    const own = summary.arms[arm];
    if (own === undefined) continue;
    arms[arm] = { runs: own.runs, success: own.success, partial: judged.filter((j) => j.arm === arm && j.outcome === 'partial').length, tokens: own.tokens };
  }
  return { arms, runs: judged, verdict: summary.ac8, knowledge: summary.knowledge };
}

const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// The files a run's host transcript edited, to help the person who records the coverage: the clone-relative path (the part after the last `/clone/`) of every Edit, Write,
// MultiEdit and NotebookEdit tool call, in the order first seen and once each. Pure; a line that is not JSON, and a call whose path is not inside a clone, is skipped.
export function editedPaths(transcriptText: string): string[] {
  const seen = new Set<string>();
  for (const line of transcriptText.split('\n')) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const message = isRecord(event) ? event['message'] : undefined;
    const content = isRecord(message) ? message['content'] : undefined;
    if (!Array.isArray(content)) continue;
    for (const block of content as unknown[]) {
      if (!isRecord(block) || block['type'] !== 'tool_use' || typeof block['name'] !== 'string' || !EDIT_TOOLS.has(block['name']) || !isRecord(block['input'])) continue;
      // A notebook edit names its file `notebook_path`; the other three name it `file_path`.
      const path = block['input']['file_path'] ?? (block['name'] === 'NotebookEdit' ? block['input']['notebook_path'] : undefined);
      if (typeof path !== 'string') continue;
      const at = path.lastIndexOf('/clone/');
      const relative = at < 0 ? '' : path.slice(at + '/clone/'.length);
      if (relative !== '') seen.add(relative);
    }
  }
  return [...seen];
}

export interface CoverageRejudgedArm extends CoverageArm {
  // The arm's tokens as a share of arm A's, rounded to four decimals.
  shareOfA: number;
}

export interface CoverageRejudgement {
  schema: 1;
  kind: 'avarice-ac8-rejudgement';
  decision: 'ADR-017';
  boundPercent: number;
  resultsSha256: string;
  tasksSha256: string;
  coverageSha256: string;
  amendmentSha256: string;
  successRule: string;
  arms: Partial<Record<ArmId, CoverageRejudgedArm>>;
  runs: JudgedRun[];
  verdict: Ac8Verdict;
  knowledge: KnowledgeOutcome;
}

// Judges the recorded runs again from four files: the results, the approved task list, the brief coverage record and the amended success rule. Read-only.
export function rejudgeWithCoverage(files: { resultsFile: string; tasksFile: string; coverageFile: string; amendmentFile: string }): CoverageRejudgement {
  const tasks = loadApprovedTasks(files.tasksFile);
  const results = readCoverageRuns(files.resultsFile);
  const amendment = loadAmendment(files.amendmentFile, tasks.digest);
  const coverage = loadCoverage(files.coverageFile, results.sha256, tasks, results.runs);
  const judged = judgeWithCoverage(results.runs, coverage);
  const baseline = judged.arms.A?.tokens ?? 0;
  const arms: Partial<Record<ArmId, CoverageRejudgedArm>> = {};
  for (const arm of ARM_IDS) {
    const own = judged.arms[arm];
    if (own === undefined) continue;
    arms[arm] = { ...own, shareOfA: baseline > 0 ? round4(own.tokens / baseline) : 0 };
  }
  return {
    schema: 1,
    kind: 'avarice-ac8-rejudgement',
    decision: 'ADR-017',
    boundPercent: AC8_TOKEN_BOUND_PERCENT,
    resultsSha256: results.sha256,
    tasksSha256: tasks.digest,
    coverageSha256: coverage.digest,
    amendmentSha256: amendment.digest,
    successRule: amendment.successRule,
    arms,
    runs: judged.runs,
    verdict: judged.verdict,
    knowledge: judged.knowledge,
  };
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

// The tool cache directories below the installed dependency tree that a repository's checks write (found by running the portfolio's four checks in a clone, plan 04-36).
export const NODE_MODULES_TOOL_CACHES: readonly string[] = ['node_modules/.tmp/**', 'node_modules/.cache/**', 'node_modules/.vite/**', 'node_modules/.vite-temp/**', 'node_modules/.vitest-cache/**'];

// The conventions file a run needs (`.avarice/config.json`): the task's checks as required checks, a write set of every top-level directory and every top-level file that
// is not protected, and the dependency install when the parent has an npm lockfile. Derived, not copied from the owner's repository.
export function conventionsFor(task: EvalTask, topLevelDirs: readonly string[], topLevelFiles: readonly string[], hasNpmLock: boolean): Record<string, unknown> {
  const write = [...topLevelDirs.filter((d) => !d.startsWith('.') && d !== 'node_modules').map((d) => `${d}/**`), ...topLevelFiles.filter((f) => !f.startsWith('.') && !matchesAny(f, ROUTINE_PRESET.protected))];
  // The run validates each required check once before any model call and blocks the run on a permission decision when a check writes a path it does not declare. The
  // tools of an npm repository write their caches into the installed dependency tree (tsc -b: .tmp; vitest: .cache, .vite, .vite-temp, .vitest-cache), so every check of
  // such a repository declares them (plan 04-36: without it every run on the portfolio repository was blocked before its first model call).
  const writes = hasNpmLock ? { writes: [...NODE_MODULES_TOOL_CACHES] } : {};
  return {
    schema: 1,
    checks: task.checks.map((c) => ({ name: c.name, argv: c.argv, timeoutSec: 900, required: true, ...writes })),
    paths: { write: write.length > 0 ? write : ['**'], protected: [], artifacts: [] },
    ...(hasNpmLock ? { dependencies: { install: ['npm', 'ci'], lockfile: 'package-lock.json', registryHosts: ['registry.npmjs.org'] } } : {}),
  };
}

const PLANNING_STUBS: Readonly<Record<string, string>> = {
  '.planning/PROJECT.md': '# Project\n\nA repository replayed by the AVARICE retrieval evaluation.\n',
  '.planning/ROADMAP.md': '# Roadmap\n\n## Phase 1: Maintenance\n\nGoal: small fixes to the existing code.\n',
  '.planning/STATE.md': '# State\n\nPhase 1 in progress.\n',
};

// The text of `.prettierignore` that keeps the conventions file out of the repository's formatter check, or undefined when nothing changes. The conventions file is the
// harness's, not the repository's: `JSON.stringify` does not print it the way prettier would, so a repository whose check is `prettier --check .` and does not ignore
// `.avarice/` would fail that required check at the setup commit for every arm (plan 04-36, found by judging task parents offline). Only a repository that names prettier in its
// package.json gets the line, and an existing ignore of the directory is left as it is.
function prettierIgnoreWithConventions(repo: string): string | undefined {
  const pkg = join(repo, 'package.json');
  if (!existsSync(pkg) || !readFileSync(pkg, 'utf8').includes('prettier')) return undefined;
  const file = join(repo, '.prettierignore');
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (current.split('\n').some((line) => ['.avarice', '.avarice/', '.avarice/**', '/.avarice', '/.avarice/'].includes(line.trim()))) return undefined;
  return `${current}${current === '' || current.endsWith('\n') ? '' : '\n'}.avarice/\n`;
}

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
  const ignore = prettierIgnoreWithConventions(dest);
  if (ignore !== undefined) setup['.prettierignore'] = ignore;
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
  const message = lines.map((line) => (/^\s{0,3}#{1,6}(\s|$)/.test(line) ? line.replace('#', '\\#') : line)).join('\n').trim();
  // The commit messages ask for work the harness cannot run or judge (an end-to-end spec: its file is a denied read and its command is no required check). A unit that took
  // such a bullet literally finished the change and then ended on a question, which the run recorded as an acceptance decision (plan 04-36 diagnostic). The earlier text kept
  // runs from stopping by putting such tests out of scope, which made the run skip work its brief asked for (G-04-3); the 18 recorded runs were given that earlier text. The
  // scope line now says the test is still part of the change, to be written and not run. It is the same for every task and arm; the commit message above it is kept whole.
  const commands = task.checks.map((c) => c.argv.join(' ')).join(', ');
  const scope = `Only the required checks can run in this environment: ${commands}. An end-to-end or browser test the brief asks for cannot be run here, and it is still part of the change: write it as the brief asks, do not try to run it, and do not stop to ask about running it. Make the change and its tests, run the required checks, and finish the change without waiting for an answer.`;
  const behavior = `${message}\n\n${scope}`;
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

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Per-run evidence (plan 04-36, owner ruling 3)
// ---------------------------------------------------------------------------------------------------------------------------------------------
// A run that stops on a decision leaves its reason in the arm's ledger and its transcript in the artifact store, both inside the scratch the harness removes. Before it removes
// the scratch the harness copies what is needed to classify a stop: the decision records, the run, work-item and attempt rows, the steps, the contract, the events (the hook's
// allow and deny decisions among them) and the host transcript (the denied calls' inputs are in it). The copy reads the arm's data root only: the arm repository, the owner's
// checkout and the dependency tree are never read. Every string goes through the AVARICE redactor, and a run's copy is capped.

export const EVIDENCE_CAP_BYTES = 5 * 1024 * 1024;
// The ledger tables copied, most useful first, so a cap cuts the largest and least specific (events, then transcripts) before the decision records.
const EVIDENCE_TABLES: readonly string[] = ['decisions', 'runs', 'work_items', 'attempts', 'run_steps', 'contracts', 'events'];
// The most a truncation note takes; each file's room for one is set aside before any content is placed, so a cap never leaves a cut file without its note.
const EVIDENCE_NOTE_RESERVE_BYTES = 128;

export interface EvidenceFile {
  name: string;
  bytes: number;
  rows: number;
  total: number;
  truncated: boolean;
}

export interface EvidenceManifest {
  capBytes: number;
  // The bytes of the copied files (this manifest not counted).
  bytes: number;
  files: EvidenceFile[];
  truncated: string[];
  // What could not be read: a missing ledger or table, an artifact that is not in the store.
  absent: string[];
}

export interface EvidenceOptions {
  dataRoot: string;
  dest: string;
  capBytes?: number;
  redactor?: Redactor;
}

// The lines that fit `budget` bytes (each counted with its newline), and whether any line was left out.
function fitLines(lines: readonly string[], budget: number, capBytes: number): { text: string; contentBytes: number; kept: number; truncated: boolean } {
  let used = 0;
  let kept = 0;
  const out: string[] = [];
  for (const line of lines) {
    const bytes = Buffer.byteLength(line) + 1;
    if (used + bytes > budget) break;
    used += bytes;
    kept += 1;
    out.push(line);
  }
  const truncated = kept < lines.length;
  const body = out.length === 0 ? '' : `${out.join('\n')}\n`;
  return { text: truncated ? `${body}[evidence truncated at ${capBytes} bytes: ${kept} of ${lines.length} lines kept]\n` : body, contentBytes: used, kept, truncated };
}

export function captureEvidence(options: EvidenceOptions): EvidenceManifest {
  const capBytes = options.capBytes ?? EVIDENCE_CAP_BYTES;
  const redactor = options.redactor ?? processRedactor;
  mkdirSync(join(options.dest, 'transcripts'), { recursive: true });
  const manifest: EvidenceManifest = { capBytes, bytes: 0, files: [], truncated: [], absent: [] };
  const place = (name: string, lines: readonly string[], budgetLeft: number): number => {
    const fit = fitLines(lines, Math.max(0, budgetLeft), capBytes);
    mkdirSync(dirname(join(options.dest, name)), { recursive: true });
    writeFileSync(join(options.dest, name), fit.text);
    const bytes = Buffer.byteLength(fit.text);
    manifest.files.push({ name, bytes, rows: fit.kept, total: lines.length, truncated: fit.truncated });
    if (fit.truncated) manifest.truncated.push(name);
    manifest.bytes += bytes;
    return fit.contentBytes;
  };
  const ledger = join(options.dataRoot, 'state.db');
  const tables = new Map<string, string[]>();
  const blobs: Array<{ name: string; digest: string }> = [];
  if (!existsSync(ledger)) {
    manifest.absent.push('state.db');
  } else {
    const db = new DatabaseSync(ledger, { readOnly: true, timeout: 5000 });
    try {
      for (const table of EVIDENCE_TABLES) {
        try {
          const order = table === 'events' ? ' ORDER BY seq' : '';
          const rows = db.prepare(`SELECT * FROM ${table}${order}`).all() as Array<Record<string, unknown>>;
          tables.set(table, rows.map((row) => JSON.stringify(redactLeaves({ ...row }, redactor))));
        } catch {
          manifest.absent.push(`${table} (no such table)`);
        }
      }
      try {
        // The run's own artifacts first, the onboarding's last, a summary before the whole transcript it summarizes.
        const artifacts = db.prepare("SELECT digest, kind, retention FROM artifacts WHERE kind IN ('transcript', 'transcript-summary') ORDER BY (retention = 'run') DESC, (kind = 'transcript-summary') DESC, created_at").all() as Array<{ digest: string; kind: string; retention: string }>;
        for (const a of artifacts) {
          const hex = /^sha256:([0-9a-f]{64})$/.exec(a.digest)?.[1];
          if (hex !== undefined) blobs.push({ name: `transcripts/${a.retention}-${a.kind}-${hex.slice(0, 16)}.txt`, digest: hex });
        }
      } catch {
        manifest.absent.push('artifacts (no such table)');
      }
    } finally {
      db.close();
    }
  }
  const files: Array<{ name: string; lines: string[]; digest?: string }> = [
    ...EVIDENCE_TABLES.filter((t) => tables.has(t)).map((t) => ({ name: `${t}.jsonl`, lines: tables.get(t) as string[] })),
    ...blobs.map((b) => ({ name: b.name, lines: [] as string[], digest: b.digest })),
  ];
  // Room for every file's truncation note is set aside first.
  let budget = capBytes - files.length * EVIDENCE_NOTE_RESERVE_BYTES;
  for (const file of files) {
    let lines = file.lines;
    if (file.digest !== undefined) {
      const blob = join(options.dataRoot, 'artifacts', file.digest.slice(0, 2), file.digest);
      if (!existsSync(blob)) {
        manifest.absent.push(`${file.name} (artifact not in the store)`);
        continue;
      }
      // The text is redacted whole, so a secret that spans lines (a key block) is found, then cut at a line boundary by the cap.
      const text = redactor.redact(readFileSync(blob, 'utf8'));
      lines = text === '' ? [] : text.replace(/\n$/, '').split('\n');
    }
    // A cut file's note comes out of its own reserve, so only the content it kept is taken from what the next file may use.
    budget -= place(file.name, lines, budget);
  }
  writeFileSync(join(options.dest, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

// A directory name under `root` that no earlier run of the same (task, arm) took: `T01-B`, then `T01-B-2`, `T01-B-3`.
function freshEvidenceDir(root: string, name: string): string {
  for (let n = 1; ; n += 1) {
    const candidate = join(root, n === 1 ? name : `${name}-${n}`);
    if (!existsSync(candidate)) return candidate;
  }
}

export interface SettleOptions {
  dir: string;
  evidenceRoot: string | undefined;
  task: string;
  arm: ArmId;
  keep: boolean;
  log: (line: string) => void;
  redactor?: Redactor;
}

// What a run does with its scratch when it ends, whatever the outcome (a success, a block, a refusal or an exception): copy the evidence when a directory was named, then remove
// the scratch unless --keep. A copy that fails is reported and never hides the run's result or leaves the scratch behind. Returns the evidence directory, when one was written.
export function settleScratch(options: SettleOptions): string | undefined {
  let evidence: string | undefined;
  if (options.evidenceRoot !== undefined) {
    try {
      mkdirSync(options.evidenceRoot, { recursive: true });
      const dest = freshEvidenceDir(options.evidenceRoot, `${options.task}-${options.arm}`);
      const manifest = captureEvidence({ dataRoot: join(options.dir, 'arm', 'data'), dest, ...(options.redactor !== undefined ? { redactor: options.redactor } : {}) });
      evidence = dest;
      options.log(`evidence ${dest}: ${manifest.files.length} file(s), ${manifest.bytes} bytes${manifest.truncated.length > 0 ? `, truncated: ${manifest.truncated.join(', ')}` : ''}${manifest.absent.length > 0 ? `, absent: ${manifest.absent.join(', ')}` : ''}`);
    } catch (e) {
      options.log(`evidence copy failed for ${options.task} ${options.arm}: ${(e as Error).message}`);
    }
  }
  if (!options.keep) rmSync(options.dir, { recursive: true, force: true });
  else options.log(`kept ${options.dir}`);
  return evidence;
}

export interface LiveContext {
  evidenceRoot: string | undefined;
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

export interface LedgerCosts {
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
  // With evidence kept, the host stores the whole redacted transcript (AVARICE_DEBUG_TRANSCRIPTS, D-14) so the denied calls' inputs survive the scratch.
  return runCli(args, { roots, cwd, env: { AVARICE_CLAUDE_BIN: ctx.claudeBin, ...(ctx.evidenceRoot !== undefined ? { AVARICE_DEBUG_TRANSCRIPTS: '1' } : {}) }, timeoutMs });
}

// Writes the arm's profile configuration over the config `avarice init` created.
function writeArmProfile(ctx: LiveContext, roots: CliRoots, arm: ArmId): void {
  const init = cli(ctx, roots, ['init'], REPO_ROOT, 60_000);
  if (init.code !== 0) throw new Error(`avarice init failed: ${init.stderr || init.stdout}`);
  const path = configPathFor(roots.AVARICE_CONFIG_HOME, 'personal-local');
  const existing: unknown = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path, `${JSON.stringify({ ...(isRecord(existing) ? existing : {}), ...armProfileConfig(arm) }, null, 2)}\n`, { mode: 0o600 });
}

// What a model step is recorded at in the Phase 4 spend ledger (WR-30). The ledger is the only thing that enforces the ceiling, so an amount that cannot be known is the
// step's cap, as the Phase 3 tools recorded it, and never less than the charge the ledger shows: a read that failed (`costs` undefined), a step the timeout killed
// (`code` null, so an invocation may have been in flight when the process died) and a step that ended with no invocation.finished event (the host may have run and left no
// record) each record at least the cap.
export function stepSpendUsd(input: { costs: LedgerCosts | undefined; code: number | null; capUsd: number }): number {
  if (input.costs === undefined) return input.capUsd;
  const floor = input.code === null || input.costs.finished === 0 ? input.capUsd : 0;
  return Math.max(input.costs.chargedUsd, floor);
}

// One model-spending step: the ceiling is checked against the step's cap first, and the amount `stepSpendUsd` gives (what the budgets charged: a killed invocation is
// charged its reservation, never less than the cap when the step's cost cannot be known) is recorded in the Phase 4 spend ledger. A ledger read that throws is recorded at
// the cap first and then rethrown, so the error never costs the ledger the spend.
export async function spendStep<T extends { code: number | null }>(ctx: Pick<LiveContext, 'plan' | 'claudeVersion'>, label: string, capUsd: number, roots: CliRoots, onboarding: boolean, fn: () => T): Promise<{ result: T; costs: LedgerCosts }> {
  if (!fitsPhase4Ceiling(capUsd)) throw new CeilingStop(ceilingRefusal(label, capUsd));
  const result = fn();
  let costs: LedgerCosts | undefined;
  let readError: unknown;
  try {
    costs = costsOf(roots.AVARICE_DATA_ROOT, onboarding);
  } catch (e) {
    readError = e;
  }
  const spent = stepSpendUsd({ costs, code: result.code, capUsd });
  if (spent > 0) recordPhase4Spend({ plan: ctx.plan, case: label, costUsd: spent, claudeVersion: ctx.claudeVersion });
  if (costs === undefined) throw readError;
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
    settleScratch({ dir, evidenceRoot: ctx.evidenceRoot, task: task.id, arm, keep: ctx.keep, log: ctx.log });
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------------------------------------------------------

interface Options {
  dryRun: boolean;
  live: boolean;
  authorize: boolean;
  authorization: string | undefined;
  tasks: number | undefined;
  taskIds: string[] | undefined;
  merge: boolean;
  arms: ArmId[];
  capUsd: number;
  out: string | undefined;
  tasksFile: string;
  reposFile: string;
  sources: Map<string, string>;
  nodeModules: Map<string, string>;
  scratch: string | undefined;
  keep: boolean;
  evidenceDir: string | undefined;
}

const USAGE = 'usage: node scripts/eval-retrieval.ts (--dry-run | --authorize --authorization <file> | --live --out <file> --authorization <file>) [--tasks <n> | --task-ids T01,T07] [--merge] [--arms A,B,C] [--cap-usd <n>] [--tasks-file <file>] [--repos-file <file>] [--source <id>=<path>] [--node-modules <id>=<dir>] [--scratch <dir>] [--keep] [--evidence-dir <dir>]';

class UsageError extends Error {}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    dryRun: false,
    live: false,
    authorize: false,
    authorization: undefined,
    tasks: undefined,
    taskIds: undefined,
    merge: false,
    arms: [...ARM_IDS],
    capUsd: DEFAULT_RUN_CAP_USD,
    out: undefined,
    tasksFile: join(REPO_ROOT, 'test', 'benchmark', 'phase4', 'eval-tasks.json'),
    reposFile: join(REPO_ROOT, 'test', 'benchmark', 'phase4', 'ac14-repositories.json'),
    sources: new Map(),
    nodeModules: new Map(),
    scratch: undefined,
    keep: false,
    evidenceDir: undefined,
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
      case '--authorize':
        options.authorize = true;
        break;
      case '--authorization':
        options.authorization = resolve(value());
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
      case '--task-ids': {
        const ids = value().split(',');
        if (ids.some((id) => id === '')) throw new UsageError('--task-ids needs a comma-separated list of task ids');
        options.taskIds = ids;
        break;
      }
      case '--merge':
        options.merge = true;
        break;
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
      case '--evidence-dir':
        options.evidenceDir = resolve(value());
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
  if ([options.dryRun, options.live, options.authorize].filter(Boolean).length !== 1) throw new UsageError('name exactly one of --dry-run, --authorize and --live');
  if (options.authorize && options.authorization === undefined) throw new UsageError('--authorize needs --authorization <file>');
  if (options.live && options.out === undefined) throw new UsageError('--live needs --out <file>');
  if (options.taskIds !== undefined && options.tasks !== undefined) throw new UsageError('name --tasks or --task-ids, not both');
  if (options.merge && options.out === undefined) throw new UsageError('--merge needs --out <file>');
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

function printPlan(plan: readonly PlannedRun[], project: Projection, approved: ApprovedTasks, sources: Map<string, string>, merge?: { recorded: number; skipped: number }): string {
  const lines: string[] = [];
  lines.push(`eval-retrieval: ${plan.length} planned runs (tasks file approved by ${approved.approvedBy} at ${approved.approvedAt}, sha256 ${approved.digest})`);
  if (merge !== undefined) lines.push(`merge: ${merge.recorded} recorded run(s) in the results file are kept; ${merge.skipped} selected (task, arm) pair(s) already recorded are skipped`);
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

interface ResultsFile {
  runs: RunResult[];
  invocations: unknown[];
}

// The runs an earlier invocation recorded in `file`, for `--merge` (plan 04-36). No file is no runs. The file must be of the same approved task list (its digest equals
// `digest`), well formed, and hold each (task, arm) once: a merge that cannot be sure of what it keeps refuses rather than guess.
function readResultsFile(file: string, digest: string): ResultsFile {
  if (!existsSync(file)) return { runs: [], invocations: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new EvalRefusal(`cannot merge into ${file}: it is not valid JSON`);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed['runs']) || !isRecord(parsed['tasksFile'])) throw new EvalRefusal(`cannot merge into ${file}: it is not an AC-8 results file`);
  if (parsed['tasksFile']['sha256'] !== digest) throw new EvalRefusal(`cannot merge into ${file}: it was produced from another approved task list than the one in use`);
  const seen = new Set<string>();
  for (const run of parsed['runs'] as unknown[]) {
    if (!isRecord(run) || typeof run['task'] !== 'string' || !ARM_IDS.some((a) => a === run['arm'])) throw new EvalRefusal(`cannot merge into ${file}: a recorded run has no task or arm`);
    const key = `${run['task']}\0${run['arm']}`;
    if (seen.has(key)) throw new EvalRefusal(`cannot merge into ${file}: (${run['task']}, ${run['arm']}) is recorded twice`);
    seen.add(key);
  }
  return { runs: parsed['runs'] as RunResult[], invocations: Array.isArray(parsed['invocations']) ? (parsed['invocations'] as unknown[]) : [] };
}

export function readRecordedRuns(file: string, digest: string): RunResult[] {
  return readResultsFile(file, digest).runs;
}

// Whether `file` already holds recorded runs, whatever else is in it: a live start that rewrites the file would destroy them.
function holdsRuns(file: string): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return isRecord(parsed) && Array.isArray(parsed['runs']) && parsed['runs'].length > 0;
  } catch {
    return false;
  }
}

// The results file's content: the header, every run, the summary and, at the top level, the AC-8 verdict and the D-08 outcome (the same two values as `summary.ac8` and
// `summary.knowledge`; plan 04-36's automated check reads them there).
export function resultsDocument(header: Record<string, unknown>, results: readonly RunResult[], stopped: string | undefined): Record<string, unknown> {
  const summary = summarize(results);
  return { ...header, runs: results, summary, verdict: summary.ac8, knowledgeRule: summary.knowledge, ...(stopped !== undefined ? { stopped } : {}) };
}

function writeResults(file: string, header: Record<string, unknown>, results: readonly RunResult[], stopped: string | undefined): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(resultsDocument(header, results, stopped), null, 2)}\n`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The owner's spend authorization (WR-33)
// ---------------------------------------------------------------------------------------------------------------------------------------------

// A record is current for 24 hours after the owner confirmed it; a confirmation more than five minutes ahead of the clock is not believed.
export const EVAL_AUTHORIZATION_MAX_AGE_MS = 24 * 3_600_000;
const EVAL_AUTHORIZATION_SKEW_MS = 5 * 60_000;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export interface EvalAuthorizationExpected {
  listSha256: string;
  taskIds: readonly string[];
  arms: readonly string[];
  projectedUsd: number;
}

const sameList = (a: unknown, b: readonly string[]): boolean => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);

// What stops a recorded authorization from covering this run: it was confirmed from a terminal within the last 24 hours, it names this approved list, these task ids and
// these arms, and its cap covers the projection. An empty list means the record covers the run.
export function evalAuthorizationProblems(record: unknown, expected: EvalAuthorizationExpected, now: Date): string[] {
  if (!isRecord(record)) return ['no authorization is recorded; the owner runs --authorize in their own terminal'];
  const problems: string[] = [];
  const confirmed = record['ownerConfirmedAt'];
  if (typeof confirmed !== 'string' || !RFC3339.test(confirmed) || Number.isNaN(Date.parse(confirmed))) problems.push('the authorization has no ownerConfirmedAt');
  else {
    const age = now.getTime() - Date.parse(confirmed);
    if (age > EVAL_AUTHORIZATION_MAX_AGE_MS) problems.push(`the authorization was confirmed more than 24 hours ago (${confirmed})`);
    if (age < -EVAL_AUTHORIZATION_SKEW_MS) problems.push(`the authorization names a confirmation in the future (${confirmed})`);
  }
  if (record['terminal'] !== true) problems.push('the authorization was not recorded from an interactive terminal');
  if (record['listSha256'] !== expected.listSha256) problems.push('the authorization names another version of the approved task list');
  if (!sameList(record['taskIds'], expected.taskIds)) problems.push(`the authorization names other tasks (${JSON.stringify(record['taskIds'])}) than this run's (${expected.taskIds.join(',')})`);
  if (!sameList(record['arms'], expected.arms)) problems.push(`the authorization names other arms (${JSON.stringify(record['arms'])}) than this run's (${expected.arms.join(',')})`);
  const cap = record['capUsd'];
  if (typeof cap !== 'number' || !Number.isFinite(cap) || cap <= 0) problems.push('the authorization names no cap');
  else if (cap + 1e-9 < expected.projectedUsd) problems.push(`the authorization's cap ${cap.toFixed(2)} USD is below this run's projection ${expected.projectedUsd.toFixed(2)} USD`);
  return problems;
}

function readAuthorization(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

// The owner types `authorize` after reading the projection; anything else records nothing. The cap is the projection rounded up to the cent.
async function authorizeEvaluation(options: Options, expected: EvalAuthorizationExpected, io: AuthorizeIo): Promise<number> {
  const capUsd = Math.ceil(expected.projectedUsd * 100 - 1e-9) / 100;
  process.stdout.write(`You are about to authorize live evaluation spend (D-03). Nothing has run yet.\n`);
  process.stdout.write(`tasks ${expected.taskIds.join(',')}; arms ${expected.arms.join(',')}; per-run cap ${usd(options.capUsd)} USD; authorized cap ${usd(capUsd)} USD for the whole plan\n`);
  process.stdout.write(`Phase 4 spent ${usd(phase4Spent())} of ${usd(phase4Ceiling())} USD; after the cap ${usd(phase4Spent() + capUsd)} USD; record valid for 24 hours\n`);
  const answer = (await io.ask('Type "authorize" to record this authorization, anything else to stop: ')).trim();
  if (answer !== 'authorize') {
    process.stdout.write('not authorized; nothing was recorded\n');
    return 1;
  }
  const record = {
    schema: 1,
    kind: 'avarice-ac8-spend-authorization',
    ownerConfirmedAt: io.now().toISOString(),
    terminal: true,
    listSha256: expected.listSha256,
    taskIds: expected.taskIds,
    arms: expected.arms,
    capUsd,
    runCapUsd: options.capUsd,
  };
  const file = options.authorization as string;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`recorded in ${file}: ownerConfirmedAt ${record.ownerConfirmedAt}\n`);
  return 0;
}

const uniqueTaskIds = (plan: readonly PlannedRun[]): string[] => plan.map((r) => r.task.id).filter((id, i, all) => all.indexOf(id) === i);

export async function main(argv: readonly string[], io: AuthorizeIo = realAuthorizeIo()): Promise<number> {
  let options: Options;
  try {
    options = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`eval-retrieval: ${(e as Error).message}\n${USAGE}\n`);
    return 64;
  }
  if (options.authorize) {
    const refusal = authorizeRefusal(io);
    if (refusal !== undefined) {
      process.stderr.write(`eval-retrieval: refused: ${refusal}\n`);
      return 3;
    }
  }
  if (options.live) {
    // Before the approved list is read, a repository is touched or the ledger is written: a paid run needs the opt-in and a named authorization record.
    if (io.env['AVARICE_LIVE'] !== '1') {
      process.stderr.write('eval-retrieval: refused: --live spends and needs AVARICE_LIVE=1 in the environment\n');
      return 3;
    }
    if (options.authorization === undefined) {
      process.stderr.write('eval-retrieval: refused: --live needs --authorization <file>, the record the owner wrote with --authorize in their own terminal\n');
      return 3;
    }
  }
  let approved: ApprovedTasks;
  try {
    approved = loadApprovedTasks(options.tasksFile);
  } catch (e) {
    if (!(e instanceof EvalRefusal)) throw e;
    process.stderr.write(`eval-retrieval: refused: ${e.message}\n`);
    return 3;
  }
  let tasks: EvalTask[];
  let previous: ResultsFile = { runs: [], invocations: [] };
  try {
    tasks = selectTasks(approved, { ...(options.tasks !== undefined ? { first: options.tasks } : {}), ...(options.taskIds !== undefined ? { ids: options.taskIds } : {}) });
    if (options.merge) previous = readResultsFile(options.out as string, approved.digest);
    else if (options.live && holdsRuns(options.out as string)) throw new EvalRefusal(`${options.out} already holds recorded runs and a live start rewrites it: pass --merge to add to them, or name another --out`);
  } catch (e) {
    if (!(e instanceof EvalRefusal)) throw e;
    process.stderr.write(`eval-retrieval: refused: ${e.message}\n`);
    return 3;
  }
  const sources = resolveSources(options);
  const selected = planRuns(tasks, options.arms, { capUsd: options.capUsd, mapPresent: (task) => mapPresentAt(sources.get(task.repository), task.parent) });
  const plan = options.merge ? skipRecorded(selected, previous.runs) : selected;
  const project = projection(plan);
  process.stdout.write(printPlan(plan, project, approved, sources, options.merge ? { recorded: previous.runs.length, skipped: selected.length - plan.length } : undefined));
  if (plan.length === 0) {
    process.stdout.write(`eval-retrieval: nothing to run: every selected (task, arm) pair is already recorded in ${options.out}\n`);
    return 0;
  }
  const expected: EvalAuthorizationExpected = { listSha256: approved.digest, taskIds: uniqueTaskIds(plan), arms: options.arms, projectedUsd: project.totalUsd };
  if (options.live) {
    // The authorization is judged before the ceiling: a run the owner did not authorize is refused whatever the ledger holds.
    const problems = evalAuthorizationProblems(readAuthorization(options.authorization as string), expected, io.now());
    if (problems.length > 0) {
      process.stderr.write(`eval-retrieval: refused: ${problems.join('; ')} (${options.authorization})\n`);
      return 3;
    }
  }
  if (!fitsPhase4Ceiling(project.totalUsd)) {
    process.stderr.write(`eval-retrieval: ${ceilingRefusal('evaluation', project.totalUsd)}\n`);
    return 3;
  }
  if (options.dryRun) return 0;
  if (options.authorize) return authorizeEvaluation(options, expected, io);

  // --live: nothing below runs unless the whole plan fits the ceiling (checked above) and every model step fits it again when it starts.
  const scratch = options.scratch ?? mkdtempSync(join(tmpdir(), 'avarice-eval-'));
  mkdirSync(scratch, { recursive: true });
  const bin = liveClaudeBin();
  const ctx: LiveContext = {
    evidenceRoot: options.evidenceDir,
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
    taskIds: tasks.map((t) => t.id),
    // Every invocation that wrote into this file, oldest first; `projection` and `caps` above describe the latest one only.
    invocations: [...previous.invocations, { generatedAt: new Date().toISOString(), taskIds: plan.map((r) => r.task.id).filter((id, i, all) => all.indexOf(id) === i), arms: options.arms, runs: plan.length, runCapUsd: options.capUsd, onboardCapUsd: ONBOARD_CAP_USD, projection: project }],
  };
  const results: RunResult[] = [...previous.runs];
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
