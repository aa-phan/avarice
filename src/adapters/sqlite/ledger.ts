// SqliteLedger: the onboarding subset of the Ledger port over node:sqlite (SKELETON.md "Ports").
// Reads never take a lease. Every writer runs in one BEGIN IMMEDIATE transaction (tx), so the state
// change, its checkpoint and its event commit together or not at all (NFR-6, NFR-9). Optimistic
// concurrency: a transition presents the row version and the lease fence it last saw.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { IdPrefix } from '../../domain/ids.ts';
import { canonicalJson, digestOf } from '../../domain/digest.ts';
import { assertTransition, NEXT_ACTIONS } from '../../domain/onboarding-lifecycle.ts';
import type { OnboardingState } from '../../domain/onboarding-lifecycle.ts';
import { assertItemTransition, assertRunTransition, RUN_BLOCKED_REASONS, RUN_STEP_STATUSES } from '../../domain/run-lifecycle.ts';
import type { RunState, WorkItemState } from '../../domain/run-lifecycle.ts';
import type {
  ActivateInput,
  ActivationResult,
  ActiveRecord,
  AnswerDecisionInput,
  AdapterConfigInput,
  ArtifactInput,
  BudgetCharge,
  BudgetReservation,
  BudgetRow,
  BudgetRowInput,
  AttemptInput,
  AttemptRow,
  CheckValidationInput,
  CheckValidationRow,
  CheckpointInput,
  CheckpointRow,
  ContractRow,
  CreatedRun,
  CreateRunWithContractInput,
  DecisionInput,
  DecisionRow,
  DecisionState,
  EventInput,
  EventReceipt,
  EvidenceIndependence,
  EvidenceInput,
  EvidenceRow,
  EvidenceStatus,
  GateResultInput,
  GateResultRow,
  HookReadRow,
  RunEventRow,
  Ledger,
  LeaseGrant,
  NewOnboarding,
  NewProject,
  NewRun,
  OnboardingRow,
  ProjectQuery,
  ProjectRow,
  RunAttemptInput,
  RunCheckpointInput,
  RunCheckpointRow,
  RunRow,
  ReopenStaleDecisionInput,
  RunStepRow,
  RunTransitionInput,
  StepResultInput,
  StepResultRow,
  StoreContractInput,
  StoreRunContractInput,
  TransitionGuard,
  TransitionInput,
  WithdrawDecisionInput,
  WorkItemInput,
  WorkItemRow,
  WorkItemTransitionInput,
} from '../../ports/ledger.ts';
import { abort, LedgerAbort, toPortError, tx } from './db.ts';
import { appendEventRow, EventDataError } from './events.ts';
import type { Db } from './db.ts';

type Row = Record<string, unknown>;

function guarded<T>(fn: () => T): Result<T> {
  try {
    return ok(fn());
  } catch (e) {
    return err(toPortError(e));
  }
}

function str(v: unknown): string {
  return String(v);
}

