// What `status` and `inbox` show about runs (plan 02-15; FR-11, OPS-7, D-19). Read-only: this file calls ledger read methods only,
// takes no lease, starts no model and opens no transcript (T-02-52): every value comes from ledger rows (IDs, states, statuses,
// revisions, counts), never from model output. The shapes here are the JSON of `status --json` (the optional `runs` array of a
// project entry) and of `inbox --json`; the human renderers live in src/cli/render/run-view.ts.
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { RunContract } from '../domain/run-contract.ts';
import { checksNotRun } from './checks.ts';
import { amendCommandOf, isAmendOnly, optionsOf } from '../domain/decision-policy.ts';
import type { DecisionOption } from '../domain/decision-policy.ts';
import { isRunResumable } from '../domain/run-lifecycle.ts';
import type { RunBlockedReason, RunState } from '../domain/run-lifecycle.ts';
import type { AttemptRow, DecisionRow, DecisionUrgency, EvidenceRow, GateResultRow, Ledger, NotificationRow, NotificationState, RunCheckpointRow, RunRow, RunStatusInputs, RunStepRow } from '../ports/ledger.ts';

export interface RunCheckpointView {
  seq: number;
  nextAction: string;
  revision: string | null;
  // ISO time the checkpoint was committed.
  at: string;
}

export interface RunEvidenceView {
  name: string;
  kind: string;
  status: string;
  revision: string;
  clean: boolean;
  // Present (true) only when the check already failed at the pin: reported, not blocking (D-12).
  preExisting?: true;
}

export interface RunGateView {
  gate: string;
  passed: boolean;
  revision: string;
}

export interface RunBudgetView {
  name: string;
  used: number;
  limit: number;
}

export interface RunReferenceView {
  kind: string;
  id: string;
  revision: string;
}

// A reference the run recorded whose last refresh did not find it fresh (plan 04-20): `stale` (the index was built before the repository's current HEAD),
// or `changed`, `deleted`, `access_revoked` or `unavailable`. The ID is the provider's own, verbatim.
export interface RunStaleReferenceView {
  provider: string;
  kind: string;
  id: string;
  freshness: string;
}

// One work item of the run as the ledger holds it (AUT-12): its state, the size and model it was planned with, what it waits for and how many
// times it was delegated.
export interface RunItemView {
  itemId: string;
  state: string;
  size: string;
  model: string;
  dependsOn: string[];
  attempts: number;
}

// One decision of the run in any state. `supersedes` is the decision this one re-opened on a new state digest; `successor` is the one that
// re-opened this one (a stale decision names it), so the owner is always pointed at the decision that is still open.
export interface RunDecisionView {
  decisionId: string;
  class: string;
  state: string;
  affectedItems: string[];
  supersedes: string | null;
  successor: string | null;
}

// How many of the run's notifications are in each delivery state, and the code of the latest delivery that did not arrive. A count of
// `failed` is a record that a banner did not arrive; it never closes or hides a decision (AUT-4).
export interface RunNotificationView {
  delivered: number;
  pending: number;
  held: number;
  failed: number;
  lastError: string | null;
}

// A run that stopped short of a stop state with nobody holding a live lease (S-3, AC-3). The run row keeps its ledger state;
// the owner is shown it as paused, with the attempt and the step that were in flight and the command that continues it.
export interface RunInterrupted {
  state: RunState;
  presentedAs: 'paused';
  reason: 'verification interrupted' | 'supervisor interrupted';
  attemptId: string | null;
  step: string;
  nextAction: string;
  resumeCommand: string;
}

// A declared check the run does not execute because it is neither required nor a target (D-35). The reason is always `not required`.
export interface RunCheckNotRunView {
  name: string;
  reason: 'not required';
}

