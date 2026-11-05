// Ledger port (docs/contracts-and-state.md "Persisted entities", "Concurrency control"; SKELETON.md "Ports").
// The onboarding subset plus the budget methods (plan 01-12). Every method returns a Result and never
// throws across the boundary. Every state-changing method is one atomic unit: either all of its rows
// are written or none are (NFR-6, NFR-9). Times are epoch milliseconds passed in by the caller, so the
// adapter reads no clock.
import type { Result } from '../domain/result.ts';
import type { BlockedReason, OnboardingState } from '../domain/onboarding-lifecycle.ts';
import type { RunBlockedReason, RunState, WorkItemState } from '../domain/run-lifecycle.ts';

export interface ProjectRow {
  projectId: string;
  rootCommit: string;
  repoPath: string;
  remote: string | null;
  defaultBranch: string | null;
  createdAt: string;
}

export interface NewProject {
  projectId: string;
  rootCommit: string;
  repoPath: string;
  remote?: string | null;
  defaultBranch?: string | null;
  nowMs: number;
}

export type ProjectQuery = { projectId: string } | { rootCommit: string; repoPath: string };

export interface OnboardingRow {
  onboardingId: string;
  projectId: string;
  state: OnboardingState;
  version: number;
  stagingWorktree: string | null;
  contractRunId: string | null;
  // Parsed preflight_json.
  preflight: unknown;
  // Reason carried by the transition that entered the current state (blocked, incompatible), else null.
  reason: BlockedReason | null;
  createdAt: string;
  updatedAt: string;
  leaseHolder: string | null;
  leaseExpiresAt: string | null;
  leaseFence: number;
}

export interface NewOnboarding {
  onboardingId: string;
  projectId: string;
  preflight: Readonly<Record<string, unknown>>;
  nowMs: number;
}

// Optimistic-concurrency token: the row version and the lease fence the caller last saw.
export interface TransitionGuard {
  version: number;
  fence: number;
}

export interface TransitionInput {
  to: OnboardingState;
  // Written to checkpoints.next_action.
  nextAction: string;
  nowMs: number;
  // Required when `to` is `blocked`; allowed for `incompatible`; refused otherwise.
  reason?: BlockedReason;
  revision?: string;
  stagingWorktree?: string;
  // Extra event data: IDs, counts, digests and exit codes only.
  data?: Readonly<Record<string, unknown>>;
}

export interface CheckpointInput {
  nextAction: string;
  nowMs: number;
  revision?: string;
  stagingWorktree?: string;
}

export interface CheckpointRow {
  checkpointId: string;
  runId: string;
  seq: number;
  fromState: OnboardingState | null;
  toState: OnboardingState;
  revision: string | null;
  nextAction: string;
  createdAt: string;
}

export interface LeaseGrant {
  fence: number;
  expiresAt: string;
}

export interface BudgetRowInput {
  name: string;
  limit: number;
  exactness: 'exact' | 'estimated';
}

export interface BudgetRow {
  runId: string;
  name: string;
  limit: number;
  used: number;
  reserved: number;
  exactness: 'exact' | 'estimated';
  contractVersion: number;
}

export interface BudgetReservation {
  // False when `used + reserved + amount` would pass the limit; nothing was reserved then.
  granted: boolean;
  budget: BudgetRow;
}

export interface StoreContractInput {
  // The carrier run ID; the onboarding contract is stored as a run contract.
  runId: string;
  version?: number;
  // Budget rows created in the same transaction as the contract (docs/contracts-and-state.md "Budget accounting").
  budgets?: readonly BudgetRowInput[];
  digest: string;
  body: unknown;
  policyRevision: string;
  authorizedBy: string;
  reason?: string;
  nowMs: number;
}

export interface ContractRow {
  runId: string;
  version: number;
  digest: string;
  body: unknown;
  policyRevision: string;
  authorizedBy: string;
  reason: string | null;
  createdAt: string;
}

export interface StepResultInput {
  step: string;
  attempt?: number;
  status: string;
  result: unknown;
  nowMs: number;
  completedAtMs?: number;
}

