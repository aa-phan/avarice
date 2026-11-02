// Ledger port (docs/contracts-and-state.md "Persisted entities", "Concurrency control"; SKELETON.md "Ports").
// The onboarding subset plus the budget methods (plan 01-12). Every method returns a Result and never
// throws across the boundary. Every state-changing method is one atomic unit: either all of its rows
// are written or none are (NFR-6, NFR-9). Times are epoch milliseconds passed in by the caller, so the
// adapter reads no clock.
import type { Result } from '../domain/result.ts';
import type { BlockedReason, OnboardingState } from '../domain/onboarding-lifecycle.ts';

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

  appendEvent(input: EventInput): Result<EventReceipt>;
  recordArtifact(input: ArtifactInput): Result<void>;
  upsertAdapterConfig(input: AdapterConfigInput): Result<void>;
}
