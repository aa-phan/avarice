// Bounded repair and regression charging (plan 03-19; D-11, AUT-10, AUT-16). After every item the required checks run on the clone. A check is newly failing
// when it passed at the item's start and fails now, and that failure is charged to the item being gated, never to an earlier one:
//
//   itemStartStatuses  what the checks said when the item began: the G2 result of the item committed last, over the baseline measured at the pin
//   reproducerFor      the smallest reproducer of each failing check, built from the output AVARICE stored for it (a digest and a bounded list, never the text)
//   repairUnit         the one repair of a newly failing check: checkpoint `repair`, an attempt with the reason `repair` on the same item (implemented ->
//                      delegated), and a `repair:reproducer` step holding the reproducer. item.ts launches the unit, classifies it and gates it again
//
// A repair is a second unit of the same item, on the work the first unit left in the clone. Its changes and the first unit's make one commit (research
// Pitfall 5), so the item's base snapshot (step `item:base`, recorded when a unit that is not a repair launches) is the one G2 and the commit measure
// against; the repair attempt's own snapshot serves its own discard and gate G3 only.
import { randomUUID } from 'node:crypto';
import type { CheckOutcome } from '../../domain/evidence.ts';
import { matchesAny } from '../../domain/glob.ts';
import { storedText } from '../../domain/quick-record.ts';
import { buildReproducer } from '../../domain/reproducer.ts';
import type { Reproducer } from '../../domain/reproducer.ts';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { AttemptRow } from '../../ports/ledger.ts';
import type { WorkspaceSnapshot } from '../../ports/run-workspace.ts';
import { recordedBase, recordedInventory } from '../checks.ts';
import type { CheckRunResult } from '../checks.ts';
import type { RunStageContext } from './stage.ts';

// The reason of the attempt that repairs an item's newly failing check.
export const REPAIR_REASON = 'repair';
// The step that holds the reproducer of a failing check (the repair's input, and the evidence of the decision when repair is not enough).
export const REPAIR_STEP = 'repair:reproducer';
// What the attempt that was repaired ended as: its work stays, and the repair goes on from it.
export const REPAIRED_OUTCOME = 'repaired';

const MAX_TEXT_PATHS = 10;
const MAX_FAILING_REFS = 20;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []);

// ---- the item's start ------------------------------------------------------------------------------------------------------------------------

// The item committed last before `itemId` (the clone's HEAD is its commit), from the `commit` steps in the order they were written; null when no other
// item is committed yet. An attempt that names no item is skipped.
export function previousItemOf(ctx: RunStageContext, itemId: string): Result<string | null> {
  const steps = ctx.deps.ledger.getRunSteps(ctx.runId);
  if (!steps.ok) return steps;
  const attempts = ctx.deps.ledger.listRunAttempts(ctx.runId);
  if (!attempts.ok) return attempts;
  const itemOf = new Map(attempts.value.map((a) => [a.attemptId, a.itemId]));
  let previous: string | null = null;
  for (const step of steps.value) {
    if (step.step !== 'commit' || step.status !== 'completed' || !isObject(step.result) || typeof step.result['attemptId'] !== 'string') continue;
    const owner = itemOf.get(step.result['attemptId']);
    if (typeof owner === 'string' && owner !== itemId) previous = owner;
  }
  return ok(previous);
}

// What each check said when the item began (AUT-16): the baseline measured at the pin, overlaid with the latest G2 result of every check of the item
// committed last. The first item has the baseline alone. A check that is not in the item's results (it did not run there) keeps its earlier status.
export function itemStartStatuses(ctx: RunStageContext, itemId: string): Result<CheckOutcome[]> {
  const base = recordedBase(ctx.deps, ctx.runId);
  if (!base.ok) return base;
  const previous = previousItemOf(ctx, itemId);
  if (!previous.ok) return previous;
  const statuses = new Map<string, CheckOutcome>(base.value.map((outcome) => [outcome.name, outcome]));
  if (previous.value === null) return ok([...statuses.values()]);
  const evidence = ctx.deps.ledger.listEvidence(ctx.runId);
  if (!evidence.ok) return evidence;
  for (const row of evidence.value) {
    if (row.kind === 'check' && row.workItem === previous.value && row.environment['label'] === 'g2') statuses.set(row.name, { name: row.name, status: row.status, evidenceId: row.evidenceId });
  }
  return ok([...statuses.values()]);
}