export interface StepResultRow {
  onboardingId: string;
  step: string;
  attempt: number;
  status: string;
  result: unknown;
  startedAt: string;
  completedAt: string | null;
}

export interface AttemptInput {
  reason: string;
  nowMs: number;
  outcome?: string;
  endedAtMs?: number;
}

export interface AttemptRow {
  attemptId: string;
  runId: string;
  ordinal: number;
  reason: string;
  startedAt: string;
  endedAt: string | null;
  outcome: string | null;
}

export interface ActivateInput {
  // The project record body. Its `recordVersion`, when present, must equal the next version.
  body: Readonly<Record<string, unknown>>;
  nowMs: number;
}

export interface ActiveRecord {
  projectId: string;
  version: number;
  state: string;
  body: Readonly<Record<string, unknown>>;
  digest: string;
  gsdVersion: string;
  onboardedRevision: string;
  mappingMode: string | null;
  mappingScope: unknown;
  completeness: string | null;
  graphCommit: string | null;
  intelCommit: string | null;
  knowledgeCommit: string | null;
  createdAt: string;
  activatedAt: string | null;
  supersededAt: string | null;
}

export interface ActivationResult {
  recordVersion: number;
  digest: string;
}

export interface EventInput {
  type: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  runId?: string;
  attemptId?: string;
  invocationId?: string;
  // IDs, counts, digests and exit codes only, never payloads. The adapter refuses long strings.
  data: Readonly<Record<string, unknown>>;
  nowMs: number;
}

export interface EventReceipt {
  seq: number;
  rowHash: string;
}

export interface ArtifactInput {
  digest: string;
  size: number;
  kind: string;
  runId?: string;
  retention: string;
  store: string;
  nowMs: number;
}

export interface AdapterConfigInput {
  name: string;
  port: string;
  adapter: string;
  configDigest: string;
  descriptor: unknown;
}

// ---- runs (plan 02-03) -------------------------------------------------------------------------------
// A run is a `runs` row whose state is one of RUN_STATES. The Phase 1 carrier rows (state `onboarding`) are
// not runs: no run method reads, lists or changes them.

export interface RunRow {
  runId: string;
  projectId: string;
  state: RunState;
  version: number;
  title: string;
  // The code of the entry into blocked_on_decision; null in every other state.
  reason: RunBlockedReason | null;
  workspacePath: string | null;
  branch: string | null;
  baseRevision: string | null;
  createdAt: string;
  updatedAt: string;
  leaseHolder: string | null;
  leaseExpiresAt: string | null;
  leaseFence: number;
}

export interface NewRun {
  runId: string;
  projectId: string;
  title: string;
  nowMs: number;
}

export interface RunTransitionInput {
  to: RunState;
  // Written to checkpoints.next_action.
  nextAction: string;
  nowMs: number;
  // Required when `to` is `blocked_on_decision`; refused otherwise.
  reason?: RunBlockedReason;
  revision?: string;
  // Recorded on the run row the first time they are known and kept afterwards.
  workspacePath?: string;
  branch?: string;
  baseRevision?: string;
  itemId?: string;
  attemptId?: string;
  // Extra event data: IDs, counts, digests and exit codes only.
  data?: Readonly<Record<string, unknown>>;
}

export interface RunCheckpointRow {
  checkpointId: string;
  runId: string;
  seq: number;
  attemptId: string | null;
  itemId: string | null;
  fromState: RunState | null;
  toState: RunState;
  revision: string | null;
  nextAction: string;
  createdAt: string;
}

export interface RunCheckpointInput {
  nextAction: string;
  nowMs: number;
  revision?: string;
  itemId?: string;
  attemptId?: string;
}

// A run contract is stored under the run's own ID (the `contracts` table is keyed by run_id).
export type StoreRunContractInput = Omit<StoreContractInput, 'runId'>;

export interface RunStepRow {
  runId: string;
  step: string;
  attempt: number;
  // One of RUN_STEP_STATUSES.
  status: string;
  result: unknown;
  startedAt: string;
  completedAt: string | null;
}