export interface RunStatus {
  runId: string;
  title: string;
  state: RunState;
  reason: RunBlockedReason | null;
  // The latest checkpoint that names an action; the closing `none` checkpoint of a stop state only repeats the state.
  lastCheckpoint: RunCheckpointView | null;
  branch: string | null;
  // The commit handed to the source repository (the `handoff:fetch` step); null until then.
  commit: string | null;
  // Whether every final evidence row was taken on a clean tree; null without evidence.
  clean: boolean | null;
  evidence: RunEvidenceView[];
  gates: RunGateView[];
  openDecisions: number;
  budgets: RunBudgetView[];
  references: RunReferenceView[];
  interrupted?: RunInterrupted;
  // Appended in Phase 3 (optional keys: every key above keeps its name, order and value, and a reader of Phase 2 output ignores these). The
  // read model always fills the three of them; a view built by hand may leave them out.
  items?: RunItemView[];
  decisions?: RunDecisionView[];
  notifications?: RunNotificationView;
  // Present only when the owner asked for the run to be cancelled and the request still stands.
  cancelRequestedAt?: string;
  // Appended under the frozen-shapes rule (D-35): the declared checks that are neither required nor a target, so the run never runs them. Present only when there is one.
  checksNotRun?: RunCheckNotRunView[];
  // Appended under the frozen-shapes rule (plan 04-20): the references the run recorded that were last refreshed to anything but `fresh`, in the order a resume
  // refreshes them. Present only when there is one.
  staleReferences?: RunStaleReferenceView[];
  // Appended under the frozen-shapes rule (plan 04-23; D-12): present, and `true`, only for a run started with `--restricted` (its stored contract says so). A contained run has no
  // such key, so every output a contained run produced before stays byte-identical.
  restricted?: true;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function leaseIsLive(run: RunRow, nowMs: number): boolean {
  return run.leaseHolder !== null && run.leaseExpiresAt !== null && Date.parse(run.leaseExpiresAt) >= nowMs;
}

function lastCheckpointOf(rows: readonly RunCheckpointRow[]): RunCheckpointRow | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i] as RunCheckpointRow;
    if (row.nextAction !== 'none') return row;
  }
  return rows.at(-1) ?? null;
}

// The final evidence of each check: the latest row taken at the `final` phase (the committed revision), else the latest row of that
// name. Kinds other than `check` (the GSD verdict, the test inventory) are not checks and are left out.
function finalEvidence(rows: readonly EvidenceRow[]): EvidenceRow[] {
  const picked = new Map<string, EvidenceRow>();
  for (const row of rows) {
    if (row.kind !== 'check') continue;
    const held = picked.get(row.name);
    const isFinal = row.environment['phase'] === 'final';
    const heldFinal = held !== undefined && held.environment['phase'] === 'final';
    if (held === undefined || isFinal || !heldFinal) picked.set(row.name, row);
  }
  return [...picked.values()];
}

function latestGates(rows: readonly GateResultRow[]): GateResultRow[] {
  const picked = new Map<string, GateResultRow>();
  for (const row of rows) picked.set(row.gate, row);
  return [...picked.values()].sort((a, b) => (a.gate < b.gate ? -1 : a.gate > b.gate ? 1 : 0));
}

function handedOffCommit(steps: readonly RunStepRow[]): string | null {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i] as RunStepRow;
    if (step.step === 'handoff:fetch' && step.status === 'completed' && isObject(step.result) && typeof step.result['commit'] === 'string') return step.result['commit'];
  }
  return null;
}

// What the run was started from, fixed at start: the contract's requirement references (the brief and its digest) and the revision the
// repository conventions were read at. A task reference from a tracker arrives in Phase 3.
function referencesOf(body: unknown): RunReferenceView[] {
  if (!isObject(body)) return [];
  const out: RunReferenceView[] = [];
  const intent = body['intent'];
  const refs = isObject(intent) ? intent['requirementRefs'] : undefined;
  if (Array.isArray(refs)) {
    for (const ref of refs) {
      if (isObject(ref) && typeof ref['kind'] === 'string' && typeof ref['id'] === 'string' && typeof ref['revision'] === 'string') {
        out.push({ kind: ref['kind'], id: ref['id'], revision: ref['revision'] });
      }
    }
  }
  const workspace = body['workspace'];
  if (isObject(workspace) && typeof workspace['conventionsRevision'] === 'string') {
    out.push({ kind: 'conventions', id: '.avarice/config.json', revision: workspace['conventionsRevision'] });
  }
  return out;
}

