// Stage for `planning_ready`, after the index steps: store the accepted map documents and a snapshot
// manifest in the artifact store, build the project record from digests, paths and revisions (never document
// text, ONB-2) and insert it as the next immutable version while moving to `active`, in one transaction.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { canonicalJson } from '../../domain/digest.ts';
import { narrowProposals, PROFILE_POLICY } from '../../domain/policy-narrowing.ts';
import type { NarrowedProposals } from '../../domain/policy-narrowing.ts';
import { buildProjectRecord, foldIndexResults } from '../../domain/project-record.ts';
import type { CodebaseArtifact, RecordFinding } from '../../domain/project-record.ts';
import { AVARICE_TRACKED_WRITABLE, scopeViolationsOf, writeSetsFor } from '../../domain/validation.ts';
import type { OnboardingRow } from '../../ports/ledger.ts';
import { loadIndexResults } from './index-steps.ts';
import type { Stage, StageContext } from './stage.ts';
import { effectiveMappingMode, loadAcceptedValidation, loadContract, readMapDocuments, stagingPathOf } from './shared.ts';

const STORE = 'local';
// Artifacts of an onboarding live as long as the record that references them (docs/contracts-and-state.md
// "Retention, export and import").
const RETENTION = 'onboarding';
// Where a repository proposes record values; read from staging at the pin, as data (never executed).
const PROPOSAL_PATH = '.avarice/config.json';
const MAX_PROPOSAL_BYTES = 65536;
const MAX_FINDINGS = 50;
const MAX_DETAIL = 200;
const MAX_PATHS_IN_EVENT = 20;

const clip = (text: string): string => (text.length <= MAX_DETAIL ? text : `${text.slice(0, MAX_DETAIL - 1)}…`);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// The repository's proposal after narrowing against the profile policy, with a finding for everything refused.
function narrowRepositoryProposal(ctx: StageContext, staging: string): Result<{ narrowed: NarrowedProposals; findings: RecordFinding[] }> {
  const narrowed: NarrowedProposals = { accepted: { paths: {}, commands: [] }, rejected: [] };
  const finding = (reason: string): RecordFinding => ({ source: 'narrowing', field: PROPOSAL_PATH, reason });
  const read = ctx.deps.staging.read(staging, PROPOSAL_PATH, MAX_PROPOSAL_BYTES);
  if (!read.ok) {
    if (read.error.kind === 'invalid') return ok({ narrowed, findings: [finding(read.error.field === 'size' ? 'too-large' : 'unreadable')] });
    return read;
  }
  if (read.value === null) return ok({ narrowed, findings: [] });
  let parsed: unknown;
  try {
    parsed = JSON.parse(read.value);
  } catch {
    return ok({ narrowed, findings: [finding('invalid-json')] });
  }
  const result = narrowProposals(PROFILE_POLICY, parsed);
  return ok({
    narrowed: result,
    findings: result.rejected.map((r) => ({ source: 'narrowing' as const, field: r.field, reason: r.reason, detail: r.value })),
  });
}

// An earlier attempt that validation rejected and a remap then fixed is part of the record's history.
function validationFindings(steps: ReadonlyArray<{ step: string; attempt: number; status: string; result: unknown }>): RecordFinding[] {
  const findings: RecordFinding[] = [];
  for (const step of steps) {
    if (step.step !== 'validate' || step.status !== 'rejected' || !isObject(step.result) || !Array.isArray(step.result['checks'])) continue;
    for (const check of step.result['checks']) {
      if (!isObject(check) || check['passed'] !== false || typeof check['name'] !== 'string') continue;
      findings.push({
        source: 'validation',
        field: check['name'],
        reason: `rejected on attempt ${step.attempt}, accepted after a remap`,
        ...(typeof check['detail'] === 'string' ? { detail: clip(check['detail']) } : {}),
      });
    }
  }
  return findings;
}

// GSD settings AVARICE applied in staging, as the record states them: `{ commit_docs: false, ... }`.
function appliedConfig(result: unknown): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  const applied = isObject(result) && Array.isArray(result['applied']) ? result['applied'] : [];
  for (const entry of applied) {
    if (!isObject(entry) || typeof entry['key'] !== 'string' || typeof entry['value'] !== 'string') continue;
    const value = entry['value'];
    config[entry['key']] = value === 'true' ? true : value === 'false' ? false : value;
  }
  return config;
}