export interface RunAttemptInput {
  reason: string;
  nowMs: number;
}

export type EvidenceStatus = 'passed' | 'failed' | 'skipped' | 'unavailable' | 'inconclusive' | 'stale';
export type EvidenceIndependence = 'deterministic' | 'external' | 'model-review';

// One evidence item (docs/contracts-and-state.md "Evidence schema"). Rows are insert-only.
export interface EvidenceInput {
  attemptId: string;
  workItem?: string;
  kind: string;
  name: string;
  status: EvidenceStatus;
  revision: string;
  clean: boolean;
  treeDigest: string;
  environment: Readonly<Record<string, unknown>>;
  contractVersion: number;
  policyRevision: string;
  independence: EvidenceIndependence;
  acceptance: readonly string[];
  tests?: unknown;
  command?: readonly string[];
  exitCode?: number;
  durationMs?: number;
  artifactDigest?: string;
  nowMs: number;
}

export interface EvidenceRow {
  evidenceId: string;
  attemptId: string;
  // Read through the attempt.
  runId: string;
  workItem: string | null;
  kind: string;
  name: string;
  status: EvidenceStatus;
  revision: string;
  clean: boolean;
  treeDigest: string;
  environment: Readonly<Record<string, unknown>>;
  contractVersion: number;
  policyRevision: string;
  independence: EvidenceIndependence;
  acceptance: readonly string[];
  tests: unknown;
  command: readonly string[] | null;
  exitCode: number | null;
  durationMs: number | null;
  artifactDigest: string | null;
  createdAt: string;
}

export interface GateResultInput {
  runId: string;
  // G0 to G4.
  gate: string;
  workItem?: string;
  contractVersion: number;
  policyRevision: string;
  revision: string;
  passed: boolean;
  failures: readonly unknown[];
  nowMs: number;
}

export interface GateResultRow {
  runId: string;
  gate: string;
  workItem: string | null;
  contractVersion: number;
  policyRevision: string;
  revision: string;
  passed: boolean;
  failures: unknown;
  createdAt: string;
}

export type WorkItemType = 'implement' | 'harden';

export interface WorkItemInput {
  runId: string;
  itemId: string;
  type?: WorkItemType;
  dependsOn?: readonly string[];
  size: string;
  model: string;
  spec: unknown;
  gsdSession?: string;
  nowMs: number;
}

export interface WorkItemRow {
  runId: string;
  itemId: string;
  type: WorkItemType;
  dependsOn: readonly string[];
  size: string;
  model: string;
  spec: unknown;
  state: WorkItemState;
  gsdSession: string | null;
  // How many times the item was delegated.
  attempts: number;
}

export interface WorkItemTransitionInput {
  to: WorkItemState;
  nowMs: number;
  gsdSession?: string;
  attemptId?: string;
  // Extra event data: IDs, counts, digests and exit codes only.
  data?: Readonly<Record<string, unknown>>;
}

export type DecisionState = 'open' | 'answered' | 'stale' | 'withdrawn';
export type DecisionUrgency = 'blocking' | 'digest';

export interface DecisionInput {
  runId: string;
  contractVersion: number;
  // acceptance, architecture, scope_expansion, permission, repeated_failure, equivalent_mutant, contradiction or budget.
  class: string;
  issue: string;
  recommendation?: string;
  options: unknown;
  consequences: unknown;
  evidenceRefs: readonly string[];
  affectedItems: readonly string[];
  authorizedDefault?: string;
  stateDigest: string;
  urgency: DecisionUrgency;
  nowMs: number;
}

export interface DecisionRow {
  decisionId: string;
  runId: string;
  contractVersion: number;
  class: string;
  issue: string;
  recommendation: string | null;
  options: unknown;
  consequences: unknown;
  evidenceRefs: readonly string[];
  affectedItems: readonly string[];
  authorizedDefault: string | null;
  stateDigest: string;
  urgency: DecisionUrgency;
  state: DecisionState;
  openedAt: string;
  answeredAt: string | null;
  answeredBy: string | null;
  answer: string | null;
  answerChannel: string | null;
}