// Whether a stored contract body says the run is restricted. Read defensively, as the other readers of the body are: anything that is not a compiled contract is not.
function isRestricted(body: unknown): boolean {
  return isObject(body) && body['mode'] === 'restricted';
}

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');

// The declared checks of a stored contract body that the run does not execute (D-35). The body is read defensively, as referencesOf reads it: anything that is not the
// shape of a compiled contract gives an empty list.
export function checksNotRunOf(body: unknown): RunCheckNotRunView[] {
  if (!isObject(body)) return [];
  const execution = body['execution'];
  const verification = body['verification'];
  if (!isObject(execution) || !isObject(verification)) return [];
  const checks = execution['checks'];
  const requiredChecks = verification['requiredChecks'];
  const targetChecks = verification['targetChecks'];
  if (!Array.isArray(checks) || !isStringArray(requiredChecks) || !isStringArray(targetChecks)) return [];
  const names: Array<{ name: string }> = [];
  for (const check of checks) {
    if (!isObject(check) || typeof check['name'] !== 'string') return [];
    names.push({ name: check['name'] });
  }
  return checksNotRun({ execution: { checks: names }, verification: { requiredChecks, targetChecks } } as Pick<RunContract, 'execution' | 'verification'>).map((name) => ({ name, reason: 'not required' as const }));
}

function interruptedOf(run: RunRow, checkpoint: RunCheckpointRow | null, attempts: readonly AttemptRow[], steps: readonly RunStepRow[], nowMs: number): RunInterrupted | undefined {
  if (!isRunResumable(run.state) || leaseIsLive(run, nowMs)) return undefined;
  const open = [...attempts].reverse().find((a) => a.endedAt === null);
  const started = [...steps].reverse().find((s) => s.status === 'started');
  const nextAction = checkpoint === null ? 'unknown' : checkpoint.nextAction;
  // A step the supervisor had begun after its last checkpoint is the one that was in flight; otherwise the checkpoint's action is.
  const step = started !== undefined && (checkpoint === null || started.startedAt >= checkpoint.createdAt) ? started.step : nextAction;
  return {
    state: run.state,
    presentedAs: 'paused',
    reason: run.state === 'verifying' ? 'verification interrupted' : 'supervisor interrupted',
    attemptId: open === undefined ? null : open.attemptId,
    step,
    nextAction,
    resumeCommand: `avarice resume ${run.runId}`,
  };
}

function itemsOf(rows: ReadonlyArray<{ itemId: string; state: string; size: string; model: string; dependsOn: readonly string[]; attempts: number }>): RunItemView[] {
  return rows.map((w) => ({ itemId: w.itemId, state: w.state, size: w.size, model: w.model, dependsOn: [...w.dependsOn], attempts: w.attempts }));
}

function decisionsOfRun(rows: readonly DecisionRow[]): RunDecisionView[] {
  const successorOf = new Map<string, string>();
  for (const d of rows) if (d.supersedes !== null) successorOf.set(d.supersedes, d.decisionId);
  return rows.map((d) => ({ decisionId: d.decisionId, class: d.class, state: d.state, affectedItems: [...d.affectedItems], supersedes: d.supersedes, successor: successorOf.get(d.decisionId) ?? null }));
}

function notificationsOfRun(rows: readonly NotificationRow[]): RunNotificationView {
  const count = (state: NotificationState): number => rows.filter((n) => n.state === state).length;
  const unarrived = rows.filter((n) => n.state !== 'delivered' && n.lastError !== null);
  const latest = unarrived.reduce<NotificationRow | undefined>((best, n) => (best === undefined || n.updatedAt >= best.updatedAt ? n : best), undefined);
  return { delivered: count('delivered'), pending: count('pending'), held: count('held'), failed: count('failed'), lastError: latest === undefined ? null : latest.lastError };
}

