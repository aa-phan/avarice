// Stage for `planning_ready`, after the index steps: store the accepted map documents and a snapshot
// manifest in the artifact store, build the project record from digests, paths and revisions (never document
// text, ONB-2) and insert it as the next immutable version while moving to `active`, in one transaction.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { canonicalJson } from '../../domain/digest.ts';
import { buildProjectRecord } from '../../domain/project-record.ts';
import type { CodebaseArtifact } from '../../domain/project-record.ts';
import type { OnboardingRow } from '../../ports/ledger.ts';
import type { Stage, StageContext } from './stage.ts';
import { effectiveMappingMode, loadContract, readMapDocuments, stagingPathOf } from './shared.ts';

const STORE = 'local';
const RETENTION = 'evidence';

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
  const mode = effectiveMappingMode(deps, row.onboardingId, contract.value.body);
  if (!mode.ok) return mode;
  const documents = readMapDocuments(deps.staging, staging.value, mode.value);
  if (!documents.ok) return documents;

  const nowMs = deps.clock.nowMs();
  const codebase: CodebaseArtifact[] = [];
  const manifestFiles: Array<{ path: string; digest: string; size: number; lastMappedCommit: string }> = [];
  for (const doc of documents.value) {
    if (doc.lastMappedCommit === null) {
      return err({ kind: 'internal', cause: `${doc.path} has no stamp at activation; validation should have refused it` });
    }
    const stored = deps.artifacts.put(Buffer.from(doc.text, 'utf8'), { kind: 'codebase-map', runId: contract.value.runId });
    if (!stored.ok) return stored;
    const recorded = deps.ledger.recordArtifact({
      digest: stored.value.digest,
      size: stored.value.size,
      kind: 'codebase-map',
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
  const manifestStored = deps.artifacts.put(Buffer.from(canonicalJson(manifest), 'utf8'), { kind: 'snapshot-manifest', runId: contract.value.runId });
  if (!manifestStored.ok) return manifestStored;
  const manifestRecorded = deps.ledger.recordArtifact({
    digest: manifestStored.value.digest,
    size: manifestStored.value.size,
    kind: 'snapshot-manifest',
    runId: contract.value.runId,
    retention: RETENTION,
    store: STORE,
    nowMs,
  });
  if (!manifestRecorded.ok) return manifestRecorded;

  const previous = deps.ledger.getActiveRecord(row.projectId);
  if (!previous.ok) return previous;

  // The version the contract stage recorded as step gsd:inspect.
  const steps = deps.ledger.getStepResults(row.onboardingId);
  if (!steps.ok) return steps;
  const inspected = steps.value.find((s) => s.step === 'gsd:inspect')?.result;
  const gsdVersion = typeof inspected === 'object' && inspected !== null && typeof (inspected as Record<string, unknown>)['version'] === 'string' ? ((inspected as Record<string, unknown>)['version'] as string) : undefined;

  const preflight = (typeof row.preflight === 'object' && row.preflight !== null ? row.preflight : {}) as Record<string, unknown>;
  const notMapped = Array.isArray(preflight['notMapped']) ? (preflight['notMapped'] as unknown[]).filter((n): n is string => typeof n === 'string') : [];
  const mapped = new Date(nowMs).toISOString();

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
    mapping: { mode: mode.value, scope: ['.'], mappedAt: mapped },
    notMapped,
    ...(gsdVersion !== undefined ? { gsdVersion } : {}),
  });

  const activated = ctx.activate(row, record as unknown as Readonly<Record<string, unknown>>);
  return activated.ok ? ok(undefined) : activated;
};
