// Parking the delta of an item that stops to ask (plan 03-18; AUT-3, research Pitfall 1). The unit's edits, and the GSD records it wrote, leave the
// clone's working tree and stay reachable by one ref in the clone (`refs/avarice/park/<runId>/<itemId>`), so the next item runs on the base content
// and nothing of the parked item can reach another item's commit.
//
// The step comes first. It is recorded as `started` with what the decision will say (the block descriptor), so a supervisor killed anywhere between
// the park checkpoint and the decision resumes by writing the decision from this step, never by running the unit again. The park itself is repeatable:
// the workspace keeps the commit of an earlier park of the same content, so the resumed park returns the same record.
import { storedText } from '../../domain/quick-record.ts';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { DecisionSignal } from '../../domain/decision-policy.ts';
import type { RunBlockedReason } from '../../domain/run-lifecycle.ts';
import type { ParkRecord, WorkspaceSnapshot } from '../../ports/run-workspace.ts';
import type { RunStageContext } from './stage.ts';

export const PARK_STEP = 'park';
const QUESTION_MAX_CHARS = 2000;

// What the decision of a parked item says, kept on the park step: the signal (the structural facts and the pause text as data), the issue as the
// owner will read it, the evidence the block cites and the short IDs of the run's transition event.
export interface BlockDescriptor {
  reason: RunBlockedReason;
  signal: DecisionSignal;
  issue: string;
  evidenceRefs: string[];
  data?: Record<string, unknown>;
}

export interface ParkInput {
  clone: string;
  itemId: string;
  attemptId: string;
  // The run's own count of the attempt: the key of the step.
  ordinal: number;
}

// A park step as the ledger holds it: `record` is null while the step is `started` (the park may or may not have happened).
export interface ParkStep {
  attemptId: string;
  itemId: string;
  status: 'started' | 'completed';
  record: ParkRecord | null;
  block: BlockDescriptor;
}

export interface ParkedItem {
  attemptId: string;
  itemId: string;
  record: ParkRecord;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isSha = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{40,64}$/.test(value);

// The pause text is model text stored as data: cut, with control characters stripped, before it goes into the ledger.
function storedSignal(signal: DecisionSignal): DecisionSignal {
  if (signal.kind === 'pause' && signal.question !== undefined) return { ...signal, question: storedText(signal.question, QUESTION_MAX_CHARS) };
  if (signal.kind === 'g1-checkpoint' && signal.question !== undefined) return { ...signal, question: storedText(signal.question, QUESTION_MAX_CHARS) };
  return signal;
}

function recordOf(body: Record<string, unknown>): ParkRecord | null {
  const { ref, commit, tree, baseHead, paths } = body;
  if (typeof ref !== 'string' || !isSha(commit) || !isSha(tree) || !isSha(baseHead) || !Array.isArray(paths)) return null;
  return { ref, commit, tree, baseHead, paths: paths.filter((p): p is string => typeof p === 'string') };
}

function stepFrom(status: string, body: unknown): ParkStep | null {
  if (!isObject(body) || typeof body['attemptId'] !== 'string' || typeof body['itemId'] !== 'string' || !isObject(body['block'])) return null;
  const block = body['block'];
  if (typeof block['reason'] !== 'string' || typeof block['issue'] !== 'string' || !isObject(block['signal'])) return null;
  const completed = status === 'completed';
  return {
    attemptId: body['attemptId'],
    itemId: body['itemId'],
    status: completed ? 'completed' : 'started',
    record: completed ? recordOf(body) : null,
    block: block as unknown as BlockDescriptor,
  };
}

// The park step of one attempt (any status), or null when the attempt never reached the park.
export function parkStepOf(ctx: RunStageContext, attemptId: string): Result<ParkStep | null> {
  const steps = ctx.deps.ledger.getRunSteps(ctx.runId);
  if (!steps.ok) return steps;
  for (const s of [...steps.value].reverse()) {
    if (s.step !== PARK_STEP || (s.status !== 'started' && s.status !== 'completed')) continue;
    const parsed = stepFrom(s.status, s.result);
    if (parsed !== null && parsed.attemptId === attemptId) return ok(parsed);
  }
  return ok(null);
}

// The latest completed park of one item: what a resume with the owner's answer would put back.
export function latestParkOf(ctx: RunStageContext, itemId: string): Result<ParkedItem | null> {
  const steps = ctx.deps.ledger.getRunSteps(ctx.runId);
  if (!steps.ok) return steps;
  for (const s of [...steps.value].reverse()) {
    if (s.step !== PARK_STEP || s.status !== 'completed') continue;
    const parsed = stepFrom(s.status, s.result);
    if (parsed !== null && parsed.itemId === itemId && parsed.record !== null) return ok({ attemptId: parsed.attemptId, itemId, record: parsed.record });
  }
  return ok(null);
}

// Takes the delta of the item's attempt out of the working tree, back to `base`. A second call for an attempt whose park completed returns that
// record and touches nothing.
export function parkItem(ctx: RunStageContext, input: ParkInput, base: WorkspaceSnapshot, block: BlockDescriptor): Result<ParkRecord> {
  const { deps } = ctx;
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  const existing = parkStepOf(ctx, input.attemptId);
  if (!existing.ok) return existing;
  if (existing.value?.status === 'completed' && existing.value.record !== null) return ok(existing.value.record);

  const descriptor: BlockDescriptor = { ...block, signal: storedSignal(block.signal) };
  const startedMs = deps.clock.nowMs();
  if (existing.value === null) {
    const started = deps.ledger.recordRunStep(ctx.runId, {
      step: PARK_STEP,
      attempt: input.ordinal,
      status: 'started',
      result: { attemptId: input.attemptId, itemId: input.itemId, block: descriptor },
      nowMs: startedMs,
    });
    if (!started.ok) return started;
  }
  // The checkpoint carries the lease fence: a stale supervisor fails here, before anything is taken out of the clone.
  const marked = ctx.checkpoint(PARK_STEP, { itemId: input.itemId, attemptId: input.attemptId, revision: base.head });
  if (!marked.ok) return marked;

  const parked = workspace.park(input.clone, { base, runId: ctx.runId, itemId: input.itemId });
  if (!parked.ok) return parked;
  const record = parked.value;
  const completed = deps.ledger.recordRunStep(ctx.runId, {
    step: PARK_STEP,
    attempt: input.ordinal,
    status: 'completed',
    result: {
      attemptId: input.attemptId,
      itemId: input.itemId,
      block: existing.value?.block ?? descriptor,
      ref: record.ref,
      commit: record.commit,
      tree: record.tree,
      baseHead: record.baseHead,
      paths: record.paths,
      pathCount: record.paths.length,
    },
    nowMs: startedMs,
    completedAtMs: deps.clock.nowMs(),
  });
  return completed.ok ? ok(record) : completed;
}