// One run's status from the rows the ledger read for it in one batch (loadRunStatusInputs): the rows the per-run reads return.
function statusOf(run: RunRow, inputs: RunStatusInputs, nowMs: number): RunStatus {
  const latest = inputs.checkpoints.at(-1) ?? null;
  const interrupted = interruptedOf(run, latest, inputs.attempts, inputs.steps, nowMs);
  const named = lastCheckpointOf(inputs.checkpoints);
  const evidence = finalEvidence(inputs.evidence);
  const notRun = checksNotRunOf(inputs.contract === null ? null : inputs.contract.body);
  const stale = inputs.taskRefs.filter((r) => r.freshness !== 'fresh').map((r) => ({ provider: r.provider, kind: r.kind, id: r.id, freshness: r.freshness }));

  return {
    runId: run.runId,
    title: run.title,
    state: run.state,
    reason: run.reason,
    lastCheckpoint: named === null ? null : { seq: named.seq, nextAction: named.nextAction, revision: named.revision, at: named.createdAt },
    branch: run.branch,
    commit: handedOffCommit(inputs.steps),
    clean: evidence.length === 0 ? null : evidence.every((e) => e.clean),
    evidence: evidence.map((e) => ({ name: e.name, kind: e.kind, status: e.status, revision: e.revision, clean: e.clean, ...(e.environment['preExisting'] === true ? { preExisting: true as const } : {}) })),
    gates: latestGates(inputs.gateResults).map((g) => ({ gate: g.gate, passed: g.passed, revision: g.revision })),
    openDecisions: inputs.decisions.filter((d) => d.state === 'open').length,
    budgets: inputs.budgets.map((b) => ({ name: b.name, used: b.used, limit: b.limit })),
    references: referencesOf(inputs.contract === null ? null : inputs.contract.body),
    ...(interrupted !== undefined ? { interrupted } : {}),
    items: itemsOf(inputs.workItems),
    decisions: decisionsOfRun(inputs.decisions),
    notifications: notificationsOfRun(inputs.notifications),
    ...(run.cancelRequestedAt !== null ? { cancelRequestedAt: run.cancelRequestedAt } : {}),
    ...(notRun.length > 0 ? { checksNotRun: notRun } : {}),
    ...(stale.length > 0 ? { staleReferences: stale } : {}),
    ...(isRestricted(inputs.contract === null ? null : inputs.contract.body) ? { restricted: true as const } : {}),
  };
}

// Interrupted runs first, then runs blocked on a decision, then the rest. Stable: the order within a rank is the order given (creation
// order from the ledger).
export function orderRuns<T extends { interrupted?: unknown; state: string }>(runs: readonly T[]): T[] {
  const ranked = runs.map((run, index) => ({ run, index, rank: run.interrupted !== undefined ? 0 : run.state === 'blocked_on_decision' ? 1 : 2 }));
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return ranked.map((r) => r.run);
}

// The runs of one project, read-only. A project with no run has an empty list.
export function getRunStatuses(ledger: Ledger, projectId: string, nowMs: number): Result<RunStatus[]> {
  const rows = ledger.listRuns(projectId);
  if (!rows.ok) return rows;
  // Every per-run table is read in one batch, so the cost of status does not grow with a query per run (OPS-5, AC-2).
  const batch = ledger.loadRunStatusInputs(rows.value.map((row) => row.runId));
  if (!batch.ok) return batch;
  const out: RunStatus[] = [];
  for (const row of rows.value) {
    const inputs = batch.value.get(row.runId);
    if (inputs === undefined) return err({ kind: 'internal', cause: `no status inputs were read for run ${row.runId}` });
    out.push(statusOf(row, inputs, nowMs));
  }
  return ok(orderRuns(out));
}

// ---- inbox -------------------------------------------------------------------------------------------

// The delivery state of the banner raised for a decision. `lastError` is a short code and appears only when a delivery failed.
export interface InboxNotification {
  state: NotificationState;
  attempts: number;
  lastError?: string;
}

export interface InboxDecision {
  decisionId: string;
  runId: string;
  class: string;
  urgency: DecisionUrgency;
  openedAt: string;
  issue: string;
  // Appended in Phase 3: the items the decision holds up, the answers it accepts, the command that answers it and, when a banner was
  // raised for it, whether that banner arrived. A banner that did not arrive never hides the decision.
  items: string[];
  options: DecisionOption[];
  command: string;
  notification?: InboxNotification;
}

