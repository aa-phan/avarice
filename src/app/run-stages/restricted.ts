// A restricted run (plan 04-23; CON-4, D-12, S-22): analysis and planning only, for a host that cannot be contained. The owner asked for it with `avarice start --restricted`
// and the stored contract says so, which is what every later process that continues the run reads (never a flag, never the host's state).
//
// The run is one invocation of the restricted host (`claude -p <planning prompt> --restricted ...`) in the run's own clone: the host has no shell and no code-running tool
// (the host's `--restricted`), its file tools reach the clone only, and the generated settings give it no command, no subagent and no network. It writes a plan and a list of
// open questions under `.avarice-restricted/` and edits the working copy. The supervisor then stores the outputs as artifacts, the plan, the patch (the clone's diff against the
// pin, without the restricted directory) and the questions, opens one permission decision that names them, and stops the run blocked_on_decision (enforcement_failure). It
// never reaches ready_for_review, because no check and no gate ran: its host lacks required enforcement, and AVARICE does not run repository code outside that
// enforcement. Nothing is committed, nothing is handed off and nothing is written to the owner's repository; the owner applies the patch by hand and cancels the run.
//
// A run killed during its invocation is continued by this same function: the contract is still restricted, the host that launched is reaped by the resume, the clone is
// put back to the pin, and the restricted line is launched again. It can never become a contained run, because nothing here reads anything but the contract.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { RunContract } from '../../domain/run-contract.ts';
import { storedText } from '../../domain/quick-record.ts';
import type { RunRow } from '../../ports/ledger.ts';
import type { InvocationRequest } from '../../ports/agent-host.ts';
import { completeRunInvocation, prepareRunInvocation } from '../invocation.ts';
import { blockRun } from './blocked.ts';
import type { RunStageContext } from './stage.ts';

// The directory under the clone where the host leaves its plan and its questions. It is excluded from the patch.
export const RESTRICTED_DIR = '.avarice-restricted';
export const RESTRICTED_PLAN_FILE = `${RESTRICTED_DIR}/PLAN.md`;
export const RESTRICTED_QUESTIONS_FILE = `${RESTRICTED_DIR}/QUESTIONS.md`;

// The artifact kinds a restricted run stores (all text, so all of them are in REDACTED_TEXT_KINDS).
export const RESTRICTED_PLAN_KIND = 'restricted-plan';
export const RESTRICTED_PATCH_KIND = 'restricted-patch';
export const RESTRICTED_DECISIONS_KIND = 'restricted-decisions';

export const RESTRICTED_OUTPUTS_STEP = 'restricted:outputs';
const RUN_RETENTION = 'run';
const STORE = 'local';
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_BEHAVIOR_CHARS = 8000;
const MAX_LINE_CHARS = 500;