// The test inventory the item began with: the one the item committed last ended with, else the one measured at the pin; null when none is declared.
export function itemStartInventory(ctx: RunStageContext, itemId: string): ReturnType<typeof recordedInventory> {
  const previous = previousItemOf(ctx, itemId);
  if (!previous.ok) return previous;
  if (previous.value !== null) {
    const ended = recordedInventory(ctx.deps, ctx.runId, 'item', { workItem: previous.value });
    if (!ended.ok || ended.value !== null) return ended;
  }
  return recordedInventory(ctx.deps, ctx.runId, 'base');
}

// ---- the reproducer --------------------------------------------------------------------------------------------------------------------------

export interface ReproducerSet {
  reproducers: Reproducer[];
  // The inventory IDs of the failing tests the output named (an ID the inventory does not hold is not judged), sorted.
  failingTestIds: string[];
  // The test files those IDs live in, when the inventory globs match them, sorted.
  testFiles: string[];
  evidenceIds: string[];
}

function resolveTestIds(names: readonly string[], inventoryIds: readonly string[]): string[] {
  const found = new Set<string>();
  const known = new Set(inventoryIds);
  for (const name of names) {
    if (known.has(name)) {
      found.add(name);
      continue;
    }
    for (const id of inventoryIds) if (id.endsWith(` > ${name}`)) found.add(id);
  }
  return [...found].sort();
}

// The reproducer of every failing check, sorted by check name: the check, its command, the exit code, the digest of the output AVARICE stored, the failing test
// IDs the output names and the paths changed since the item's base (the last state where the check passed). `inventory` resolves the test names the output
// carries to the IDs the inventory lists, which gate G3 reads.
export function reproducerFor(
  ctx: RunStageContext,
  clone: string,
  failing: readonly CheckRunResult[],
  base: WorkspaceSnapshot,
  inventory: { ids: readonly string[]; globs: readonly string[] },
): Result<ReproducerSet> {
  const { deps } = ctx;
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  const changed = workspace.changedSince(clone, base);
  if (!changed.ok) return changed;
  const paths = changed.value.map((c) => c.path);
  const evidence = deps.ledger.listEvidence(ctx.runId);
  if (!evidence.ok) return evidence;

  const reproducers: Reproducer[] = [];
  const names: string[] = [];
  for (const run of [...failing].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const row = evidence.value.find((e) => e.evidenceId === run.evidenceId);
    if (row === undefined) return err({ kind: 'not_found', ref: `evidence ${run.evidenceId} of run ${ctx.runId}` });
    let output = '';
    if (row.artifactDigest !== null) {
      const bytes = deps.artifacts.get(row.artifactDigest);
      if (!bytes.ok) return bytes;
      output = new TextDecoder().decode(bytes.value);
    }
    const reproducer = buildReproducer({ check: run.name, argv: row.command ?? [], exitCode: row.exitCode ?? -1, output, changedSinceLastPass: paths });
    reproducers.push(reproducer);
    names.push(...reproducer.failingTests);
  }
  const failingTestIds = resolveTestIds(names, inventory.ids);
  const testFiles = [...new Set(failingTestIds.map((id) => (id.includes(' > ') ? id.slice(0, id.indexOf(' > ')) : id)).filter((path) => matchesAny(path, inventory.globs)))].sort();
  return ok({ reproducers, failingTestIds, testFiles, evidenceIds: failing.map((f) => f.evidenceId).sort() });
}

// The reproducer as the repair unit reads it: data under a fixed line, bounded (the prompt cuts it again).
export function reproducerText(reproducers: readonly Reproducer[]): string {
  const lines: string[] = [];
  for (const r of reproducers) {
    lines.push(`check: ${r.check}`);
    lines.push(`command: ${r.command}`);
    lines.push(`exit code: ${r.exitCode}`);
    lines.push(`failing tests: ${r.failingTests.length === 0 ? 'none named in the output' : r.failingTests.join('; ')}`);
    lines.push(`output digest: ${r.outputDigest}`);
    lines.push(`changed since the check last passed: ${r.diff.paths.length === 0 ? 'nothing' : r.diff.paths.slice(0, MAX_TEXT_PATHS).join(', ')}`);
  }
  return lines.join('\n');
}