// The last look at the staging tree before a record is built (T-01-67): the whole diff against the pin must lie inside
// the union of the write sets of every invocation that ran and AVARICE's own, whoever wrote it and whenever. Validation
// judged the diff before the index steps; this judges it after, so a write by an index step or a late invocation
// cannot reach an active record. A violation is a containment finding, and the onboarding blocks.
function scopeCheck(ctx: StageContext, row: OnboardingRow, staging: string, pin: string, runId: string, files: Parameters<typeof writeSetsFor>[0]): Result<string[]> {
  const { deps } = ctx;
  const changes = deps.staging.changes(staging, pin);
  if (!changes.ok) return changes;
  const tracked = deps.staging.listTracked(staging, pin);
  if (!tracked.ok) return tracked;
  const steps = deps.ledger.getStepResults(row.onboardingId);
  if (!steps.ok) return steps;
  const purposesRun = steps.value.filter((s) => s.step.startsWith('launch:')).map((s) => s.step.slice('launch:'.length));
  const sets = writeSetsFor(files, purposesRun);
  const violations = scopeViolationsOf(changes.value, tracked.value, sets.allowedWrite, [...sets.trackedWritable, ...AVARICE_TRACKED_WRITABLE]);
  if (violations.length > 0) {
    const finding = deps.ledger.appendEvent({
      type: 'containment.finding',
      level: 'warn',
      runId,
      data: {
        onboardingId: row.onboardingId,
        check: 'activation-scope',
        count: violations.length,
        paths: violations.slice(0, MAX_PATHS_IN_EVENT).map(clip),
      },
      nowMs: deps.clock.nowMs(),
    });
    if (!finding.ok) return finding;
  }
  return ok(violations);
}

