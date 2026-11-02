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
import type {
  ActivateInput,
  ActivationResult,
  ActiveRecord,
  AdapterConfigInput,
  ArtifactInput,
  BudgetReservation,
  BudgetRow,
  BudgetRowInput,
  AttemptInput,
  AttemptRow,
  CheckpointInput,
  CheckpointRow,
  ContractRow,
  EventInput,
  EventReceipt,
  Ledger,
  LeaseGrant,
  NewOnboarding,
  NewProject,
  OnboardingRow,
  ProjectQuery,
  ProjectRow,
  StepResultInput,
  StepResultRow,
  StoreContractInput,
  TransitionGuard,
  TransitionInput,
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
    return tx(this.db, () => {
      const expiresAt = iso(nowMs + ttlMs);
      const changed = this.db
        .prepare(
          'UPDATE onboardings SET lease_holder = ?, lease_expires_at = ?, lease_fence = lease_fence + 1 WHERE onboarding_id = ? AND (lease_holder IS NULL OR lease_expires_at < ?)',
        )
        .run(holder, expiresAt, onboardingId, iso(nowMs)).changes;
      const row = this.lockRow(onboardingId);
      if (Number(changed) === 0) {
        abort({ kind: 'conflict', expected: 'a free or expired lease', actual: `held by ${str(row['lease_holder'])} until ${str(row['lease_expires_at'])}` });
      }
      return { fence: Number(row['lease_fence']), expiresAt };
    });
  }

  renewLease(onboardingId: string, holder: string, fence: number, ttlMs: number, nowMs: number): Result<LeaseGrant> {
    return tx(this.db, () => {
      const expiresAt = iso(nowMs + ttlMs);
      const changed = this.db
        .prepare('UPDATE onboardings SET lease_expires_at = ? WHERE onboarding_id = ? AND lease_holder = ? AND lease_fence = ?')
        .run(expiresAt, onboardingId, holder, fence).changes;
      if (Number(changed) === 0) this.leaseConflict(onboardingId, holder, fence);
      return { fence, expiresAt };
    });
  }

  releaseLease(onboardingId: string, holder: string, fence: number): Result<void> {
    return tx(this.db, () => {
      const changed = this.db
        .prepare('UPDATE onboardings SET lease_holder = NULL, lease_expires_at = NULL WHERE onboarding_id = ? AND lease_holder = ? AND lease_fence = ?')
        .run(onboardingId, holder, fence).changes;
      if (Number(changed) === 0) this.leaseConflict(onboardingId, holder, fence);
    });
  }

  private leaseConflict(onboardingId: string, holder: string, fence: number): never {
    const row = this.lockRow(onboardingId);
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

  private checkVersion(row: Row, version: number): void {
    if (Number(row['version']) !== version) {
      abort({ kind: 'conflict', expected: `onboarding version ${version}`, actual: `onboarding version ${Number(row['version'])}` });
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
    const next = this.db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM checkpoints WHERE run_id IN (?, ?, ?)').get(onboardingId, other, runId) as { next: number };
    const checkpointId = this.newId('ckp_');
    this.db
      .prepare('INSERT INTO checkpoints (checkpoint_id, run_id, seq, from_state, to_state, revision, next_action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(checkpointId, runId, Number(next.next), from, to, revision, nextAction, iso(nowMs));
    return toCheckpoint(this.db.prepare('SELECT * FROM checkpoints WHERE checkpoint_id = ?').get(checkpointId) as Row);
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

  // The caller's transaction must be open. Appends one row to the hash chain (events.ts).
  private insertEvent(ev: EventRow): EventReceipt {
    try {
      return appendEventRow(this.db, ev);
    } catch (e) {
      if (e instanceof EventDataError) abort({ kind: 'invalid', field: e.field, reason: e.reason });
      throw e;
    }
  }

  // ---- budgets (STUBS for the RED commit) -------------------------------------------------------------

  createBudgets(_runId: string, _contractVersion: number, _rows: readonly BudgetRowInput[]): Result<BudgetRow[]> {
    return err({ kind: 'unsupported', capability: 'budgets' });
  }

  reserveBudget(_runId: string, _name: string, _amount: number): Result<BudgetReservation> {
    return err({ kind: 'unsupported', capability: 'budgets' });
  }

  chargeBudget(_runId: string, _name: string, _amount: number, _options: { fromReserved: boolean }): Result<BudgetRow> {
    return err({ kind: 'unsupported', capability: 'budgets' });
  }

  getBudgets(_runId: string): Result<BudgetRow[]> {
    return err({ kind: 'unsupported', capability: 'budgets' });
  }

  countBudgetDenials(_runId: string, _invocationId: string): Result<number> {
    return err({ kind: 'unsupported', capability: 'budgets' });
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
}

function notFound(ref: string): LedgerAbort {
  return new LedgerAbort({ kind: 'not_found', ref });
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