// ---- the repair steps ------------------------------------------------------------------------------------------------------------------------

export interface RepairStep {
  attemptId: string;
  itemId: string;
  failedAttemptId: string | null;
  // The checks this repair was started for; empty for a step written only to hold the reproducer of a decision.
  repairFor: string[];
  reproducers: Reproducer[];
  failingTestIds: string[];
  testFiles: string[];
  evidenceIds: string[];
}

function repairStepFrom(result: unknown): RepairStep | null {
  if (!isObject(result) || typeof result['attemptId'] !== 'string' || typeof result['itemId'] !== 'string') return null;
  return {
    attemptId: result['attemptId'],
    itemId: result['itemId'],
    failedAttemptId: typeof result['failedAttemptId'] === 'string' ? result['failedAttemptId'] : null,
    repairFor: strings(result['repairFor']),
    reproducers: Array.isArray(result['reproducers']) ? (result['reproducers'].filter(isObject) as unknown as Reproducer[]) : [],
    failingTestIds: strings(result['failingTestIds']),
    testFiles: strings(result['testFiles']),
    evidenceIds: strings(result['evidenceIds']),
  };
}

// The `repair:reproducer` step written for one attempt, or null.
export function repairStepOf(ctx: RunStageContext, attemptId: string): Result<RepairStep | null> {
  const steps = ctx.deps.ledger.getRunSteps(ctx.runId);
  if (!steps.ok) return steps;
  for (const step of [...steps.value].reverse()) {
    if (step.step !== REPAIR_STEP || step.status !== 'completed') continue;
    const parsed = repairStepFrom(step.result);
    if (parsed !== null && parsed.attemptId === attemptId) return ok(parsed);
  }
  return ok(null);
}

// Records the reproducer a decision cites on the attempt that was gated, unless the attempt already has a step of its own (a repair attempt holds the
// reproducer it was started with).
export function recordReproducerStep(ctx: RunStageContext, attempt: AttemptRow, itemId: string, set: ReproducerSet): Result<void> {
  const existing = repairStepOf(ctx, attempt.attemptId);
  if (!existing.ok) return existing;
  if (existing.value !== null) return ok(undefined);
  const now = ctx.deps.clock.nowMs();
  const recorded = ctx.deps.ledger.recordRunStep(ctx.runId, {
    step: REPAIR_STEP,
    attempt: attempt.ordinal,
    status: 'completed',
    result: stepResult(attempt.attemptId, itemId, null, [], set),
    nowMs: now,
    completedAtMs: now,
  });
  return recorded.ok ? ok(undefined) : recorded;
}

function stepResult(attemptId: string, itemId: string, failedAttemptId: string | null, repairFor: readonly string[], set: ReproducerSet): Record<string, unknown> {
  return {
    attemptId,
    itemId,
    failedAttemptId,
    repairFor: [...repairFor],
    reproducers: set.reproducers,
    failingTestIds: set.failingTestIds,
    testFiles: set.testFiles,
    evidenceIds: set.evidenceIds,
  };
}