export interface CheckValidationInput {
  projectId: string;
  baseRevision: string;
  specDigest: string;
  name: string;
  verdict: string;
  detail: unknown;
  nowMs: number;
}

export interface CheckValidationRow {
  projectId: string;
  baseRevision: string;
  specDigest: string;
  name: string;
  verdict: string;
  detail: unknown;
  validatedAt: string;
}

// A row the PreToolUse hook recorded with its own SQL (the read-before-edit rule).
export interface HookReadRow {
  invocationId: string;
  agentId: string;
  path: string;
  digest: string;
  seq: number;
  recordedAt: string;
}

export interface Ledger {
  registerProject(input: NewProject): Result<ProjectRow>;
  findProject(query: ProjectQuery): Result<ProjectRow | null>;
  listProjects(): Result<ProjectRow[]>;

  createOnboarding(input: NewOnboarding): Result<OnboardingRow>;
  getOnboarding(onboardingId: string): Result<OnboardingRow>;
  // Oldest first. Without a project ID, every onboarding.
  listOnboardings(projectId?: string): Result<OnboardingRow[]>;

  acquireLease(onboardingId: string, holder: string, ttlMs: number, nowMs: number): Result<LeaseGrant>;
  renewLease(onboardingId: string, holder: string, fence: number, ttlMs: number, nowMs: number): Result<LeaseGrant>;
  releaseLease(onboardingId: string, holder: string, fence: number): Result<void>;

  transitionOnboarding(onboardingId: string, guard: TransitionGuard, t: TransitionInput): Result<OnboardingRow>;
  recordCheckpoint(onboardingId: string, guard: { fence: number }, input: CheckpointInput): Result<CheckpointRow>;
  latestCheckpoint(onboardingId: string): Result<CheckpointRow | null>;

  storeContract(onboardingId: string, guard: { fence: number }, input: StoreContractInput): Result<ContractRow>;
  getContract(onboardingId: string): Result<ContractRow | null>;

  recordStepResult(onboardingId: string, input: StepResultInput): Result<StepResultRow>;
  getStepResults(onboardingId: string): Result<StepResultRow[]>;
  recordAttempt(onboardingId: string, input: AttemptInput): Result<AttemptRow>;
  listAttempts(onboardingId: string): Result<AttemptRow[]>;

  insertRecordAndActivate(onboardingId: string, guard: TransitionGuard, input: ActivateInput): Result<ActivationResult>;
  getActiveRecord(projectId: string): Result<ActiveRecord | null>;

  // Budgets (CON-13). The rows are created from the contract and only ever grow in `used`: createBudgets leaves
  // an existing row untouched, and nothing refunds, resets or raises a limit (RC-5).
  createBudgets(runId: string, contractVersion: number, rows: readonly BudgetRowInput[]): Result<BudgetRow[]>;
  // One conditional UPDATE on `reserved`: it changes a row only while used + reserved + amount stays within the limit.
  reserveBudget(runId: string, name: string, amount: number): Result<BudgetReservation>;
  // Adds `amount` to `used`. With `fromReserved` the amount moves out of `reserved` first (a reservation settling);
  // without it the amount is charged directly (an estimated cost after the fact), and may pass the limit.
  chargeBudget(runId: string, name: string, amount: number, options: { fromReserved: boolean }): Result<BudgetRow>;
  getBudgets(runId: string): Result<BudgetRow[]>;
  // How many hook denials with rule `budget_exhausted` the invocation recorded.
  countBudgetDenials(runId: string, invocationId: string): Result<number>;
  // Every hook denial the invocation recorded (`total`), and how many of them were budget_exhausted (`budget`).
  countHookDenials(invocationId: string): Result<{ total: number; budget: number }>;

  appendEvent(input: EventInput): Result<EventReceipt>;
  recordArtifact(input: ArtifactInput): Result<void>;
  upsertAdapterConfig(input: AdapterConfigInput): Result<void>;