export interface RestrictedItem {
  row: RunRow;
  contract: RunContract;
  // The item the run's decision is about: the one that would have run first.
  itemId: string;
  // The run clone, prepared at the pin by `prepare-workspace`.
  workspacePath: string;
  branch: string;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// The planning prompt (a stored text, never an instruction to AVARICE): the brief's own words, the acceptance criteria and what to leave where.
export function restrictedPrompt(contract: RunContract): string {
  const intent = contract.intent;
  const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max)}...`);
  return [
    'This is a restricted planning session. You cannot run commands or code, and you cannot reach the network. Read the repository in the working directory, then:',
    `1. Write your plan to ${RESTRICTED_PLAN_FILE}: the steps, the files each step changes, and how each acceptance criterion would be shown to hold.`,
    '2. Make the edits the plan calls for in the working copy. They are reviewed as a patch and are not run.',
    `3. Write every question you cannot settle yourself to ${RESTRICTED_QUESTIONS_FILE}, one question per line.`,
    '',
    `Title: ${clip(intent.title, MAX_LINE_CHARS)}`,
    '',
    'Behavior:',
    clip(intent.behavior, MAX_BEHAVIOR_CHARS),
    '',
    'Acceptance criteria:',
    ...intent.acceptance.map((criterion) => `- ${criterion.id}: ${clip(criterion.text, MAX_LINE_CHARS)}`),
    ...(intent.exclusions.length > 0 ? ['', 'Out of scope:', ...intent.exclusions.map((line) => `- ${clip(line, MAX_LINE_CHARS)}`)] : []),
    '',
    'Edit only files under these paths:',
    ...contract.files.write.map((glob) => `- ${glob}`),
    '',
  ].join('\n');
}

// What the invocation may touch beyond the run scope: the restricted directory is writable and nothing else is added. The host's `--restricted` removes the shell; the
// settings deny it as well (strategy `none`), no command is listed and no subagent may start.
function restrictedRequest(request: InvocationRequest, clone: string): InvocationRequest {
  const scope = request.scope;
  return {
    ...request,
    extensions: { skills: [], agents: [] },
    scope: {
      ...scope,
      writeRoots: [...scope.writeRoots, `${clone}/${RESTRICTED_DIR}`],
      writeGlobs: [...(scope.writeGlobs ?? []), `${RESTRICTED_DIR}/**`],
      denyBackgroundShell: true,
      commands: { ...scope.commands, strategy: 'none', readOnly: [], gsdReadVerbs: [], agentCommands: [] },
      subagents: { total: 0, concurrent: 0 },
    },
  };
}

interface Stored {
  digest: string;
  size: number;
}

function storeOutput(ctx: RunStageContext, kind: string, text: string): Result<Stored> {
  const { deps } = ctx;
  const put = deps.artifacts.put(new TextEncoder().encode(text), { kind, runId: ctx.runId });
  if (!put.ok) return put;
  // What the store kept is what the ledger records: a redacted text has another digest than the text that was read.
  const recorded = deps.ledger.recordArtifact({ digest: put.value.digest, size: put.value.size, kind, runId: ctx.runId, retention: RUN_RETENTION, store: STORE, nowMs: deps.clock.nowMs() });
  return recorded.ok ? ok(put.value) : recorded;
}

// The clone back to the pin: a run resumed after a kill starts from what it was given, not from what the killed host left half written. Only paths git reports as
// changed are touched; the user's repository is never named.
function resetClone(ctx: RunStageContext, clone: string): Result<void> {
  const workspace = ctx.deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  const changes = workspace.status(clone);
  if (!changes.ok) return changes;
  const restore = changes.value.filter((c) => c.status !== 'added').map((c) => c.path);
  const remove = changes.value.filter((c) => c.status === 'added').map((c) => c.path);
  if (restore.length > 0) {
    const restored = workspace.restorePaths(clone, restore);
    if (!restored.ok) return restored;
  }
  if (remove.length > 0) {
    const removed = workspace.removeUntracked(clone, remove);
    if (!removed.ok) return removed;
  }
  return ok(undefined);
}

// The open attempt of the run (a resume continues it), or the first one.
function attemptOf(ctx: RunStageContext, itemId: string): Result<string> {
  const { deps } = ctx;
  const attempts = deps.ledger.listRunAttempts(ctx.runId);
  if (!attempts.ok) return attempts;
  const open = [...attempts.value].reverse().find((a) => a.endedAt === null);
  if (open !== undefined) return ok(open.attemptId);
  const opened = deps.ledger.recordRunAttempt(ctx.runId, { reason: 'initial', itemId, nowMs: deps.clock.nowMs() });
  return opened.ok ? ok(opened.value.attemptId) : opened;
}

const ISSUE_ENDING = 'No check and no gate ran and nothing was committed or handed off. Apply the patch to your repository by hand (git apply), then end this run with avarice cancel.';

// The run's end: one permission decision that names what the run left, and the run blocked (enforcement_failure). `withdraw` is the only answer a permission
// decision offers, and answering it applies nothing; the run stays blocked until it is cancelled.
function blockWithOutputs(ctx: RunStageContext, item: RestrictedItem, attemptId: string | undefined, found: { plan?: Stored; patch?: Stored; decisions?: Stored; questions: number; hostKind: string }): Result<'moved'> {
  const parts = [
    found.plan !== undefined ? `plan ${found.plan.digest}` : 'no plan was written',
    found.patch !== undefined ? `patch ${found.patch.digest}` : 'no edit was made to the working copy',
    found.decisions !== undefined ? `${found.questions} open ${found.questions === 1 ? 'question' : 'questions'} ${found.decisions.digest}` : 'no open question',
  ];
  const evidenceRefs = [found.plan, found.patch, found.decisions].filter((s): s is Stored => s !== undefined).map((s) => `artifact:${s.digest}`);
  const blocked = blockRun(ctx, {
    reason: 'enforcement_failure',
    signal: { kind: 'enforcement', check: 'restricted-run' },
    issue: `restricted run (the host cannot be contained; the host reported ${found.hostKind}): ${parts.join('; ')}. ${ISSUE_ENDING}`,
    evidenceRefs,
    ...(attemptId !== undefined ? { attemptId } : {}),
    itemId: item.itemId,
    data: { mode: 'restricted', host: ctx.deps.restrictedHost?.descriptor.adapter ?? 'none', hostKind: found.hostKind },
    place: { workspacePath: item.workspacePath, branch: item.branch },
  });
  return blocked.ok ? ok('moved') : blocked;
}

export async function runRestrictedItem(ctx: RunStageContext, item: RestrictedItem): Promise<Result<'moved'>> {
  const { deps } = ctx;
  const { row, contract, itemId } = item;
  const clone = item.workspacePath;
  const place = { workspacePath: clone, branch: item.branch };
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });

  // The only host a restricted run can reach (never `deps.host`, whatever its enforcement): an absent or refusing one stops the run, it never lets the run on.
  const host = deps.restrictedHost;
  const attributes = host?.descriptor.attributes ?? {};
  if (host === undefined || attributes['enforcement'] !== 'restricted') {
    const reason = host === undefined ? 'no restricted host is composed' : (attributes['reason'] ?? 'the restricted host is not ready');
    const blocked = blockRun(ctx, {
      reason: 'enforcement_failure',
      signal: { kind: 'enforcement', check: 'restricted-host' },
      issue: `restricted mode is not available: ${reason}. Nothing was launched.`,
      itemId,
      data: { mode: 'restricted', gate: 'restricted-host' },
      place,
    });
    return blocked.ok ? ok('moved') : blocked;
  }

  const attemptId = attemptOf(ctx, itemId);
  if (!attemptId.ok) return attemptId;

  // A restricted invocation that was already judged and stored is not run again: a kill between the step and the block leaves a run that only has to be finished.
  const steps = deps.ledger.getRunSteps(ctx.runId);
  if (!steps.ok) return steps;
  const done = steps.value.find((s) => s.step === RESTRICTED_OUTPUTS_STEP && s.status === 'completed');
  if (done !== undefined) {
    const open = deps.ledger.listDecisions({ runId: ctx.runId, state: 'open' });
    if (!open.ok) return open;
    const body = isObject(done.result) ? done.result : {};
    if (open.value.some((d) => d.class === 'permission')) {
      const current = deps.ledger.getRun(ctx.runId);
      if (!current.ok) return current;
      const moved = ctx.transition(current.value, 'blocked_on_decision', 'none', { reason: 'enforcement_failure', data: { mode: 'restricted', resumed: true }, itemId, ...place });
      return moved.ok ? ok('moved') : moved;
    }
    const asStored = (key: string): Stored | undefined => {
      const entry = body[key];
      return isObject(entry) && typeof entry['digest'] === 'string' && typeof entry['size'] === 'number' ? { digest: entry['digest'], size: entry['size'] } : undefined;
    };
    const plan = asStored('plan');
    const patch = asStored('patch');
    const decisions = asStored('decisions');
    return blockWithOutputs(ctx, item, attemptId.value, {
      ...(plan !== undefined ? { plan } : {}),
      ...(patch !== undefined ? { patch } : {}),
      ...(decisions !== undefined ? { decisions } : {}),
      questions: typeof body['questions'] === 'number' ? body['questions'] : 0,
      hostKind: typeof body['hostKind'] === 'string' ? body['hostKind'] : 'unknown',
    });
  }

  const reset = resetClone(ctx, clone);
  if (!reset.ok) return reset;

  const launching = ctx.checkpoint('restricted-run', { attemptId: attemptId.value, itemId });
  if (!launching.ok) return launching;
  // The run row learns its workspace only when it moves on; the invocation is prepared against the clone the preparation recorded.
  const prepared = prepareRunInvocation(deps, { ...row, workspacePath: clone }, restrictedPrompt(contract), { attemptId: attemptId.value, itemId });
  if (!prepared.ok) return prepared;
  if (!prepared.value.granted) {
    const blocked = blockRun(ctx, {
      reason: 'budget_exhausted',
      signal: { kind: 'budget', names: [prepared.value.budget] },
      issue: `the ${prepared.value.budget} budget is spent, so the restricted invocation was not started`,
      attemptId: attemptId.value,
      itemId,
      data: { budget: prepared.value.budget },
      place,
    });
    return blocked.ok ? ok('moved') : blocked;
  }
  // The restricted directory is made after the scope is computed: the scope denies every top-level entry the pin has that is not a write root, and the directory is not one.
  const dir = workspace.ensureDir(clone, RESTRICTED_DIR);
  if (!dir.ok) return dir;

  const request = restrictedRequest(prepared.value.prepared.request, clone);
  const launch = { ...prepared.value.prepared, request };
  const outcome = await host.invoke(request, ctx.signal);
  const completed = completeRunInvocation(deps, launch, outcome);
  // The host's own error comes back unchanged and is judged below; any other failure is the bookkeeping's and stops the stage.
  if (!completed.ok && completed !== outcome) return completed;
  if (ctx.signal.aborted) {
    // The owner's cancel: the attempt ends cancelled, nothing is stored or blocked, and the supervisor's loop carries the cancel out.
    if (ctx.cancelRequested?.() === true) {
      const ended = deps.ledger.endRunAttempt(attemptId.value, { outcome: 'cancelled', nowMs: deps.clock.nowMs() });
      return ended.ok || ended.error.kind === 'conflict' ? ok('moved') : ended;
    }
    return err({ kind: 'conflict', expected: `the run lease held by this supervisor (fence ${ctx.fence})`, actual: 'the run lease was lost during the restricted invocation' });
  }

  if (!outcome.ok) {
    const e = outcome.error;
    const named = e.kind === 'denied' ? `${e.kind}: ${e.rule}` : e.kind;
    const blocked = blockRun(ctx, {
      reason: 'enforcement_failure',
      signal: { kind: 'enforcement', check: 'restricted-launch' },
      issue: `the restricted invocation did not run (${storedText(named, 200)}). Nothing was changed in your repository.`,
      attemptId: attemptId.value,
      itemId,
      data: { mode: 'restricted', error: e.kind },
      place,
    });
    return blocked.ok ? ok('moved') : blocked;
  }

  // The outputs, read from the clone through the workspace port (confined to the clone, no symlink followed) and stored as artifacts.
  const stored: { plan?: Stored; patch?: Stored; decisions?: Stored } = {};
  let questions = 0;
  const planText = workspace.readText(clone, RESTRICTED_PLAN_FILE, MAX_OUTPUT_BYTES);
  if (!planText.ok) return planText;
  if (planText.value !== null && planText.value.trim() !== '') {
    const put = storeOutput(ctx, RESTRICTED_PLAN_KIND, planText.value);
    if (!put.ok) return put;
    stored.plan = put.value;
  }
  const patchText = workspace.patch(clone, { exclude: [RESTRICTED_DIR] });
  if (!patchText.ok) return patchText;
  if (patchText.value !== '') {
    const put = storeOutput(ctx, RESTRICTED_PATCH_KIND, patchText.value);
    if (!put.ok) return put;
    stored.patch = put.value;
  }
  const questionText = workspace.readText(clone, RESTRICTED_QUESTIONS_FILE, MAX_OUTPUT_BYTES);
  if (!questionText.ok) return questionText;
  if (questionText.value !== null) {
    questions = questionText.value.split('\n').filter((line) => line.trim() !== '').length;
    if (questions > 0) {
      const put = storeOutput(ctx, RESTRICTED_DECISIONS_KIND, questionText.value);
      if (!put.ok) return put;
      stored.decisions = put.value;
    }
  }

  const hostKind = outcome.value.kind;
  const nowMs = deps.clock.nowMs();
  const recorded = deps.ledger.recordRunStep(ctx.runId, {
    step: RESTRICTED_OUTPUTS_STEP,
    status: 'completed',
    result: { ...stored, questions, hostKind, attemptId: attemptId.value },
    nowMs,
    completedAtMs: nowMs,
  });
  if (!recorded.ok) return recorded;
  return blockWithOutputs(ctx, item, attemptId.value, { ...stored, questions, hostKind });
}