// The repairs each check of the item has had: the launched repair attempts since the item last started over (an answer to its decision), counted by the
// checks each was started for. An attempt that never launched its unit is not a repair (a kill between the attempt and the launch leaves it).
export function repairsOf(ctx: RunStageContext, itemId: string, launched: ReadonlySet<string>, exceptAttemptId?: string): Result<Map<string, number>> {
  const attempts = ctx.deps.ledger.listRunAttempts(ctx.runId, { itemId });
  if (!attempts.ok) return attempts;
  const lastAnswer = attempts.value.map((a) => a.reason).lastIndexOf('answer');
  const since = new Set((lastAnswer > 0 ? attempts.value.slice(lastAnswer) : attempts.value).filter((a) => a.reason === REPAIR_REASON && a.attemptId !== exceptAttemptId && launched.has(a.attemptId)).map((a) => a.attemptId));
  const counts = new Map<string, number>();
  const steps = ctx.deps.ledger.getRunSteps(ctx.runId);
  if (!steps.ok) return steps;
  for (const step of steps.value) {
    if (step.step !== REPAIR_STEP || step.status !== 'completed') continue;
    const parsed = repairStepFrom(step.result);
    if (parsed === null || !since.has(parsed.attemptId)) continue;
    for (const name of parsed.repairFor) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return ok(counts);
}

// ---- the repair ------------------------------------------------------------------------------------------------------------------------------

export interface RepairInput {
  clone: string;
  itemId: string;
  // The attempt whose G2 failed: its work stays in the clone, and it ends `repaired`.
  failedAttemptId: string;
  // The item's base snapshot: the diff in the reproducer is measured against it.
  base: WorkspaceSnapshot;
  failing: readonly CheckRunResult[];
  inventory: { ids: readonly string[]; globs: readonly string[] };
}

export interface PreparedRepair {
  attemptId: string;
  ordinal: number;
  sessionId: string;
  // The reproducer as the unit's prompt carries it.
  text: string;
  set: ReproducerSet;
}

// Starts the one repair of a newly failing check: the checkpoint first (it carries the lease fence, so a stale supervisor stops here), then the attempt,
// the item's move implemented -> delegated, the end of the attempt that was repaired and the reproducer step. The caller launches the unit.
export function repairUnit(ctx: RunStageContext, input: RepairInput): Result<PreparedRepair> {
  const { deps } = ctx;
  const marked = ctx.checkpoint(REPAIR_REASON, { itemId: input.itemId, attemptId: input.failedAttemptId, revision: input.base.head });
  if (!marked.ok) return marked;

  const set = reproducerFor(ctx, input.clone, input.failing, input.base, input.inventory);
  if (!set.ok) return set;
  const attempt = deps.ledger.recordRunAttempt(ctx.runId, { reason: REPAIR_REASON, itemId: input.itemId, nowMs: deps.clock.nowMs() });
  if (!attempt.ok) return attempt;
  const sessionId = randomUUID();
  const moved = deps.ledger.transitionWorkItem(ctx.runId, input.itemId, { fence: ctx.fence }, { to: 'delegated', nowMs: deps.clock.nowMs(), attemptId: attempt.value.attemptId, gsdSession: sessionId, data: { repair: true } });
  if (!moved.ok) return moved;
  const ended = deps.ledger.endRunAttempt(input.failedAttemptId, { outcome: REPAIRED_OUTCOME, nowMs: deps.clock.nowMs() });
  // An attempt ends once; a second ending is the first one's record, not an error.
  if (!ended.ok && ended.error.kind !== 'conflict') return ended;

  const now = deps.clock.nowMs();
  const names = input.failing.map((f) => f.name).sort();
  const recorded = deps.ledger.recordRunStep(ctx.runId, {
    step: REPAIR_STEP,
    attempt: attempt.value.ordinal,
    status: 'completed',
    result: stepResult(attempt.value.attemptId, input.itemId, input.failedAttemptId, names, set.value),
    nowMs: now,
    completedAtMs: deps.clock.nowMs(),
  });
  if (!recorded.ok) return recorded;
  return ok({ attemptId: attempt.value.attemptId, ordinal: attempt.value.ordinal, sessionId, text: reproducerText(set.value.reproducers), set: set.value });
}

// The references a repeated_failure decision cites for the failing checks (the smallest reproducer, AUT-10): the check, the digest of its output and the
// failing test IDs, with the evidence rows of the runs that failed. Bounded, and never the output itself.
export function reproducerRefs(set: Pick<ReproducerSet, 'reproducers' | 'evidenceIds'>): string[] {
  const refs: string[] = [...set.evidenceIds];
  for (const r of set.reproducers) {
    refs.push(`check:${r.check}`, `output:${r.outputDigest}`);
    for (const test of r.failingTests.slice(0, MAX_FAILING_REFS)) refs.push(`test:${storedText(test, 200)}`);
  }
  return refs;
}

// One line a decision's issue carries for each failing check.
export function reproducerIssue(set: Pick<ReproducerSet, 'reproducers'>): string {
  return set.reproducers
    .map((r) => `${r.check} (${r.command}) exited ${r.exitCode}${r.failingTests.length > 0 ? `, failing tests: ${r.failingTests.slice(0, 5).join('; ')}` : ''}, output ${r.outputDigest.slice(0, 19)}`)
    .join(' | ');
}
