// SqliteLedger: the onboarding subset of the Ledger port over node:sqlite (SKELETON.md "Ports").
// Reads never take a lease. Writers (completed in the second task of plan 01-03) run in one
// BEGIN IMMEDIATE transaction each.
import { err, ok } from '../../domain/result.ts';
import type { PortError, Result } from '../../domain/result.ts';
import type { IdPrefix } from '../../domain/ids.ts';
import type { OnboardingState } from '../../domain/onboarding-lifecycle.ts';
import type {
  ActivateInput,
  ActivationResult,
  ActiveRecord,
  AdapterConfigInput,
  ArtifactInput,
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
import { LedgerAbort, toPortError } from './db.ts';
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

function notImplemented<T>(method: string): Result<T> {
  const error: PortError = { kind: 'internal', cause: `SqliteLedger.${method} is not implemented yet` };
  return err(error);
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

  // ---- writers: completed by the second task of plan 01-03 ----------------------------------------

  registerProject(_input: NewProject): Result<ProjectRow> {
    return notImplemented('registerProject');
  }
  findProject(_query: ProjectQuery): Result<ProjectRow | null> {
    return notImplemented('findProject');
  }
  createOnboarding(_input: NewOnboarding): Result<OnboardingRow> {
    return notImplemented('createOnboarding');
  }
  acquireLease(_onboardingId: string, _holder: string, _ttlMs: number, _nowMs: number): Result<LeaseGrant> {
    return notImplemented('acquireLease');
  }
  renewLease(_onboardingId: string, _holder: string, _fence: number, _ttlMs: number, _nowMs: number): Result<LeaseGrant> {
    return notImplemented('renewLease');
  }
  releaseLease(_onboardingId: string, _holder: string, _fence: number): Result<void> {
    return notImplemented('releaseLease');
  }
  transitionOnboarding(_onboardingId: string, _guard: TransitionGuard, _t: TransitionInput): Result<OnboardingRow> {
    return notImplemented('transitionOnboarding');
  }
  recordCheckpoint(_onboardingId: string, _guard: { fence: number }, _input: CheckpointInput): Result<CheckpointRow> {
    return notImplemented('recordCheckpoint');
  }
  storeContract(_onboardingId: string, _guard: { fence: number }, _input: StoreContractInput): Result<ContractRow> {
    return notImplemented('storeContract');
  }
  getContract(_onboardingId: string): Result<ContractRow | null> {
    return notImplemented('getContract');
  }
  recordStepResult(_onboardingId: string, _input: StepResultInput): Result<StepResultRow> {
    return notImplemented('recordStepResult');
  }
  getStepResults(_onboardingId: string): Result<StepResultRow[]> {
    return notImplemented('getStepResults');
  }
  recordAttempt(_onboardingId: string, _input: AttemptInput): Result<AttemptRow> {
    return notImplemented('recordAttempt');
  }
  listAttempts(_onboardingId: string): Result<AttemptRow[]> {
    return notImplemented('listAttempts');
  }
  insertRecordAndActivate(_onboardingId: string, _guard: TransitionGuard, _input: ActivateInput): Result<ActivationResult> {
    return notImplemented('insertRecordAndActivate');
  }
  appendEvent(_input: EventInput): Result<EventReceipt> {
    return notImplemented('appendEvent');
  }
  recordArtifact(_input: ArtifactInput): Result<void> {
    return notImplemented('recordArtifact');
  }
  upsertAdapterConfig(_input: AdapterConfigInput): Result<void> {
    return notImplemented('upsertAdapterConfig');
  }
}

function notFound(ref: string): LedgerAbort {
  return new LedgerAbort({ kind: 'not_found', ref });
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