export interface InboxReview {
  runId: string;
  title: string;
  branch: string | null;
  commit: string | null;
  repository: string;
  // Appended under the frozen-shapes rule (D-35): the declared checks the run does not execute because they are neither required nor a target. Present only when there is one.
  checksNotRun?: RunCheckNotRunView[];
}

export interface InboxView {
  decisions: InboxDecision[];
  reviews: InboxReview[];
}

// The command that answers a decision. A decision whose every option is withdraw is answered by an amendment (its stored command), and the
// owner can still take it back with `withdraw`.
function answerCommandOf(d: DecisionRow): string {
  if (isAmendOnly(d.options)) return amendCommandOf(d.consequences, d.decisionId) ?? `avarice decide ${d.decisionId} withdraw`;
  return `avarice decide ${d.decisionId} <option-key>`;
}

// A failed delivery outranks a held or pending one and those outrank a delivered one, so a banner that did not arrive is never covered by
// another destination's success; ties go to the latest row.
const NOTIFICATION_RANK: Readonly<Record<NotificationState, number>> = { failed: 3, held: 2, pending: 1, delivered: 0 };

function notificationOfDecision(rows: readonly NotificationRow[], decisionId: string): InboxNotification | undefined {
  let best: NotificationRow | undefined;
  for (const row of rows) {
    if (row.kind !== 'decisions' || !row.subjectIds.includes(decisionId)) continue;
    if (best === undefined || NOTIFICATION_RANK[row.state] > NOTIFICATION_RANK[best.state] || (NOTIFICATION_RANK[row.state] === NOTIFICATION_RANK[best.state] && row.updatedAt >= best.updatedAt)) best = row;
  }
  if (best === undefined) return undefined;
  return { state: best.state, attempts: best.attempts, ...(best.state !== 'delivered' && best.lastError !== null ? { lastError: best.lastError } : {}) };
}

// Open decisions and the runs that wait for a review. Read-only. Blocking decisions come before digest ones, the oldest first.
export function getInbox(ledger: Ledger): Result<InboxView> {
  const runs = ledger.listRuns();
  if (!runs.ok) return runs;
  const projects = ledger.listProjects();
  if (!projects.ok) return projects;
  const repoOf = new Map(projects.value.map((p) => [p.projectId, p.repoPath]));
  const runIds = new Set(runs.value.map((r) => r.runId));

  const open = ledger.listDecisions({ state: 'open' });
  if (!open.ok) return open;
  const banners = ledger.listNotifications();
  if (!banners.ok) return banners;
  const decisions: InboxDecision[] = open.value
    .filter((d) => runIds.has(d.runId))
    .map((d) => {
      const notification = notificationOfDecision(banners.value, d.decisionId);
      return {
        decisionId: d.decisionId,
        runId: d.runId,
        class: d.class,
        urgency: d.urgency,
        openedAt: d.openedAt,
        issue: d.issue,
        items: [...d.affectedItems],
        options: optionsOf(d.options),
        command: answerCommandOf(d),
        ...(notification !== undefined ? { notification } : {}),
      };
    });
  decisions.sort((a, b) => (a.urgency === b.urgency ? 0 : a.urgency === 'blocking' ? -1 : 1));

  const reviews: InboxReview[] = [];
  for (const run of runs.value) {
    if (run.state !== 'ready_for_review' && run.state !== 'awaiting_review') continue;
    const steps = ledger.getRunSteps(run.runId);
    if (!steps.ok) return steps;
    const contract = ledger.getRunContract(run.runId);
    if (!contract.ok) return contract;
    const notRun = checksNotRunOf(contract.value === null ? null : contract.value.body);
    reviews.push({
      runId: run.runId,
      title: run.title,
      branch: run.branch,
      commit: handedOffCommit(steps.value),
      repository: repoOf.get(run.projectId) ?? '',
      ...(notRun.length > 0 ? { checksNotRun: notRun } : {}),
    });
  }
  return ok({ decisions, reviews });
}