export const activateStage: Stage = (ctx: StageContext, row: OnboardingRow): Result<void> => {
  const { deps } = ctx;
  const contract = loadContract(deps, row.onboardingId);
  if (!contract.ok) return contract;
  const staging = stagingPathOf(row);
  if (!staging.ok) return staging;
  const project = deps.ledger.findProject({ projectId: row.projectId });
  if (!project.ok) return project;
  if (project.value === null) return err({ kind: 'not_found', ref: `project ${row.projectId}` });

  const head = deps.staging.head(staging.value);
  if (!head.ok) return head;
  const violations = scopeCheck(ctx, row, staging.value, contract.value.body.workspace.baseRevision, contract.value.runId, contract.value.body.files);
  if (!violations.ok) return violations;
  if (violations.value.length > 0) {
    ctx.note(`${violations.value.length} path(s) in the staging tree lie outside every write set (${violations.value.slice(0, 5).map(clip).join(', ')}); the project cannot be activated`);
    const blocked = ctx.transition(row, 'blocked', 'none', { reason: 'enforcement_failure', data: { check: 'activation-scope', count: violations.value.length } });
    return blocked.ok ? ok(undefined) : blocked;
  }
  const mode = effectiveMappingMode(deps, row.onboardingId, contract.value.body);
  if (!mode.ok) return mode;
  const documents = readMapDocuments(deps.staging, staging.value, mode.value);
  if (!documents.ok) return documents;
  // The coverage scope is what validation judged (ONB-7): the four files for a fast map, `.` for a full one.
  const validated = loadAcceptedValidation(deps, row.onboardingId);
  if (!validated.ok) return validated;
  // Repository proposals can only narrow the record's authority (ONB-9); decided before anything is stored.
  const proposal = narrowRepositoryProposal(ctx, staging.value);
  if (!proposal.ok) return proposal;

  const nowMs = deps.clock.nowMs();
  const codebase: CodebaseArtifact[] = [];
  const manifestFiles: Array<{ path: string; digest: string; size: number; lastMappedCommit: string }> = [];
  for (const doc of documents.value) {
    if (doc.lastMappedCommit === null) {
      return err({ kind: 'internal', cause: `${doc.path} has no stamp at activation; validation should have refused it` });
    }
    const stored = deps.artifacts.put(Buffer.from(doc.text, 'utf8'), { kind: 'map-document', runId: contract.value.runId });
    if (!stored.ok) return stored;
    const recorded = deps.ledger.recordArtifact({
      digest: stored.value.digest,
      size: stored.value.size,
      kind: 'map-document',
      runId: contract.value.runId,
      retention: RETENTION,
      store: STORE,
      nowMs,
    });
    if (!recorded.ok) return recorded;
    codebase.push({ path: doc.path, digest: stored.value.digest, lastMappedCommit: doc.lastMappedCommit });
    manifestFiles.push({ path: doc.path, digest: stored.value.digest, size: stored.value.size, lastMappedCommit: doc.lastMappedCommit });
  }

  const manifest = { schema: 1, onboardingId: row.onboardingId, stagingHead: head.value, files: manifestFiles };
  const manifestStored = deps.artifacts.put(Buffer.from(canonicalJson(manifest), 'utf8'), { kind: 'map-snapshot', runId: contract.value.runId });
  if (!manifestStored.ok) return manifestStored;
  const manifestRecorded = deps.ledger.recordArtifact({
    digest: manifestStored.value.digest,
    size: manifestStored.value.size,
    kind: 'map-snapshot',
    runId: contract.value.runId,
    retention: RETENTION,
    store: STORE,
    nowMs,
  });
  if (!manifestRecorded.ok) return manifestRecorded;

  const previous = deps.ledger.getActiveRecord(row.projectId);
  if (!previous.ok) return previous;

  // What earlier steps recorded: GSD's identity and capabilities (gsd:inspect), the settings applied in staging
  // (gsd:configure) and any rejected validation attempt.
  const steps = deps.ledger.getStepResults(row.onboardingId);
  if (!steps.ok) return steps;
  const inspected = steps.value.find((s) => s.step === 'gsd:inspect')?.result;
  const inspectedBody = isObject(inspected) ? inspected : {};
  const gsdVersion = typeof inspectedBody['version'] === 'string' ? inspectedBody['version'] : undefined;
  const capabilities = Array.isArray(inspectedBody['capabilities']) ? inspectedBody['capabilities'].filter((c): c is string => typeof c === 'string') : [];
  const configured = [...steps.value].reverse().find((s) => s.step === 'gsd:configure')?.result;

  const preflight = isObject(row.preflight) ? row.preflight : {};
  const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((n): n is string => typeof n === 'string') : []);
  const indexResults = loadIndexResults(deps, row.onboardingId);
  if (!indexResults.ok) return indexResults;
  const mapped = new Date(nowMs).toISOString();
  const findings = [...validationFindings(steps.value), ...proposal.value.findings].slice(0, MAX_FINDINGS);

  const record = buildProjectRecord({
    projectId: row.projectId,
    recordVersion: previous.value === null ? 1 : previous.value.version + 1,
    repository: {
      rootCommit: project.value.rootCommit,
      remote: project.value.remote,
      defaultBranch: project.value.defaultBranch ?? 'unknown',
    },
    onboardedAt: `git:${contract.value.body.workspace.baseRevision}`,
    profile: deps.profile.profile,
    stagingPath: staging.value,
    codebase,
    snapshot: manifestStored.value.digest,
    mapping: { mode: mode.value, scope: validated.value?.scope ?? ['.'], mappedAt: mapped },
    notMapped: strings(preflight['notMapped']),
    ...(gsdVersion !== undefined ? { gsdVersion } : {}),
    gsd: { config: appliedConfig(configured), capabilities },
    existingState: isObject(preflight['existingState']) ? preflight['existingState'] : {},
    instructionFiles: strings(preflight['instructionFiles']),
    findings,
    contract: { runId: contract.value.runId, version: contract.value.version, digest: contract.value.digest },
    paths: proposal.value.narrowed.accepted.paths,
    commands: proposal.value.narrowed.accepted.commands,
    indexes: foldIndexResults(indexResults.value),
  });

  const activated = ctx.activate(row, record as unknown as Readonly<Record<string, unknown>>);
  return activated.ok ? ok(undefined) : activated;
};