  // Runs. A new run is `contract_ready` at version 1 with no checkpoint and no lease (fence 0).
  createRun(input: NewRun): Result<RunRow>;
  getRun(runId: string): Result<RunRow>;
  // One transaction: the edge is checked against RUN_TRANSITIONS, the version and the lease fence are checked, the run row,
  // a checkpoint (seq = max + 1 for the run) and a `run.transition` event with the run ID are written together or not at all.
  transitionRun(runId: string, guard: TransitionGuard, t: RunTransitionInput): Result<RunRow>;
  // Oldest first, without Phase 1 onboarding carrier rows. Without a project ID, every run.
  listRuns(projectId?: string): Result<RunRow[]>;

  // Run leases mirror the onboarding leases: one UPDATE takes a free or strictly expired lease and bumps the fence;
  // renewal and release check holder and fence.
  acquireRunLease(runId: string, holder: string, ttlMs: number, nowMs: number): Result<LeaseGrant>;
  renewRunLease(runId: string, holder: string, fence: number, ttlMs: number, nowMs: number): Result<LeaseGrant>;
  releaseRunLease(runId: string, holder: string, fence: number): Result<void>;

  // A checkpoint without a state change (state and version stay). seq is continuous with the transitions' checkpoints.
  recordRunCheckpoint(runId: string, guard: { fence: number }, input: RunCheckpointInput): Result<RunCheckpointRow>;
  latestRunCheckpoint(runId: string): Result<RunCheckpointRow | null>;
  // Oldest first.
  listRunCheckpoints(runId: string): Result<RunCheckpointRow[]>;

  // The contract and its budget rows commit together; a version stored twice is a conflict.
  storeRunContract(runId: string, guard: { fence: number }, input: StoreRunContractInput): Result<ContractRow>;
  // The highest version, or null.
  getRunContract(runId: string): Result<ContractRow | null>;

  recordRunStep(runId: string, input: StepResultInput): Result<RunStepRow>;
  getRunSteps(runId: string): Result<RunStepRow[]>;

  // Attempts: ordinal 1, 2, ... per run. An attempt ends once, with an outcome.
  recordRunAttempt(runId: string, input: RunAttemptInput): Result<AttemptRow>;
  endRunAttempt(attemptId: string, input: { outcome: string; nowMs: number }): Result<AttemptRow>;
  listRunAttempts(runId: string): Result<AttemptRow[]>;

  // Evidence and gate results are insert-only (T-02-06, AUT-8): an interrupted check is marked by a new `inconclusive`
  // row, never by an UPDATE. The adapter refuses a status or independence outside the documented sets.
  recordEvidence(input: EvidenceInput): Result<EvidenceRow>;
  // Through the run's attempts, oldest first.
  listEvidence(runId: string): Result<EvidenceRow[]>;
  recordGateResult(input: GateResultInput): Result<void>;
  listGateResults(runId: string): Result<GateResultRow[]>;

  // Work items. An upsert never moves the state; transitionWorkItem applies assertItemTransition under the run's lease fence.
  upsertWorkItem(input: WorkItemInput): Result<WorkItemRow>;
  transitionWorkItem(runId: string, itemId: string, guard: { fence: number }, t: WorkItemTransitionInput): Result<WorkItemRow>;
  listWorkItems(runId: string): Result<WorkItemRow[]>;

  // Decisions open in state `open`; answering them is Phase 3.
  openDecision(input: DecisionInput): Result<DecisionRow>;
  // Oldest first.
  listDecisions(filter: { runId?: string; state?: DecisionState }): Result<DecisionRow[]>;

  // The validation verdict of one declared check (ONB-10), cached per project, base revision and spec digest.
  // A verdict is never overwritten: a second record for the same key is a conflict.
  recordCheckValidation(input: CheckValidationInput): Result<void>;
  getCheckValidations(projectId: string, baseRevision: string, specDigest: string): Result<CheckValidationRow[]>;

  // The rows of the hook's read-before-edit table for one invocation, by seq.
  listHookReads(invocationId: string): Result<HookReadRow[]>;
}