function strOrNull(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

function parseJson(v: unknown): unknown {
  return JSON.parse(String(v));
}

const MAX_BODY_BYTES = 1024 * 1024;
const NO_NEXT_ACTION = 'none';

// The closed value sets of docs/contracts-and-state.md "Evidence schema" and "Decision records". The adapter refuses
// any other value, so a typo cannot reach an evidence or decision row (AUT-8).
const EVIDENCE_STATUS_SET: readonly EvidenceStatus[] = ['passed', 'failed', 'skipped', 'unavailable', 'inconclusive', 'stale'];
const EVIDENCE_INDEPENDENCE_SET: readonly EvidenceIndependence[] = ['deterministic', 'external', 'model-review'];
const DECISION_CLASSES: readonly string[] = ['acceptance', 'architecture', 'scope_expansion', 'permission', 'repeated_failure', 'equivalent_mutant', 'contradiction', 'budget'];
const DECISION_STATES: readonly DecisionState[] = ['open', 'answered', 'stale', 'withdrawn'];

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

// Stored documents (records, contracts) hold structure, paths and digests, never document text.
function boundedBodyJson(body: unknown, field: string): string {
  const json = canonicalJson(body);
  if (Buffer.byteLength(json) > MAX_BODY_BYTES) {
    abort({ kind: 'invalid', field, reason: `a stored ${field} is limited to ${MAX_BODY_BYTES} bytes; document text belongs in the artifact store` });
  }
  return json;
}

function at(value: unknown, ...path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function optionalString(value: unknown, ...path: string[]): string | null {
  const v = at(value, ...path);
  return typeof v === 'string' ? v : null;
}

function requiredString(value: unknown, ...path: string[]): string {
  const v = optionalString(value, ...path);
  if (v === null) abort({ kind: 'invalid', field: path.join('.'), reason: 'the project record must carry this string' });
  return v;
}

interface EventRow {
  type: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  runId?: string;
  attemptId?: string;
  invocationId?: string;
  data: unknown;
  nowMs: number;
}

// Where a lease lives: the table, its key column, and the reader that finds (and, for runs, vets) the row.
interface LeaseTarget {
  readonly table: 'onboardings' | 'runs';
  readonly key: 'onboarding_id' | 'run_id';
  readonly lock: (id: string) => Row;
}

export class SqliteLedger implements Ledger {
  readonly db: Db;
  readonly newId: (prefix: IdPrefix) => string;

  constructor(db: Db, newId: (prefix: IdPrefix) => string) {
    this.db = db;
    this.newId = newId;
  }

  // ---- reads -------------------------------------------------------------------------------------

  listProjects(): Result<ProjectRow[]> {
    return guarded(() => (this.db.prepare('SELECT * FROM projects ORDER BY created_at, rowid').all() as Row[]).map(toProject));
  }

  listOnboardings(projectId?: string): Result<OnboardingRow[]> {
    return guarded(() => {
      const rows = (
        projectId === undefined
          ? this.db.prepare('SELECT * FROM onboardings ORDER BY created_at, rowid').all()
          : this.db.prepare('SELECT * FROM onboardings WHERE project_id = ? ORDER BY created_at, rowid').all(projectId)
      ) as Row[];
      return rows.map((r) => this.toOnboarding(r));
    });
  }

  getOnboarding(onboardingId: string): Result<OnboardingRow> {
    return guarded(() => {
      const row = this.db.prepare('SELECT * FROM onboardings WHERE onboarding_id = ?').get(onboardingId) as Row | undefined;
      if (!row) throw notFound(`onboarding ${onboardingId}`);
      return this.toOnboarding(row);
    });
  }

  getActiveRecord(projectId: string): Result<ActiveRecord | null> {
    return guarded(() => {
      const row = this.db
        .prepare("SELECT * FROM project_records WHERE project_id = ? AND state = 'active' AND superseded_at IS NULL ORDER BY version DESC LIMIT 1")
        .get(projectId) as Row | undefined;
      return row ? toActiveRecord(row) : null;
    });
  }

  latestCheckpoint(onboardingId: string): Result<CheckpointRow | null> {
    return guarded(() => {
      const o = this.db.prepare('SELECT onboarding_id, contract_run_id FROM onboardings WHERE onboarding_id = ?').get(onboardingId) as Row | undefined;
      if (!o) throw notFound(`onboarding ${onboardingId}`);
      const runId = strOrNull(o['contract_run_id']) ?? onboardingId;
      const row = this.db
        .prepare('SELECT * FROM checkpoints WHERE run_id IN (?, ?) ORDER BY seq DESC, rowid DESC LIMIT 1')
        .get(onboardingId, runId) as Row | undefined;
      return row ? toCheckpoint(row) : null;
    });
  }

  private toOnboarding(r: Row): OnboardingRow {
    const id = str(r['onboarding_id']);
    const last = this.db
      .prepare("SELECT data_json FROM events WHERE type = 'onboarding.transition' AND json_extract(data_json, '$.onboardingId') = ? ORDER BY seq DESC LIMIT 1")
      .get(id) as Row | undefined;
    const reason = last ? (parseJson(last['data_json']) as { reason?: unknown }).reason : undefined;
    return {
      onboardingId: id,
      projectId: str(r['project_id']),
      state: str(r['state']) as OnboardingState,
      version: Number(r['version']),
      stagingWorktree: strOrNull(r['staging_worktree']),
      contractRunId: strOrNull(r['contract_run_id']),
      preflight: parseJson(r['preflight_json']),
      reason: typeof reason === 'string' ? (reason as OnboardingRow['reason']) : null,
      createdAt: str(r['created_at']),
      updatedAt: str(r['updated_at']),
      leaseHolder: strOrNull(r['lease_holder']),
      leaseExpiresAt: strOrNull(r['lease_expires_at']),
      leaseFence: Number(r['lease_fence']),
    };
  }

  // ---- registration ------------------------------------------------------------------------------

  findProject(query: ProjectQuery): Result<ProjectRow | null> {
    return guarded(() => {
      const row = (
        'projectId' in query
          ? this.db.prepare('SELECT * FROM projects WHERE project_id = ?').get(query.projectId)
          : this.db.prepare('SELECT * FROM projects WHERE root_commit = ? AND repo_path = ?').get(query.rootCommit, query.repoPath)
      ) as Row | undefined;
      return row ? toProject(row) : null;
    });
  }

  registerProject(input: NewProject): Result<ProjectRow> {
    return tx(this.db, () => {
      const existing = this.db.prepare('SELECT * FROM projects WHERE root_commit = ? AND repo_path = ?').get(input.rootCommit, input.repoPath) as Row | undefined;
      if (existing) return toProject(existing);
      this.db
        .prepare('INSERT INTO projects (project_id, root_commit, repo_path, remote, default_branch, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(input.projectId, input.rootCommit, input.repoPath, input.remote ?? null, input.defaultBranch ?? null, iso(input.nowMs));
      return toProject(this.db.prepare('SELECT * FROM projects WHERE project_id = ?').get(input.projectId) as Row);
    });
  }

  createOnboarding(input: NewOnboarding): Result<OnboardingRow> {
    return tx(this.db, () => {
      if (!this.db.prepare('SELECT 1 AS found FROM projects WHERE project_id = ?').get(input.projectId)) throw notFound(`project ${input.projectId}`);
      const now = iso(input.nowMs);
      const first = NEXT_ACTIONS.discovered?.[0] ?? NO_NEXT_ACTION;
      this.db
        .prepare("INSERT INTO onboardings (onboarding_id, project_id, state, version, preflight_json, created_at, updated_at) VALUES (?, ?, 'discovered', 1, ?, ?, ?)")
        .run(input.onboardingId, input.projectId, canonicalJson(input.preflight), now, now);
      const checkpoint = this.insertCheckpoint(input.onboardingId, input.onboardingId, 'unregistered', 'discovered', first, null, input.nowMs);
      this.insertEvent({
        type: 'onboarding.transition',
        runId: input.onboardingId,
        data: { onboardingId: input.onboardingId, projectId: input.projectId, from: 'unregistered', to: 'discovered', version: 1, nextAction: first, checkpointId: checkpoint.checkpointId },
        nowMs: input.nowMs,
      });
      return this.readOnboarding(input.onboardingId);
    });
  }

  // ---- leases ------------------------------------------------------------------------------------

  // One UPDATE decides the race: it takes a free lease, or one whose expiry instant has passed, and
  // bumps the fence so the previous holder's next transition fails. Zero changed rows means a live holder.
  acquireLease(onboardingId: string, holder: string, ttlMs: number, nowMs: number): Result<LeaseGrant> {
    return this.acquireLeaseOn(this.onboardingLease, onboardingId, holder, ttlMs, nowMs);
  }

  renewLease(onboardingId: string, holder: string, fence: number, ttlMs: number, nowMs: number): Result<LeaseGrant> {
    return this.renewLeaseOn(this.onboardingLease, onboardingId, holder, fence, ttlMs, nowMs);
  }

  releaseLease(onboardingId: string, holder: string, fence: number): Result<void> {
    return this.releaseLeaseOn(this.onboardingLease, onboardingId, holder, fence);
  }

  // The lease SQL is written once and parameterized by table and key column. Both are literals chosen below (never input),
  // so building the statement from them cannot be steered by a caller.
  private readonly onboardingLease: LeaseTarget = { table: 'onboardings', key: 'onboarding_id', lock: (id) => this.lockRow(id) };
  private readonly runLease: LeaseTarget = { table: 'runs', key: 'run_id', lock: (id) => this.lockRun(id) };

  // One UPDATE decides the race: it takes a free lease, or one whose expiry instant has passed, and bumps the fence
  // so the previous holder's next transition fails. Zero changed rows means a live holder.
  private acquireLeaseOn(t: LeaseTarget, id: string, holder: string, ttlMs: number, nowMs: number): Result<LeaseGrant> {
    return tx(this.db, () => {
      const expiresAt = iso(nowMs + ttlMs);
      // The row must exist (and be of the right kind) before the UPDATE can say anything about it.
      t.lock(id);
      const changed = this.db
        .prepare(
          `UPDATE ${t.table} SET lease_holder = ?, lease_expires_at = ?, lease_fence = lease_fence + 1 WHERE ${t.key} = ? AND (lease_holder IS NULL OR lease_expires_at < ?)`,
        )
        .run(holder, expiresAt, id, iso(nowMs)).changes;
      const row = t.lock(id);
      if (Number(changed) === 0) {
        abort({ kind: 'conflict', expected: 'a free or expired lease', actual: `held by ${str(row['lease_holder'])} until ${str(row['lease_expires_at'])}` });
      }
      return { fence: Number(row['lease_fence']), expiresAt };
    });
  }

  private renewLeaseOn(t: LeaseTarget, id: string, holder: string, fence: number, ttlMs: number, nowMs: number): Result<LeaseGrant> {
    return tx(this.db, () => {
      const expiresAt = iso(nowMs + ttlMs);
      t.lock(id);
      const changed = this.db
        .prepare(`UPDATE ${t.table} SET lease_expires_at = ? WHERE ${t.key} = ? AND lease_holder = ? AND lease_fence = ?`)
        .run(expiresAt, id, holder, fence).changes;
      if (Number(changed) === 0) this.leaseConflict(t, id, holder, fence);
      return { fence, expiresAt };
    });
  }

  private releaseLeaseOn(t: LeaseTarget, id: string, holder: string, fence: number): Result<void> {
    return tx(this.db, () => {
      t.lock(id);
      const changed = this.db
        .prepare(`UPDATE ${t.table} SET lease_holder = NULL, lease_expires_at = NULL WHERE ${t.key} = ? AND lease_holder = ? AND lease_fence = ?`)
        .run(id, holder, fence).changes;
      if (Number(changed) === 0) this.leaseConflict(t, id, holder, fence);
    });
  }

  private leaseConflict(t: LeaseTarget, id: string, holder: string, fence: number): never {
    const row = t.lock(id);
    return abort({
      kind: 'conflict',
      expected: `lease held by ${holder} at fence ${fence}`,
      actual: `held by ${strOrNull(row['lease_holder']) ?? 'nobody'} at fence ${Number(row['lease_fence'])}`,
    });
  }

  // ---- transitions and checkpoints ----------------------------------------------------------------

  transitionOnboarding(onboardingId: string, guard: TransitionGuard, t: TransitionInput): Result<OnboardingRow> {
    return tx(this.db, () => {
      const row = this.lockRow(onboardingId);
      this.checkVersion(row, guard.version);
      this.checkFence(row, guard.fence);
      const from = str(row['state']) as OnboardingState;
      this.applyTransition(row, from, t.to, t.nextAction, t, t.data ?? {});
      return this.readOnboarding(onboardingId);
    });
  }

  recordCheckpoint(onboardingId: string, guard: { fence: number }, input: CheckpointInput): Result<CheckpointRow> {
    return tx(this.db, () => {
      const row = this.lockRow(onboardingId);
      this.checkFence(row, guard.fence);
      const state = str(row['state']) as OnboardingState;
      const runId = strOrNull(row['contract_run_id']) ?? onboardingId;
      const checkpoint = this.insertCheckpoint(onboardingId, runId, state, state, input.nextAction, input.revision ?? null, input.nowMs);
      this.db
        .prepare('UPDATE onboardings SET updated_at = ?, staging_worktree = COALESCE(?, staging_worktree) WHERE onboarding_id = ?')
        .run(iso(input.nowMs), input.stagingWorktree ?? null, onboardingId);
      this.insertEvent({
        type: 'onboarding.checkpoint',
        runId,
        data: { onboardingId, state, nextAction: input.nextAction, seq: checkpoint.seq, checkpointId: checkpoint.checkpointId },
        nowMs: input.nowMs,
      });
      return checkpoint;
    });
  }

  // Shared by transitionOnboarding and insertRecordAndActivate: validates the edge, updates the row,
  // writes the checkpoint and the event. Runs inside the caller's transaction.
  private applyTransition(
    row: Row,
    from: OnboardingState,
    to: OnboardingState,
    nextAction: string,
    t: { nowMs: number; reason?: TransitionInput['reason']; revision?: string; stagingWorktree?: string },
    extra: Readonly<Record<string, unknown>>,
  ): void {
    const edge = assertTransition(from, to);
    if (!edge.ok) abort(edge.error);
    if (to === 'blocked' && t.reason === undefined) abort({ kind: 'invalid', field: 'reason', reason: 'a transition to blocked needs a blocked reason' });
    if (t.reason !== undefined && to !== 'blocked' && to !== 'incompatible') {
      abort({ kind: 'invalid', field: 'reason', reason: `a reason is only recorded for blocked or incompatible, not ${to}` });
    }
    const onboardingId = str(row['onboarding_id']);
    const version = Number(row['version']) + 1;
    const runId = strOrNull(row['contract_run_id']) ?? onboardingId;
    this.db
      .prepare('UPDATE onboardings SET state = ?, version = ?, updated_at = ?, staging_worktree = COALESCE(?, staging_worktree) WHERE onboarding_id = ?')
      .run(to, version, iso(t.nowMs), t.stagingWorktree ?? null, onboardingId);
    const checkpoint = this.insertCheckpoint(onboardingId, runId, from, to, nextAction, t.revision ?? null, t.nowMs);
    this.insertEvent({
      type: 'onboarding.transition',
      runId,
      data: {
        ...extra,
        onboardingId,
        from,
        to,
        version,
        nextAction,
        checkpointId: checkpoint.checkpointId,
        ...(t.reason !== undefined ? { reason: t.reason } : {}),
      },
      nowMs: t.nowMs,
    });
  }

  private lockRow(onboardingId: string): Row {
    const row = this.db.prepare('SELECT * FROM onboardings WHERE onboarding_id = ?').get(onboardingId) as Row | undefined;
    if (!row) throw notFound(`onboarding ${onboardingId}`);
    return row;
  }

  private readOnboarding(onboardingId: string): OnboardingRow {
    return this.toOnboarding(this.lockRow(onboardingId));
  }

  private checkVersion(row: Row, version: number, label: 'onboarding' | 'run' = 'onboarding'): void {
    if (Number(row['version']) !== version) {
      abort({ kind: 'conflict', expected: `${label} version ${version}`, actual: `${label} version ${Number(row['version'])}` });
    }
  }

  private checkFence(row: Row, fence: number): void {
    if (Number(row['lease_fence']) !== fence) {
      abort({ kind: 'conflict', expected: `lease fence ${fence}`, actual: `lease fence ${Number(row['lease_fence'])}` });
    }
  }

  // The checkpoint sequence is continuous across the onboarding ID and its contract run ID, so the
  // latest checkpoint is simply the highest seq.
  private insertCheckpoint(
    onboardingId: string,
    runId: string,
    from: OnboardingState | null,
    to: OnboardingState,
    nextAction: string,
    revision: string | null,
    nowMs: number,
  ): CheckpointRow {
    const contractRun = this.db.prepare('SELECT contract_run_id FROM onboardings WHERE onboarding_id = ?').get(onboardingId) as Row | undefined;
    const other = strOrNull(contractRun?.['contract_run_id']) ?? onboardingId;
    return toCheckpoint(this.writeCheckpoint([onboardingId, other, runId], { runId, from, to, revision, nextAction, nowMs }));
  }

  // The one checkpoint writer for onboardings and runs. The sequence is max + 1 over every run ID of `scope` (an onboarding
  // shares one sequence between its own ID and its carrier run ID; a run's scope is itself), so seq is continuous per scope.
  private writeCheckpoint(
    scope: readonly string[],
    c: { runId: string; attemptId?: string | null; itemId?: string | null; from: string | null; to: string; revision: string | null; nextAction: string; nowMs: number },
  ): Row {
    const marks = scope.map(() => '?').join(', ');
    const next = this.db.prepare(`SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM checkpoints WHERE run_id IN (${marks})`).get(...scope) as { next: number };
    const checkpointId = this.newId('ckp_');
    this.db
      .prepare('INSERT INTO checkpoints (checkpoint_id, run_id, attempt_id, seq, item_id, from_state, to_state, revision, next_action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(checkpointId, c.runId, c.attemptId ?? null, Number(next.next), c.itemId ?? null, c.from, c.to, c.revision, c.nextAction, iso(c.nowMs));
    return this.db.prepare('SELECT * FROM checkpoints WHERE checkpoint_id = ?').get(checkpointId) as Row;
  }

  // ---- contracts, steps, attempts ------------------------------------------------------------------

  storeContract(onboardingId: string, guard: { fence: number }, input: StoreContractInput): Result<ContractRow> {
    return tx(this.db, () => {
      const row = this.lockRow(onboardingId);
      this.checkFence(row, guard.fence);
      if (row['contract_run_id'] !== null) abort({ kind: 'conflict', expected: 'no stored contract', actual: `contract run ${str(row['contract_run_id'])}` });
      const bodyJson = boundedBodyJson(input.body, 'contract');
      const now = iso(input.nowMs);
      const version = input.version ?? 1;
      this.db
        .prepare("INSERT INTO runs (run_id, project_id, state, version, title, created_at, updated_at) VALUES (?, ?, 'onboarding', 1, ?, ?, ?)")
        .run(input.runId, str(row['project_id']), `onboarding ${onboardingId}`, now, now);
      this.db
        .prepare('INSERT INTO contracts (run_id, version, digest, body_json, policy_revision, authorized_by, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(input.runId, version, input.digest, bodyJson, input.policyRevision, input.authorizedBy, input.reason ?? null, now);
      this.db.prepare('UPDATE onboardings SET contract_run_id = ?, updated_at = ? WHERE onboarding_id = ?').run(input.runId, now, onboardingId);
      if (input.budgets !== undefined) this.insertBudgets(input.runId, version, input.budgets);
      this.insertEvent({ type: 'contract.stored', runId: input.runId, data: { onboardingId, runId: input.runId, version, digest: input.digest }, nowMs: input.nowMs });
      return toContract(this.db.prepare('SELECT * FROM contracts WHERE run_id = ? AND version = ?').get(input.runId, version) as Row);
    });
  }

  getContract(onboardingId: string): Result<ContractRow | null> {
    return guarded(() => {
      const row = this.lockRow(onboardingId);
      const runId = strOrNull(row['contract_run_id']);
      if (runId === null) return null;
      const contract = this.db.prepare('SELECT * FROM contracts WHERE run_id = ? ORDER BY version DESC LIMIT 1').get(runId) as Row | undefined;
      return contract ? toContract(contract) : null;
    });
  }

  recordStepResult(onboardingId: string, input: StepResultInput): Result<StepResultRow> {
    return tx(this.db, () => {
      this.lockRow(onboardingId);
      const attempt = input.attempt ?? 1;
      this.db
        .prepare(
          `INSERT INTO onboarding_steps (onboarding_id, step, attempt, status, result_json, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (onboarding_id, step, attempt) DO UPDATE SET status = excluded.status, result_json = excluded.result_json, started_at = excluded.started_at, completed_at = excluded.completed_at`,
        )
        .run(onboardingId, input.step, attempt, input.status, boundedBodyJson(input.result, 'step result'), iso(input.nowMs), input.completedAtMs === undefined ? null : iso(input.completedAtMs));
      return toStep(this.db.prepare('SELECT * FROM onboarding_steps WHERE onboarding_id = ? AND step = ? AND attempt = ?').get(onboardingId, input.step, attempt) as Row);
    });
  }

  getStepResults(onboardingId: string): Result<StepResultRow[]> {
    return guarded(() => {
      this.lockRow(onboardingId);
      return (this.db.prepare('SELECT * FROM onboarding_steps WHERE onboarding_id = ? ORDER BY rowid').all(onboardingId) as Row[]).map(toStep);
    });
  }

  recordAttempt(onboardingId: string, input: AttemptInput): Result<AttemptRow> {
    return tx(this.db, () => {
      const row = this.lockRow(onboardingId);
      const runId = strOrNull(row['contract_run_id']);
      if (runId === null) abort({ kind: 'invalid', field: 'contract', reason: 'attempts hang off the carrier run, so store the contract first' });
      const next = this.db.prepare('SELECT COALESCE(MAX(ordinal), 0) + 1 AS next FROM attempts WHERE run_id = ?').get(runId) as { next: number };
      const attemptId = this.newId('att_');
      this.db
        .prepare('INSERT INTO attempts (attempt_id, run_id, ordinal, reason, started_at, ended_at, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(attemptId, runId, Number(next.next), input.reason, iso(input.nowMs), input.endedAtMs === undefined ? null : iso(input.endedAtMs), input.outcome ?? null);
      return toAttempt(this.db.prepare('SELECT * FROM attempts WHERE attempt_id = ?').get(attemptId) as Row);
    });
  }

  listAttempts(onboardingId: string): Result<AttemptRow[]> {
    return guarded(() => {
      const runId = strOrNull(this.lockRow(onboardingId)['contract_run_id']);
      if (runId === null) return [];
      return (this.db.prepare('SELECT * FROM attempts WHERE run_id = ? ORDER BY ordinal').all(runId) as Row[]).map(toAttempt);
    });
  }

  // ---- records ------------------------------------------------------------------------------------

  insertRecordAndActivate(onboardingId: string, guard: TransitionGuard, input: ActivateInput): Result<ActivationResult> {
    return tx(this.db, () => {
      const row = this.lockRow(onboardingId);
      this.checkVersion(row, guard.version);
      this.checkFence(row, guard.fence);
      const from = str(row['state']) as OnboardingState;
      const edge = assertTransition(from, 'active');
      if (!edge.ok) abort(edge.error);

      const projectId = str(row['project_id']);
      const body = input.body;
      const bodyProject = optionalString(body, 'projectId');
      if (bodyProject !== null && bodyProject !== projectId) {
        abort({ kind: 'invalid', field: 'projectId', reason: `the record is for ${bodyProject}, the onboarding is for ${projectId}` });
      }
      const onboardedRevision = requiredString(body, 'revisions', 'onboardedAt');
      const gsdVersion = requiredString(body, 'gsd', 'version');
      const bodyJson = boundedBodyJson(body, 'project record');
      const digest = digestOf(body);
      const max = this.db.prepare('SELECT COALESCE(MAX(version), 0) AS max FROM project_records WHERE project_id = ?').get(projectId) as { max: number };
      const version = Number(max.max) + 1;
      const declared = at(body, 'recordVersion');
      if (declared !== undefined && declared !== version) {
        abort({ kind: 'conflict', expected: `recordVersion ${version}`, actual: `recordVersion ${String(declared)}` });
      }

      const now = iso(input.nowMs);
      this.db.prepare("UPDATE project_records SET superseded_at = ? WHERE project_id = ? AND state = 'active' AND superseded_at IS NULL").run(now, projectId);
      const scope = at(body, 'mapping', 'scope');
      this.db
        .prepare(
          `INSERT INTO project_records (project_id, version, state, body_json, digest, gsd_version, onboarded_revision, mapping_mode, mapping_scope_json, completeness,
                                        intel_commit, graph_commit, knowledge_commit, created_at, activated_at, superseded_at)
           VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          projectId,
          version,
          bodyJson,
          digest,
          gsdVersion,
          onboardedRevision,
          optionalString(body, 'mapping', 'mode'),
          scope === undefined ? null : canonicalJson(scope),
          optionalString(body, 'mapping', 'completeness'),
          optionalString(body, 'indexes', 'intel', 'refreshedAtCommit'),
          optionalString(body, 'indexes', 'graph', 'builtAtCommit'),
          optionalString(body, 'indexes', 'graph', 'knowledge', 'documentsCommit'),
          now,
          now,
        );
      this.applyTransition(row, from, 'active', NO_NEXT_ACTION, { nowMs: input.nowMs }, { recordVersion: version, digest });
      return { recordVersion: version, digest };
    });
  }

  // ---- events, artifacts, adapter configs -----------------------------------------------------------

  appendEvent(input: EventInput): Result<EventReceipt> {
    return tx(this.db, () => this.insertEvent(input));
  }

  listRunEvents(runId: string, limit: number): Result<RunEventRow[]> {
    return guarded(() => {
      const rows = this.db.prepare('SELECT seq, ts, level, type, data_json FROM events WHERE run_id = ? ORDER BY seq DESC LIMIT ?').all(runId, Math.max(0, Math.floor(limit))) as Row[];
      return rows.reverse().map(toRunEvent);
    });
  }

  // The caller's transaction must be open. Appends one row to the hash chain (events.ts).
  private insertEvent(ev: EventRow): EventReceipt {
    try {
      return appendEventRow(this.db, ev);
    } catch (e) {
      if (e instanceof EventDataError) abort({ kind: 'invalid', field: e.field, reason: e.reason });
      throw e;
    }
  }

  // ---- budgets --------------------------------------------------------------------------------------

  // Creates the rows that do not exist yet and leaves existing ones alone, so a retry or a resume can never
  // reset a counter or raise a limit (RC-5, ONB-8). Returns every row of the run.
  createBudgets(runId: string, contractVersion: number, rows: readonly BudgetRowInput[]): Result<BudgetRow[]> {
    return tx(this.db, () => {
      this.insertBudgets(runId, contractVersion, rows);
      return this.readBudgets(runId);
    });
  }

  private insertBudgets(runId: string, contractVersion: number, rows: readonly BudgetRowInput[]): void {
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO budgets (run_id, name, limit_value, used, reserved, exactness, contract_version) VALUES (?, ?, ?, 0, 0, ?, ?)',
    );
    for (const row of rows) {
      if (row.name === '') abort({ kind: 'invalid', field: 'budget.name', reason: 'a budget needs a name' });
      if (!Number.isFinite(row.limit) || row.limit < 0) abort({ kind: 'invalid', field: `budget.${row.name}`, reason: 'a budget limit is a finite non-negative number' });
      insert.run(runId, row.name, row.limit, row.exactness, contractVersion);
    }
  }

  private readBudgets(runId: string): BudgetRow[] {
    return (this.db.prepare('SELECT * FROM budgets WHERE run_id = ? ORDER BY name').all(runId) as Row[]).map(toBudget);
  }

  private readBudget(runId: string, name: string): BudgetRow {
    const row = this.db.prepare('SELECT * FROM budgets WHERE run_id = ? AND name = ?').get(runId, name) as Row | undefined;
    if (!row) throw notFound(`budget ${name} of ${runId}`);
    return toBudget(row);
  }

  // The spec's single conditional UPDATE: it changes one row only while the reservation still fits.
  reserveBudget(runId: string, name: string, amount: number): Result<BudgetReservation> {
    return tx(this.db, () => {
      checkAmount(amount);
      const changed = this.db
        .prepare('UPDATE budgets SET reserved = reserved + ? WHERE run_id = ? AND name = ? AND used + reserved + ? <= limit_value')
        .run(amount, runId, name, amount).changes;
      return { granted: Number(changed) > 0, budget: this.readBudget(runId, name) };
    });
  }

  chargeBudget(runId: string, name: string, amount: number, options: { fromReserved: boolean }): Result<BudgetRow> {
    return tx(this.db, () => this.applyCharge(runId, name, amount, options));
  }

  // The charges and the event are written in one transaction: a failure at any of them (a conflict, the store) rolls the others back.
  settleBudgets(runId: string, charges: readonly BudgetCharge[], event?: EventInput): Result<BudgetRow[]> {
    return tx(this.db, () => {
      for (const charge of charges) this.applyCharge(runId, charge.name, charge.amount, { fromReserved: charge.fromReserved });
      if (event !== undefined) this.insertEvent(event);
      return this.readBudgets(runId);
    });
  }

  // chargeBudget's rules, for a caller whose transaction is already open.
  private applyCharge(runId: string, name: string, amount: number, options: { fromReserved: boolean }): BudgetRow {
    checkAmount(amount);
    this.readBudget(runId, name);
    if (options.fromReserved) {
      const changed = this.db
        .prepare('UPDATE budgets SET reserved = reserved - ?, used = used + ? WHERE run_id = ? AND name = ? AND reserved >= ?')
        .run(amount, amount, runId, name, amount).changes;
      if (Number(changed) === 0) abort({ kind: 'conflict', expected: `a reservation of at least ${amount} on ${name}`, actual: `reserved ${this.readBudget(runId, name).reserved}` });
    } else {
      this.db.prepare('UPDATE budgets SET used = used + ? WHERE run_id = ? AND name = ?').run(amount, runId, name);
    }
    return this.readBudget(runId, name);
  }

  getBudgets(runId: string): Result<BudgetRow[]> {
    return guarded(() => this.readBudgets(runId));
  }

  countBudgetDenials(runId: string, invocationId: string): Result<number> {
    return guarded(() => {
      const row = this.db
        .prepare("SELECT count(*) AS n FROM events WHERE type = 'hook.decision' AND run_id = ? AND invocation_id = ? AND json_extract(data_json, '$.rule') = 'budget_exhausted'")
        .get(runId, invocationId) as { n: number };
      return Number(row.n);
    });
  }

  countHookDenials(invocationId: string): Result<{ total: number; budget: number }> {
    return guarded(() => {
      const row = this.db
        .prepare(
          `SELECT count(*) AS total, coalesce(sum(CASE WHEN json_extract(data_json, '$.rule') = 'budget_exhausted' THEN 1 ELSE 0 END), 0) AS budget
           FROM events WHERE type = 'hook.decision' AND invocation_id = ? AND json_extract(data_json, '$.decision') = 'deny'`,
        )
        .get(invocationId) as { total: number; budget: number };
      return { total: Number(row.total), budget: Number(row.budget) };
    });
  }

  findLoopLimit(invocationId: string): Result<{ reason: string; count: number; limit: number } | null> {
    return guarded(() => {
      const row = this.db.prepare("SELECT data_json FROM events WHERE type = 'loop.limit' AND invocation_id = ? ORDER BY seq LIMIT 1").get(invocationId) as { data_json: string } | undefined;
      if (row === undefined) return null;
      const data = JSON.parse(row.data_json) as Record<string, unknown>;
      return { reason: String(data['reason'] ?? 'unknown'), count: Number(data['count'] ?? 0), limit: Number(data['limit'] ?? 0) };
    });
  }

  recordArtifact(input: ArtifactInput): Result<void> {
    return tx(this.db, () => {
      this.db
        .prepare('INSERT OR IGNORE INTO artifacts (digest, size, kind, run_id, retention, created_at, store) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(input.digest, input.size, input.kind, input.runId ?? null, input.retention, iso(input.nowMs), input.store);
    });
  }

  upsertAdapterConfig(input: AdapterConfigInput): Result<void> {
    return tx(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO adapter_configs (name, port, adapter, config_digest, descriptor_json) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (name) DO UPDATE SET port = excluded.port, adapter = excluded.adapter, config_digest = excluded.config_digest, descriptor_json = excluded.descriptor_json`,
        )
        .run(input.name, input.port, input.adapter, input.configDigest, canonicalJson(input.descriptor));
    });
  }

  // ---- runs ------------------------------------------------------------------------------------------
  // Run methods address `runs` rows whose state is a run state. A Phase 1 carrier row (state `onboarding`) is invisible
  // to them: lockRun reports it as not found, so no run method can read, lease or move an onboarding's carrier.

  createRun(input: NewRun): Result<RunRow> {
    return tx(this.db, () => this.insertRun(input));
  }

  // The caller's transaction must be open.
  private insertRun(input: NewRun): RunRow {
    if (input.runId === '') abort({ kind: 'invalid', field: 'runId', reason: 'a run needs an ID' });
    if (input.title === '') abort({ kind: 'invalid', field: 'title', reason: 'a run needs a title' });
    if (!this.db.prepare('SELECT 1 AS found FROM projects WHERE project_id = ?').get(input.projectId)) throw notFound(`project ${input.projectId}`);
    if (this.db.prepare('SELECT 1 AS found FROM runs WHERE run_id = ?').get(input.runId)) {
      abort({ kind: 'conflict', expected: `no run ${input.runId}`, actual: `a run row ${input.runId} already exists` });
    }
    const now = iso(input.nowMs);
    this.db
      .prepare("INSERT INTO runs (run_id, project_id, state, version, title, branch, base_revision, created_at, updated_at) VALUES (?, ?, 'contract_ready', 1, ?, ?, ?, ?, ?)")
      .run(input.runId, input.projectId, input.title, input.branch ?? null, input.baseRevision ?? null, now, now);
    this.insertEvent({ type: 'run.created', runId: input.runId, data: { runId: input.runId, projectId: input.projectId, state: 'contract_ready', version: 1 }, nowMs: input.nowMs });
    return this.readRun(input.runId);
  }

  // A run with its first contract, the contract's budget rows and its work items in one transaction (RC-1): a start killed at
  // any point leaves either nothing or the whole run.
  createRunWithContract(input: CreateRunWithContractInput): Result<CreatedRun> {
    return tx(this.db, () => {
      const run = this.insertRun(input.run);
      const contract = this.insertContract(run.runId, input.contract);
      const workItems = input.workItems.map((item) => {
        if (item.runId !== run.runId) abort({ kind: 'invalid', field: 'workItems', reason: `work item ${item.itemId} names run ${item.runId}, not ${run.runId}` });
        return this.insertWorkItem(item);
      });
      return { run: this.readRun(run.runId), contract, workItems };
    });
  }

  getRun(runId: string): Result<RunRow> {
    return guarded(() => this.readRun(runId));
  }

  transitionRun(runId: string, guard: TransitionGuard, t: RunTransitionInput): Result<RunRow> {
    return tx(this.db, () => {
      const row = this.lockRun(runId);
      this.checkVersion(row, guard.version, 'run');
      this.checkFence(row, guard.fence);
      const from = str(row['state']) as RunState;
      const edge = assertRunTransition(from, t.to);
      if (!edge.ok) abort(edge.error);
      if (t.to === 'blocked_on_decision') {
        if (t.reason === undefined) abort({ kind: 'invalid', field: 'reason', reason: 'a transition to blocked_on_decision needs a blocked reason' });
        if (!RUN_BLOCKED_REASONS.includes(t.reason)) abort({ kind: 'invalid', field: 'reason', reason: `${String(t.reason)} is not a documented blocked reason` });
      } else if (t.reason !== undefined) {
        abort({ kind: 'invalid', field: 'reason', reason: `a reason is only recorded for blocked_on_decision, not ${t.to}` });
      }
      if (t.attemptId !== undefined) this.checkRunAttempt(runId, t.attemptId);
      const version = Number(row['version']) + 1;
      this.db
        .prepare(
          `UPDATE runs SET state = ?, version = ?, updated_at = ?, reason = ?,
             workspace_path = COALESCE(?, workspace_path), branch = COALESCE(?, branch), base_revision = COALESCE(?, base_revision)
           WHERE run_id = ?`,
        )
        .run(t.to, version, iso(t.nowMs), t.to === 'blocked_on_decision' ? (t.reason ?? null) : null, t.workspacePath ?? null, t.branch ?? null, t.baseRevision ?? null, runId);
      const checkpoint = this.writeCheckpoint([runId], {
        runId,
        attemptId: t.attemptId ?? null,
        itemId: t.itemId ?? null,
        from,
        to: t.to,
        revision: t.revision ?? null,
        nextAction: t.nextAction,
        nowMs: t.nowMs,
      });
      this.insertEvent({
        type: 'run.transition',
        runId,
        ...(t.attemptId !== undefined ? { attemptId: t.attemptId } : {}),
        data: {
          ...(t.data ?? {}),
          runId,
          from,
          to: t.to,
          version,
          nextAction: t.nextAction,
          checkpointId: str(checkpoint['checkpoint_id']),
          ...(t.reason !== undefined ? { reason: t.reason } : {}),
        },
        nowMs: t.nowMs,
      });
      return this.readRun(runId);
    });
  }

  listRuns(projectId?: string): Result<RunRow[]> {
    return guarded(() => {
      const rows = (
        projectId === undefined
          ? this.db.prepare("SELECT * FROM runs WHERE state <> 'onboarding' ORDER BY created_at, rowid").all()
          : this.db.prepare("SELECT * FROM runs WHERE state <> 'onboarding' AND project_id = ? ORDER BY created_at, rowid").all(projectId)
      ) as Row[];
      return rows.map(toRun);
    });
  }

  acquireRunLease(runId: string, holder: string, ttlMs: number, nowMs: number): Result<LeaseGrant> {
    return this.acquireLeaseOn(this.runLease, runId, holder, ttlMs, nowMs);
  }

  renewRunLease(runId: string, holder: string, fence: number, ttlMs: number, nowMs: number): Result<LeaseGrant> {
    return this.renewLeaseOn(this.runLease, runId, holder, fence, ttlMs, nowMs);
  }

  releaseRunLease(runId: string, holder: string, fence: number): Result<void> {
    return this.releaseLeaseOn(this.runLease, runId, holder, fence);
  }

  recordRunCheckpoint(runId: string, guard: { fence: number }, input: RunCheckpointInput): Result<RunCheckpointRow> {
    return tx(this.db, () => {
      const row = this.lockRun(runId);
      this.checkFence(row, guard.fence);
      if (input.attemptId !== undefined) this.checkRunAttempt(runId, input.attemptId);
      const state = str(row['state']);
      const checkpoint = this.writeCheckpoint([runId], {
        runId,
        attemptId: input.attemptId ?? null,
        itemId: input.itemId ?? null,
        from: state,
        to: state,
        revision: input.revision ?? null,
        nextAction: input.nextAction,
        nowMs: input.nowMs,
      });
      this.db.prepare('UPDATE runs SET updated_at = ? WHERE run_id = ?').run(iso(input.nowMs), runId);
      this.insertEvent({
        type: 'run.checkpoint',
        runId,
        ...(input.attemptId !== undefined ? { attemptId: input.attemptId } : {}),
        data: { runId, state, nextAction: input.nextAction, seq: Number(checkpoint['seq']), checkpointId: str(checkpoint['checkpoint_id']) },
        nowMs: input.nowMs,
      });
      return toRunCheckpoint(checkpoint);
    });
  }

  latestRunCheckpoint(runId: string): Result<RunCheckpointRow | null> {
    return guarded(() => {
      this.lockRun(runId);
      const row = this.db.prepare('SELECT * FROM checkpoints WHERE run_id = ? ORDER BY seq DESC, rowid DESC LIMIT 1').get(runId) as Row | undefined;
      return row ? toRunCheckpoint(row) : null;
    });
  }

  listRunCheckpoints(runId: string): Result<RunCheckpointRow[]> {
    return guarded(() => {
      this.lockRun(runId);
      return (this.db.prepare('SELECT * FROM checkpoints WHERE run_id = ? ORDER BY seq, rowid').all(runId) as Row[]).map(toRunCheckpoint);
    });
  }

  storeRunContract(runId: string, guard: { fence: number }, input: StoreRunContractInput): Result<ContractRow> {
    return tx(this.db, () => {
      const row = this.lockRun(runId);
      this.checkFence(row, guard.fence);
      return this.insertContract(runId, input);
    });
  }

  // The caller's transaction must be open and the run vetted.
  private insertContract(runId: string, input: StoreRunContractInput): ContractRow {
    const version = input.version ?? 1;
    if (!Number.isInteger(version) || version < 1) abort({ kind: 'invalid', field: 'version', reason: 'a contract version is a positive integer' });
    if (this.db.prepare('SELECT 1 AS found FROM contracts WHERE run_id = ? AND version = ?').get(runId, version)) {
      abort({ kind: 'conflict', expected: `no contract version ${version} for run ${runId}`, actual: `contract version ${version} is already stored` });
    }
    const bodyJson = boundedBodyJson(input.body, 'contract');
    const now = iso(input.nowMs);
    this.db
      .prepare('INSERT INTO contracts (run_id, version, digest, body_json, policy_revision, authorized_by, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(runId, version, input.digest, bodyJson, input.policyRevision, input.authorizedBy, input.reason ?? null, now);
    if (input.budgets !== undefined) this.insertBudgets(runId, version, input.budgets);
    this.insertEvent({ type: 'contract.stored', runId, data: { runId, version, digest: input.digest }, nowMs: input.nowMs });
    return toContract(this.db.prepare('SELECT * FROM contracts WHERE run_id = ? AND version = ?').get(runId, version) as Row);
  }

  getRunContract(runId: string): Result<ContractRow | null> {
    return guarded(() => {
      this.lockRun(runId);
      const contract = this.db.prepare('SELECT * FROM contracts WHERE run_id = ? ORDER BY version DESC LIMIT 1').get(runId) as Row | undefined;
      return contract ? toContract(contract) : null;
    });
  }

  recordRunStep(runId: string, input: StepResultInput, guard?: { fence: number }): Result<RunStepRow> {
    return tx(this.db, () => {
      const row = this.lockRun(runId);
      if (guard !== undefined) this.checkFence(row, guard.fence);
      if (input.step === '') abort({ kind: 'invalid', field: 'step', reason: 'a step needs a name' });
      if (!(RUN_STEP_STATUSES as readonly string[]).includes(input.status)) {
        abort({ kind: 'invalid', field: 'status', reason: `${input.status} is not a run step status (${RUN_STEP_STATUSES.join(', ')})` });
      }
      const attempt = input.attempt ?? 1;
      this.db
        .prepare(
          `INSERT INTO run_steps (run_id, step, attempt, status, result_json, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (run_id, step, attempt) DO UPDATE SET status = excluded.status, result_json = excluded.result_json, started_at = excluded.started_at, completed_at = excluded.completed_at`,
        )
        .run(runId, input.step, attempt, input.status, boundedBodyJson(input.result, 'step result'), iso(input.nowMs), input.completedAtMs === undefined ? null : iso(input.completedAtMs));
      return toRunStep(this.db.prepare('SELECT * FROM run_steps WHERE run_id = ? AND step = ? AND attempt = ?').get(runId, input.step, attempt) as Row);
    });
  }

  getRunSteps(runId: string): Result<RunStepRow[]> {
    return guarded(() => {
      this.lockRun(runId);
      return (this.db.prepare('SELECT * FROM run_steps WHERE run_id = ? ORDER BY rowid').all(runId) as Row[]).map(toRunStep);
    });
  }

  // ---- attempts, evidence, gates -----------------------------------------------------------------------

  recordRunAttempt(runId: string, input: RunAttemptInput): Result<AttemptRow> {
    return tx(this.db, () => {
      this.lockRun(runId);
      if (input.reason === '') abort({ kind: 'invalid', field: 'reason', reason: 'an attempt needs a reason' });
      const next = this.db.prepare('SELECT COALESCE(MAX(ordinal), 0) + 1 AS next FROM attempts WHERE run_id = ?').get(runId) as { next: number };
      const attemptId = this.newId('att_');
      this.db
        .prepare('INSERT INTO attempts (attempt_id, run_id, ordinal, reason, started_at) VALUES (?, ?, ?, ?, ?)')
        .run(attemptId, runId, Number(next.next), input.reason, iso(input.nowMs));
      this.insertEvent({ type: 'attempt.started', runId, attemptId, data: { runId, attemptId, ordinal: Number(next.next) }, nowMs: input.nowMs });
      return toAttempt(this.db.prepare('SELECT * FROM attempts WHERE attempt_id = ?').get(attemptId) as Row);
    });
  }

  endRunAttempt(attemptId: string, input: { outcome: string; nowMs: number }): Result<AttemptRow> {
    return tx(this.db, () => {
      const runId = this.runOfAttempt(attemptId);
      if (input.outcome === '') abort({ kind: 'invalid', field: 'outcome', reason: 'an attempt ends with an outcome' });
      const changed = this.db.prepare('UPDATE attempts SET ended_at = ?, outcome = ? WHERE attempt_id = ? AND ended_at IS NULL').run(iso(input.nowMs), input.outcome, attemptId).changes;
      if (Number(changed) === 0) abort({ kind: 'conflict', expected: `attempt ${attemptId} still running`, actual: `attempt ${attemptId} already ended` });
      this.insertEvent({ type: 'attempt.ended', runId, attemptId, data: { runId, attemptId, outcome: input.outcome }, nowMs: input.nowMs });
      return toAttempt(this.db.prepare('SELECT * FROM attempts WHERE attempt_id = ?').get(attemptId) as Row);
    });
  }

  listRunAttempts(runId: string, _filter?: { itemId?: string }): Result<AttemptRow[]> {
    return guarded(() => {
      this.lockRun(runId);
      return (this.db.prepare('SELECT * FROM attempts WHERE run_id = ? ORDER BY ordinal').all(runId) as Row[]).map(toAttempt);
    });
  }

  // The run an attempt belongs to; an attempt of an onboarding carrier is not a run's attempt.
  private runOfAttempt(attemptId: string): string {
    const row = this.db
      .prepare("SELECT a.run_id AS run_id FROM attempts a JOIN runs r ON r.run_id = a.run_id WHERE a.attempt_id = ? AND r.state <> 'onboarding'")
      .get(attemptId) as Row | undefined;
    if (!row) throw notFound(`attempt ${attemptId}`);
    return str(row['run_id']);
  }

  // Insert-only (T-02-06): there is no method that updates an evidence row, and the schema refuses an UPDATE or DELETE.
  recordEvidence(input: EvidenceInput): Result<EvidenceRow> {
    return tx(this.db, () => {
      if (input.name === '') abort({ kind: 'invalid', field: 'name', reason: 'evidence needs a name' });
      if (input.kind === '') abort({ kind: 'invalid', field: 'kind', reason: 'evidence needs a kind' });
      if (!(EVIDENCE_STATUS_SET as readonly string[]).includes(input.status)) {
        abort({ kind: 'invalid', field: 'status', reason: `${String(input.status)} is not an evidence status (${EVIDENCE_STATUS_SET.join(', ')})` });
      }
      if (!(EVIDENCE_INDEPENDENCE_SET as readonly string[]).includes(input.independence)) {
        abort({ kind: 'invalid', field: 'independence', reason: `${String(input.independence)} is not an independence (${EVIDENCE_INDEPENDENCE_SET.join(', ')})` });
      }
      if (typeof input.clean !== 'boolean') abort({ kind: 'invalid', field: 'clean', reason: 'clean is true or false' });
      if (typeof input.environment !== 'object' || input.environment === null || Array.isArray(input.environment)) {
        abort({ kind: 'invalid', field: 'environment', reason: 'the environment is an object' });
      }
      if (!Number.isInteger(input.contractVersion) || input.contractVersion < 1) abort({ kind: 'invalid', field: 'contractVersion', reason: 'a contract version is a positive integer' });
      if (!Array.isArray(input.acceptance) || input.acceptance.some((a) => typeof a !== 'string')) abort({ kind: 'invalid', field: 'acceptance', reason: 'acceptance is a list of criterion IDs' });
      if (input.exitCode !== undefined && !Number.isInteger(input.exitCode)) abort({ kind: 'invalid', field: 'exitCode', reason: 'an exit code is an integer' });
      if (input.durationMs !== undefined && (!Number.isFinite(input.durationMs) || input.durationMs < 0)) abort({ kind: 'invalid', field: 'durationMs', reason: 'a duration is a non-negative number' });
      this.runOfAttempt(input.attemptId);
      const evidenceId = this.newId('ev_');
      this.db
        .prepare(
          `INSERT INTO evidence (evidence_id, attempt_id, work_item, kind, name, revision, clean, tree_digest, environment_json, contract_version, policy_revision,
                                 status, independence, acceptance_json, tests_json, command, exit_code, duration_ms, artifact_digest, ext_ref, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        )
        .run(
          evidenceId,
          input.attemptId,
          input.workItem ?? null,
          input.kind,
          input.name,
          input.revision,
          input.clean ? 1 : 0,
          input.treeDigest,
          boundedBodyJson(input.environment, 'environment'),
          input.contractVersion,
          input.policyRevision,
          input.status,
          input.independence,
          canonicalJson(input.acceptance),
          input.tests === undefined ? null : boundedBodyJson(input.tests, 'tests'),
          input.command === undefined ? null : canonicalJson(input.command),
          input.exitCode ?? null,
          input.durationMs ?? null,
          input.artifactDigest ?? null,
          iso(input.nowMs),
        );
      const stored = toEvidence(this.db.prepare('SELECT e.*, a.run_id AS run_id FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE e.evidence_id = ?').get(evidenceId) as Row);
      this.insertEvent({
        type: 'evidence.recorded',
        runId: stored.runId,
        attemptId: input.attemptId,
        data: { runId: stored.runId, evidenceId, name: input.name, kind: input.kind, status: input.status },
        nowMs: input.nowMs,
      });
      return stored;
    });
  }

  listEvidence(runId: string): Result<EvidenceRow[]> {
    return guarded(() => {
      this.lockRun(runId);
      const rows = this.db
        .prepare('SELECT e.*, a.run_id AS run_id FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ? ORDER BY e.rowid')
        .all(runId) as Row[];
      return rows.map(toEvidence);
    });
  }

  recordGateResult(input: GateResultInput): Result<void> {
    return tx(this.db, () => {
      this.lockRun(input.runId);
      if (input.gate === '') abort({ kind: 'invalid', field: 'gate', reason: 'a gate result names its gate' });
      if (typeof input.passed !== 'boolean') abort({ kind: 'invalid', field: 'passed', reason: 'passed is true or false' });
      if (!Number.isInteger(input.contractVersion) || input.contractVersion < 1) abort({ kind: 'invalid', field: 'contractVersion', reason: 'a contract version is a positive integer' });
      this.db
        .prepare(
          'INSERT INTO gate_results (run_id, gate, work_item, contract_version, policy_revision, revision, passed, failures_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(input.runId, input.gate, input.workItem ?? null, input.contractVersion, input.policyRevision, input.revision, input.passed ? 1 : 0, boundedBodyJson(input.failures, 'failures'), iso(input.nowMs));
      this.insertEvent({
        type: 'gate.result',
        runId: input.runId,
        ...(input.attemptId !== undefined ? { attemptId: input.attemptId } : {}),
        data: { runId: input.runId, gate: input.gate, passed: input.passed, revision: input.revision, failures: input.failures.length, ...(input.workItem !== undefined ? { itemId: input.workItem } : {}) },
        nowMs: input.nowMs,
      });
    });
  }

  listGateResults(runId: string): Result<GateResultRow[]> {
    return guarded(() => {
      this.lockRun(runId);
      return (this.db.prepare('SELECT * FROM gate_results WHERE run_id = ? ORDER BY rowid').all(runId) as Row[]).map(toGateResult);
    });
  }

  // ---- work items --------------------------------------------------------------------------------------

  upsertWorkItem(input: WorkItemInput): Result<WorkItemRow> {
    return tx(this.db, () => {
      this.lockRun(input.runId);
      return this.insertWorkItem(input);
    });
  }

  // The caller's transaction must be open and the run vetted.
  private insertWorkItem(input: WorkItemInput): WorkItemRow {
    if (input.itemId === '') abort({ kind: 'invalid', field: 'itemId', reason: 'a work item needs an ID' });
    const type = input.type ?? 'implement';
    if (type !== 'implement' && type !== 'harden') abort({ kind: 'invalid', field: 'type', reason: `${String(type)} is not a work item type (implement, harden)` });
    if (input.size === '' || input.model === '') abort({ kind: 'invalid', field: 'size', reason: 'a work item has a size and a model' });
    const dependsOn = input.dependsOn ?? [];
    if (!Array.isArray(dependsOn) || dependsOn.some((d) => typeof d !== 'string')) abort({ kind: 'invalid', field: 'dependsOn', reason: 'dependsOn is a list of item IDs' });
    const existed = this.db.prepare('SELECT 1 AS found FROM work_items WHERE run_id = ? AND item_id = ?').get(input.runId, input.itemId) !== undefined;
    // The state and the attempt count are never touched by an upsert: only transitionWorkItem moves them.
    this.db
      .prepare(
        `INSERT INTO work_items (run_id, item_id, type, depends_on_json, size, model, spec_json, state, gsd_session, attempts) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, 0)
         ON CONFLICT (run_id, item_id) DO UPDATE SET type = excluded.type, depends_on_json = excluded.depends_on_json, size = excluded.size, model = excluded.model,
           spec_json = excluded.spec_json, gsd_session = COALESCE(excluded.gsd_session, work_items.gsd_session)`,
      )
      .run(input.runId, input.itemId, type, canonicalJson(dependsOn), input.size, input.model, boundedBodyJson(input.spec, 'work item spec'), input.gsdSession ?? null);
    this.insertEvent({ type: 'work_item.upserted', runId: input.runId, data: { runId: input.runId, itemId: input.itemId, type, created: !existed }, nowMs: input.nowMs });
    return this.readWorkItem(input.runId, input.itemId);
  }

  transitionWorkItem(runId: string, itemId: string, guard: { fence: number }, t: WorkItemTransitionInput): Result<WorkItemRow> {
    return tx(this.db, () => {
      const run = this.lockRun(runId);
      this.checkFence(run, guard.fence);
      return this.applyItemTransition(runId, itemId, t);
    });
  }

  // The one place a work item changes state: validates the edge, updates the row and appends the work_item.transition event.
  // The caller's transaction must be open and the run vetted (lock, and lease fence where the caller holds one).
  private applyItemTransition(runId: string, itemId: string, t: WorkItemTransitionInput): WorkItemRow {
    const item = this.readWorkItem(runId, itemId);
    const edge = assertItemTransition(item.state, t.to);
    if (!edge.ok) abort(edge.error);
    if (t.attemptId !== undefined) this.checkRunAttempt(runId, t.attemptId);
    this.db
      .prepare('UPDATE work_items SET state = ?, attempts = attempts + ?, gsd_session = COALESCE(?, gsd_session) WHERE run_id = ? AND item_id = ?')
      .run(t.to, t.to === 'delegated' ? 1 : 0, t.gsdSession ?? null, runId, itemId);
    this.insertEvent({
      type: 'work_item.transition',
      runId,
      ...(t.attemptId !== undefined ? { attemptId: t.attemptId } : {}),
      data: { ...(t.data ?? {}), runId, itemId, from: item.state, to: t.to },
      nowMs: t.nowMs,
    });
    return this.readWorkItem(runId, itemId);
  }

  listWorkItems(runId: string): Result<WorkItemRow[]> {
    return guarded(() => {
      this.lockRun(runId);
      return (this.db.prepare('SELECT * FROM work_items WHERE run_id = ? ORDER BY rowid').all(runId) as Row[]).map(toWorkItem);
    });
  }

  private readWorkItem(runId: string, itemId: string): WorkItemRow {
    const row = this.db.prepare('SELECT * FROM work_items WHERE run_id = ? AND item_id = ?').get(runId, itemId) as Row | undefined;
    if (!row) throw notFound(`work item ${itemId} of ${runId}`);
    return toWorkItem(row);
  }

  // ---- decisions, check validations, hook reads --------------------------------------------------------

  openDecision(input: DecisionInput): Result<DecisionRow> {
    return tx(this.db, () => {
      this.lockRun(input.runId);
      if (!DECISION_CLASSES.includes(input.class)) abort({ kind: 'invalid', field: 'class', reason: `${input.class} is not a decision class (${DECISION_CLASSES.join(', ')})` });
      if (input.urgency !== 'blocking' && input.urgency !== 'digest') abort({ kind: 'invalid', field: 'urgency', reason: 'urgency is blocking or digest' });
      if (input.issue === '') abort({ kind: 'invalid', field: 'issue', reason: 'a decision states its issue' });
      if (!Number.isInteger(input.contractVersion) || input.contractVersion < 1) abort({ kind: 'invalid', field: 'contractVersion', reason: 'a contract version is a positive integer' });
      if (input.stateDigest === '') abort({ kind: 'invalid', field: 'stateDigest', reason: 'a decision carries the digest of the state it was opened on' });
      const decisionId = this.newId('dec_');
      this.db
        .prepare(
          `INSERT INTO decisions (decision_id, run_id, contract_version, class, issue, recommendation, options_json, consequences_json, evidence_refs_json,
                                  affected_items_json, authorized_default, state_digest, urgency, state, opened_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
        )
        .run(
          decisionId,
          input.runId,
          input.contractVersion,
          input.class,
          input.issue,
          input.recommendation ?? null,
          boundedBodyJson(input.options, 'options'),
          boundedBodyJson(input.consequences, 'consequences'),
          boundedBodyJson(input.evidenceRefs, 'evidenceRefs'),
          boundedBodyJson(input.affectedItems, 'affectedItems'),
          input.authorizedDefault ?? null,
          input.stateDigest,
          input.urgency,
          iso(input.nowMs),
        );
      this.insertEvent({
        type: 'decision.opened',
        runId: input.runId,
        ...(input.attemptId !== undefined ? { attemptId: input.attemptId } : {}),
        data: { runId: input.runId, decisionId, class: input.class, urgency: input.urgency, contractVersion: input.contractVersion },
        nowMs: input.nowMs,
      });
      return toDecision(this.db.prepare('SELECT * FROM decisions WHERE decision_id = ?').get(decisionId) as Row);
    });
  }

  // open -> answered in one transaction under the run lock (T-03-03): the decision is still open and the run's latest contract is
  // the version the caller validated against, or nothing is written. Every affected item that no other open decision of the run
  // lists goes blocked_on_decision -> ready. The event carries IDs, the channel and a count; the answer text stays in the row (T-03-04).
  answerDecision(input: AnswerDecisionInput): Result<DecisionRow> {
    return tx(this.db, () => {
      this.lockRun(input.runId);
      if (input.answer === '') abort({ kind: 'invalid', field: 'answer', reason: 'an answer is not empty' });
      if (input.answeredBy === '') abort({ kind: 'invalid', field: 'answeredBy', reason: 'an answer names who gave it' });
      if (input.channel !== 'terminal') abort({ kind: 'invalid', field: 'channel', reason: 'an answer arrives on the terminal channel' });
      if (!Number.isInteger(input.expectContractVersion) || input.expectContractVersion < 1) {
        abort({ kind: 'invalid', field: 'expectContractVersion', reason: 'a contract version is a positive integer' });
      }
      const decision = this.openDecisionRow(input.runId, input.decisionId);
      const latest = this.latestContractVersion(input.runId);
      if (latest !== input.expectContractVersion) {
        abort({ kind: 'conflict', expected: `contract version ${input.expectContractVersion}`, actual: latest === 0 ? 'no contract' : `contract version ${latest}` });
      }
      const changed = this.db
        .prepare("UPDATE decisions SET state = 'answered', answered_at = ?, answered_by = ?, answer = ?, answer_channel = ? WHERE decision_id = ? AND state = 'open'")
        .run(iso(input.nowMs), input.answeredBy, input.answer, input.channel, input.decisionId).changes;
      if (Number(changed) === 0) abort({ kind: 'conflict', expected: `decision ${input.decisionId} open`, actual: `decision ${input.decisionId} no longer open` });

      const stillBlocked = new Set<string>();
      for (const other of this.db.prepare("SELECT affected_items_json FROM decisions WHERE run_id = ? AND state = 'open' AND decision_id <> ?").all(input.runId, input.decisionId) as Row[]) {
        for (const itemId of parseJson(other['affected_items_json']) as readonly string[]) stillBlocked.add(itemId);
      }
      const released: string[] = [];
      for (const itemId of new Set(decision.affectedItems)) {
        if (stillBlocked.has(itemId)) continue;
        const item = this.db.prepare('SELECT state FROM work_items WHERE run_id = ? AND item_id = ?').get(input.runId, itemId) as Row | undefined;
        if (item !== undefined && str(item['state']) === 'blocked_on_decision') released.push(itemId);
      }
      this.insertEvent({
        type: 'decision.answered',
        runId: input.runId,
        data: { runId: input.runId, decisionId: input.decisionId, channel: input.channel, itemsReleased: released.length },
        nowMs: input.nowMs,
      });
      for (const itemId of released) this.applyItemTransition(input.runId, itemId, { to: 'ready', nowMs: input.nowMs, data: { decisionId: input.decisionId } });
      return toDecision(this.db.prepare('SELECT * FROM decisions WHERE decision_id = ?').get(input.decisionId) as Row);
    });
  }

  reopenStaleDecision(_input: ReopenStaleDecisionInput): Result<{ stale: DecisionRow; reopened: DecisionRow }> {
    return err({ kind: 'invalid', field: 'reopenStaleDecision', reason: 'not implemented' });
  }

  withdrawDecision(_input: WithdrawDecisionInput): Result<DecisionRow> {
    return err({ kind: 'invalid', field: 'withdrawDecision', reason: 'not implemented' });
  }

  // A decision of this run that is still open; a decision of another run is not found, one in any other state is a conflict.
  private openDecisionRow(runId: string, decisionId: string): DecisionRow {
    const row = this.db.prepare('SELECT * FROM decisions WHERE decision_id = ? AND run_id = ?').get(decisionId, runId) as Row | undefined;
    if (!row) throw notFound(`decision ${decisionId} of ${runId}`);
    const decision = toDecision(row);
    if (decision.state !== 'open') abort({ kind: 'conflict', expected: `decision ${decisionId} open`, actual: `decision ${decisionId} ${decision.state}` });
    return decision;
  }

  private latestContractVersion(runId: string): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(version), 0) AS latest FROM contracts WHERE run_id = ?').get(runId) as Row;
    return Number(row['latest']);
  }

  listDecisions(filter: { runId?: string; state?: DecisionState }): Result<DecisionRow[]> {
    return guarded(() => {
      if (filter.state !== undefined && !DECISION_STATES.includes(filter.state)) {
        abort({ kind: 'invalid', field: 'state', reason: `${String(filter.state)} is not a decision state (${DECISION_STATES.join(', ')})` });
      }
      const where: string[] = [];
      const args: string[] = [];
      if (filter.runId !== undefined) {
        where.push('run_id = ?');
        args.push(filter.runId);
      }
      if (filter.state !== undefined) {
        where.push('state = ?');
        args.push(filter.state);
      }
      const clause = where.length === 0 ? '' : ` WHERE ${where.join(' AND ')}`;
      return (this.db.prepare(`SELECT * FROM decisions${clause} ORDER BY opened_at, rowid`).all(...args) as Row[]).map(toDecision);
    });
  }

  recordCheckValidation(input: CheckValidationInput): Result<void> {
    return tx(this.db, () => {
      for (const [field, value] of [['projectId', input.projectId], ['baseRevision', input.baseRevision], ['specDigest', input.specDigest], ['name', input.name], ['verdict', input.verdict]] as const) {
        if (value === '') abort({ kind: 'invalid', field, reason: `a check validation needs a ${field}` });
      }
      const existing = this.db
        .prepare('SELECT verdict FROM check_validations WHERE project_id = ? AND base_revision = ? AND spec_digest = ? AND name = ?')
        .get(input.projectId, input.baseRevision, input.specDigest, input.name) as Row | undefined;
      if (existing) abort({ kind: 'conflict', expected: `no verdict for check ${input.name} on this revision and spec`, actual: `verdict ${str(existing['verdict'])} is already recorded` });
      this.db
        .prepare('INSERT INTO check_validations (project_id, base_revision, spec_digest, name, verdict, detail_json, validated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(input.projectId, input.baseRevision, input.specDigest, input.name, input.verdict, boundedBodyJson(input.detail, 'detail'), iso(input.nowMs));
    });
  }

  getCheckValidations(projectId: string, baseRevision: string, specDigest: string): Result<CheckValidationRow[]> {
    return guarded(() =>
      (
        this.db
          .prepare('SELECT * FROM check_validations WHERE project_id = ? AND base_revision = ? AND spec_digest = ? ORDER BY rowid')
          .all(projectId, baseRevision, specDigest) as Row[]
      ).map(toCheckValidation),
    );
  }

  listHookReads(invocationId: string): Result<HookReadRow[]> {
    return guarded(() => (this.db.prepare('SELECT * FROM hook_reads WHERE invocation_id = ? ORDER BY seq, rowid').all(invocationId) as Row[]).map(toHookRead));
  }

  // The run row, or not_found when there is none or it is an onboarding carrier.
  private lockRun(runId: string): Row {
    const row = this.db.prepare("SELECT * FROM runs WHERE run_id = ? AND state <> 'onboarding'").get(runId) as Row | undefined;
    if (!row) throw notFound(`run ${runId}`);
    return row;
  }

  private readRun(runId: string): RunRow {
    return toRun(this.lockRun(runId));
  }

  // An attempt named by a run write must be one of that run's own.
  private checkRunAttempt(runId: string, attemptId: string): void {
    const row = this.db.prepare('SELECT run_id FROM attempts WHERE attempt_id = ?').get(attemptId) as Row | undefined;
    if (!row || str(row['run_id']) !== runId) abort({ kind: 'invalid', field: 'attemptId', reason: `${attemptId} is not an attempt of run ${runId}` });
  }
}

function notFound(ref: string): LedgerAbort {
  return new LedgerAbort({ kind: 'not_found', ref });
}

function checkAmount(amount: number): void {
  if (!Number.isFinite(amount) || amount < 0) abort({ kind: 'invalid', field: 'amount', reason: 'a budget amount is a finite non-negative number' });
}

function toBudget(r: Row): BudgetRow {
  return {
    runId: str(r['run_id']),
    name: str(r['name']),
    limit: Number(r['limit_value']),
    used: Number(r['used']),
    reserved: Number(r['reserved']),
    exactness: str(r['exactness']) as BudgetRow['exactness'],
    contractVersion: Number(r['contract_version']),
  };
}

function toContract(r: Row): ContractRow {
  return {
    runId: str(r['run_id']),
    version: Number(r['version']),
    digest: str(r['digest']),
    body: parseJson(r['body_json']),
    policyRevision: str(r['policy_revision']),
    authorizedBy: str(r['authorized_by']),
    reason: strOrNull(r['reason']),
    createdAt: str(r['created_at']),
  };
}

function toStep(r: Row): StepResultRow {
  return {
    onboardingId: str(r['onboarding_id']),
    step: str(r['step']),
    attempt: Number(r['attempt']),
    status: str(r['status']),
    result: parseJson(r['result_json']),
    startedAt: str(r['started_at']),
    completedAt: strOrNull(r['completed_at']),
  };
}

function toAttempt(r: Row): AttemptRow {
  return {
    attemptId: str(r['attempt_id']),
    runId: str(r['run_id']),
    ordinal: Number(r['ordinal']),
    reason: str(r['reason']),
    startedAt: str(r['started_at']),
    endedAt: strOrNull(r['ended_at']),
    outcome: strOrNull(r['outcome']),
    itemId: null,
  };
}

function toProject(r: Row): ProjectRow {
  return {
    projectId: str(r['project_id']),
    rootCommit: str(r['root_commit']),
    repoPath: str(r['repo_path']),
    remote: strOrNull(r['remote']),
    defaultBranch: strOrNull(r['default_branch']),
    createdAt: str(r['created_at']),
  };
}

function toCheckpoint(r: Row): CheckpointRow {
  return {
    checkpointId: str(r['checkpoint_id']),
    runId: str(r['run_id']),
    seq: Number(r['seq']),
    fromState: strOrNull(r['from_state']) as OnboardingState | null,
    toState: str(r['to_state']) as OnboardingState,
    revision: strOrNull(r['revision']),
    nextAction: str(r['next_action']),
    createdAt: str(r['created_at']),
  };
}

function toRun(r: Row): RunRow {
  return {
    runId: str(r['run_id']),
    projectId: str(r['project_id']),
    state: str(r['state']) as RunState,
    version: Number(r['version']),
    title: str(r['title']),
    reason: strOrNull(r['reason']) as RunRow['reason'],
    workspacePath: strOrNull(r['workspace_path']),
    branch: strOrNull(r['branch']),
    baseRevision: strOrNull(r['base_revision']),
    createdAt: str(r['created_at']),
    updatedAt: str(r['updated_at']),
    leaseHolder: strOrNull(r['lease_holder']),
    leaseExpiresAt: strOrNull(r['lease_expires_at']),
    leaseFence: Number(r['lease_fence']),
  };
}

function toRunCheckpoint(r: Row): RunCheckpointRow {
  return {
    checkpointId: str(r['checkpoint_id']),
    runId: str(r['run_id']),
    seq: Number(r['seq']),
    attemptId: strOrNull(r['attempt_id']),
    itemId: strOrNull(r['item_id']),
    fromState: strOrNull(r['from_state']) as RunState | null,
    toState: str(r['to_state']) as RunState,
    revision: strOrNull(r['revision']),
    nextAction: str(r['next_action']),
    createdAt: str(r['created_at']),
  };
}

function toRunStep(r: Row): RunStepRow {
  return {
    runId: str(r['run_id']),
    step: str(r['step']),
    attempt: Number(r['attempt']),
    status: str(r['status']),
    result: parseJson(r['result_json']),
    startedAt: str(r['started_at']),
    completedAt: strOrNull(r['completed_at']),
  };
}

function toEvidence(r: Row): EvidenceRow {
  return {
    evidenceId: str(r['evidence_id']),
    attemptId: str(r['attempt_id']),
    runId: str(r['run_id']),
    workItem: strOrNull(r['work_item']),
    kind: str(r['kind']),
    name: str(r['name']),
    status: str(r['status']) as EvidenceStatus,
    revision: str(r['revision']),
    clean: Number(r['clean']) === 1,
    treeDigest: str(r['tree_digest']),
    environment: parseJson(r['environment_json']) as Readonly<Record<string, unknown>>,
    contractVersion: Number(r['contract_version']),
    policyRevision: str(r['policy_revision']),
    independence: str(r['independence']) as EvidenceIndependence,
    acceptance: parseJson(r['acceptance_json']) as readonly string[],
    tests: r['tests_json'] === null ? null : parseJson(r['tests_json']),
    command: r['command'] === null ? null : (parseJson(r['command']) as readonly string[]),
    exitCode: r['exit_code'] === null ? null : Number(r['exit_code']),
    durationMs: r['duration_ms'] === null ? null : Number(r['duration_ms']),
    artifactDigest: strOrNull(r['artifact_digest']),
    createdAt: str(r['created_at']),
  };
}

function toGateResult(r: Row): GateResultRow {
  return {
    runId: str(r['run_id']),
    gate: str(r['gate']),
    workItem: strOrNull(r['work_item']),
    contractVersion: Number(r['contract_version']),
    policyRevision: str(r['policy_revision']),
    revision: str(r['revision']),
    passed: Number(r['passed']) === 1,
    failures: parseJson(r['failures_json']),
    createdAt: str(r['created_at']),
  };
}

function toWorkItem(r: Row): WorkItemRow {
  return {
    runId: str(r['run_id']),
    itemId: str(r['item_id']),
    type: str(r['type']) as WorkItemRow['type'],
    dependsOn: parseJson(r['depends_on_json']) as readonly string[],
    size: str(r['size']),
    model: str(r['model']),
    spec: parseJson(r['spec_json']),
    state: str(r['state']) as WorkItemState,
    gsdSession: strOrNull(r['gsd_session']),
    attempts: Number(r['attempts']),
  };
}

function toDecision(r: Row): DecisionRow {
  return {
    decisionId: str(r['decision_id']),
    runId: str(r['run_id']),
    contractVersion: Number(r['contract_version']),
    class: str(r['class']),
    issue: str(r['issue']),
    recommendation: strOrNull(r['recommendation']),
    options: parseJson(r['options_json']),
    consequences: parseJson(r['consequences_json']),
    evidenceRefs: parseJson(r['evidence_refs_json']) as readonly string[],
    affectedItems: parseJson(r['affected_items_json']) as readonly string[],
    authorizedDefault: strOrNull(r['authorized_default']),
    stateDigest: str(r['state_digest']),
    urgency: str(r['urgency']) as DecisionRow['urgency'],
    state: str(r['state']) as DecisionState,
    openedAt: str(r['opened_at']),
    answeredAt: strOrNull(r['answered_at']),
    answeredBy: strOrNull(r['answered_by']),
    answer: strOrNull(r['answer']),
    answerChannel: strOrNull(r['answer_channel']),
    supersedes: strOrNull(r['supersedes']),
  };
}

function toCheckValidation(r: Row): CheckValidationRow {
  return {
    projectId: str(r['project_id']),
    baseRevision: str(r['base_revision']),
    specDigest: str(r['spec_digest']),
    name: str(r['name']),
    verdict: str(r['verdict']),
    detail: parseJson(r['detail_json']),
    validatedAt: str(r['validated_at']),
  };
}

function toRunEvent(r: Row): RunEventRow {
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(str(r['data_json']));
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
  } catch {
    // an unreadable data column shows as no data
  }
  return { seq: Number(r['seq']), at: str(r['ts']), level: str(r['level']), type: str(r['type']), data };
}

function toHookRead(r: Row): HookReadRow {
  return {
    invocationId: str(r['invocation_id']),
    agentId: str(r['agent_id']),
    path: str(r['path']),
    digest: str(r['digest']),
    seq: Number(r['seq']),
    recordedAt: str(r['recorded_at']),
  };
}

function toActiveRecord(r: Row): ActiveRecord {
  return {
    projectId: str(r['project_id']),
    version: Number(r['version']),
    state: str(r['state']),
    body: parseJson(r['body_json']) as Readonly<Record<string, unknown>>,
    digest: str(r['digest']),
    gsdVersion: str(r['gsd_version']),
    onboardedRevision: str(r['onboarded_revision']),
    mappingMode: strOrNull(r['mapping_mode']),
    mappingScope: r['mapping_scope_json'] === null ? null : parseJson(r['mapping_scope_json']),
    completeness: strOrNull(r['completeness']),
    graphCommit: strOrNull(r['graph_commit']),
    intelCommit: strOrNull(r['intel_commit']),
    knowledgeCommit: strOrNull(r['knowledge_commit']),
    createdAt: str(r['created_at']),
    activatedAt: strOrNull(r['activated_at']),
    supersededAt: strOrNull(r['superseded_at']),
  };
}
