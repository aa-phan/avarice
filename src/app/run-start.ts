// `avarice start` up to a stored contract (plan 02-10; RC-1, RC-2, RC-3, RC-5, FR-1, AUT-7). Resolves the project, reads the
// brief and the repository conventions (from git objects at a descendant of the pin, D-16), compiles the routine contract,
// runs the static G0 checks and stores run, contract version 1, budget rows and work item `A` in one transaction. Nothing is
// created before every check has passed, and running the command is the authorization: nothing here waits for input (RC-3).
// The brief and the conventions are data; neither is read as an instruction to AVARICE.
import { closeSync, constants, fstatSync, fsyncSync, mkdirSync, openSync, readSync, realpathSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { parseBrief } from '../domain/brief.ts';
import { parseConventions } from '../domain/conventions.ts';
import { canonicalJson } from '../domain/digest.ts';
import { judgeRunPreflight } from '../domain/run-preflight.ts';
import { compileRunContract, ROUTINE_POLICY } from '../domain/run-contract.ts';
import type { RunContract } from '../domain/run-contract.ts';
import type { PortError } from '../domain/result.ts';
import type { ActiveRecord, ProjectRow } from '../ports/ledger.ts';
import type { ConventionsAt } from '../ports/run-source.ts';
import { budgetRowsOfRun } from './budget.ts';
import type { AppDeps } from './deps.ts';

export const BRIEF_MAX_BYTES = 64 * 1024;

export interface RunStartRequest {
  // The directory `start` was run from; the project is the registered one whose repository contains it.
  cwd: string;
  // Names the project instead of the current directory.
  projectId?: string;
  briefPath: string;
  policy: string;
  // `--budget name=value`; validated by the compiler, which only lets a value go down.
  budgetOverrides: Readonly<Record<string, number>>;
}

export interface RunStartOutcome {
  runId: string;
  projectId: string;
  repoPath: string;
  head: string;
  conventionsRevision: string;
  commitsOutside: number;
  briefDigest: string;
  contract: RunContract;
  contractDigest: string;
  // `{dataRoot}/runs/<runId>/contract-v1.json`
  contractPath: string;
}

// `refused`: a rule of the start preflight (exit 3); `usage`: the request, the brief or the compiled contract is invalid (exit 64);
// `internal`: the ledger or the data root failed (exit 70).
export type RunStartFailure =
  | { kind: 'refused'; code: string; message: string }
  | { kind: 'usage'; field: string; message: string }
  | { kind: 'internal'; message: string };

export type RunStartResult = { ok: true; value: RunStartOutcome } | { ok: false; failure: RunStartFailure };

const refused = (code: string, message: string): RunStartResult => ({ ok: false, failure: { kind: 'refused', code, message } });
const usage = (field: string, message: string): RunStartResult => ({ ok: false, failure: { kind: 'usage', field, message } });
const internal = (message: string): RunStartResult => ({ ok: false, failure: { kind: 'internal', message } });

// The one-line text of a port error. (The adapters' own describeError is out of reach of the application layer.)
function describeError(error: PortError): string {
  switch (error.kind) {
    case 'invalid':
      return `invalid ${error.field}: ${error.reason}`;
    case 'conflict':
      return `conflict: expected ${error.expected}, found ${error.actual}`;
    case 'not_found':
      return `not found: ${error.ref}`;
    case 'unavailable':
      return `unavailable: ${error.cause}`;
    case 'internal':
      return `internal error: ${error.cause}`;
    case 'unsupported':
      return error.detail ?? `unsupported: ${error.capability}`;
    default:
      return error.kind;
  }
}

const DAY_MS = 86_400_000;
const GIT_PREFIX = /^git:/;

// A regular file of at most BRIEF_MAX_BYTES, decoded as strict UTF-8.
function readBriefFile(path: string): { ok: true; text: string } | { ok: false; reason: string } {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY);
  } catch (e) {
    return { ok: false, reason: `cannot be read (${(e as NodeJS.ErrnoException).code ?? 'error'})` };
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { ok: false, reason: 'is not a regular file' };
    if (stat.size > BRIEF_MAX_BYTES) return { ok: false, reason: `is larger than ${BRIEF_MAX_BYTES} bytes` };
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const n = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (n === 0) break;
      offset += n;
    }
    try {
      return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset)) };
    } catch {
      return { ok: false, reason: 'is not valid UTF-8' };
    }
  } finally {
    closeSync(fd);
  }
}

function canonicalOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

// The registered project whose repository contains `cwd` (the deepest one when repositories nest), or the one `--project` names.
function findProject(deps: AppDeps, request: RunStartRequest): { project: ProjectRow } | { message: string } | { error: string } {
  const listed = deps.ledger.listProjects();
  if (!listed.ok) return { error: describeError(listed.error) };
  if (request.projectId !== undefined) {
    const named = listed.value.find((p) => p.projectId === request.projectId);
    return named === undefined ? { message: `no registered project ${request.projectId}; register and onboard the repository first (avarice onboard --policy onboarding <repo>)` } : { project: named };
  }
  const here = canonicalOrSelf(resolve(request.cwd));
  let best: ProjectRow | undefined;
  for (const project of listed.value) {
    const root = canonicalOrSelf(project.repoPath);
    if (here === root || here.startsWith(root.endsWith(sep) ? root : root + sep)) {
      if (best === undefined || project.repoPath.length > best.repoPath.length) best = project;
    }
  }
  return best === undefined
    ? { message: `${request.cwd} is not inside a registered repository; onboard it first (avarice onboard --policy onboarding <repo>)` }
    : { project: best };
}

// Temp file, fsync, rename: a reader sees the whole contract or none, never half of it, and the file is 0600 in a 0700 directory
// of the data root (CON-6: the data root is outside every write root and inside every denyRead).
function writeContractFile(dataRoot: string, runId: string, text: string): string {
  const dir = join(dataRoot, 'runs', runId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = join(dir, 'contract-v1.json');
  const temp = join(dir, `.contract-v1.json.${process.pid}.tmp`);
  const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } catch (e) {
    closeSync(fd);
    try {
      unlinkSync(temp);
    } catch {
      // nothing to remove
    }
    throw e;
  }
  closeSync(fd);
  renameSync(temp, target);
  return target;
}

export function startRun(deps: AppDeps, request: RunStartRequest): RunStartResult {
  if (request.policy !== ROUTINE_POLICY) return usage('policy', `runs start under the "${ROUTINE_POLICY}" policy, not ${JSON.stringify(request.policy)}`);
  const runSource = deps.runSource;
  if (runSource === undefined) return internal('the run source is not composed');

  // The brief is untrusted data: parsed and validated, never obeyed.
  const read = readBriefFile(resolve(request.cwd, request.briefPath));
  if (!read.ok) return usage('brief', `brief ${request.briefPath} ${read.reason}`);
  const briefName = request.briefPath.split(/[\\/]/).pop() ?? 'brief';
  const brief = parseBrief(read.text, { kind: 'file', id: briefName });
  if (!brief.ok) return usage(brief.error.kind === 'invalid' ? brief.error.field : 'brief', describeError(brief.error));

  const found = findProject(deps, request);
  if ('error' in found) return internal(found.error);
  if ('message' in found) return refused('no-project', found.message);
  const { project } = found;
  const active = deps.ledger.getActiveRecord(project.projectId);
  if (!active.ok) return internal(describeError(active.error));
  const record: ActiveRecord | null = active.value;
  if (record === null) return refused('no-active-record', `${project.repoPath} has no active project record; onboard it first (avarice onboard --policy onboarding ${project.repoPath})`);
  const pin = record.onboardedRevision.replace(GIT_PREFIX, '');

  // The facts come from repository objects only (D-04, D-16): an uncommitted edit, a dirty checkout or a half-written file
  // cannot change an answer. Every rule is judged before anything is created.
  const nowMs = deps.clock.nowMs();
  const head = runSource.head(project.repoPath);
  if (!head.ok) return internal(describeError(head.error));
  const drift = runSource.staleness(project.repoPath, pin, head.value);
  // A pin that is no longer in the repository cannot be a base: the same answer as a history that does not lead from it.
  if (!drift.ok && drift.error.kind !== 'not_found') return internal(describeError(drift.error));
  const staleness = drift.ok ? drift.value : { descendant: false, commitsOutside: 0, oldestOutsideCommittedAtMs: null };

  let conventionsAt: ConventionsAt | null = null;
  let roadmapAtPin = false;
  if (staleness.descendant) {
    const found = runSource.conventionsAt(project.repoPath, pin, head.value);
    if (found.ok) conventionsAt = found.value;
    else if (found.error.kind === 'invalid') return refused('conventions-invalid', `.avarice/config.json is invalid: ${describeError(found.error)}`);
    else if (found.error.kind !== 'not_found') return internal(describeError(found.error));
    const roadmap = runSource.hasFile(project.repoPath, pin, '.planning/ROADMAP.md');
    if (!roadmap.ok) return internal(describeError(roadmap.error));
    roadmapAtPin = roadmap.value;
  }
  const verdict = judgeRunPreflight({
    pin,
    head: head.value,
    ...(brief.value.baseRevision !== undefined ? { briefBaseRevision: brief.value.baseRevision } : {}),
    staleness: {
      descendant: staleness.descendant,
      commitsOutside: staleness.commitsOutside,
      oldestOutsideAgeDays: staleness.oldestOutsideCommittedAtMs === null ? null : (nowMs - staleness.oldestOutsideCommittedAtMs) / DAY_MS,
    },
    conventions: conventionsAt === null ? 'not_found' : 'found',
    roadmapAtPin,
  });
  if (!verdict.ok) return refused(verdict.refusal.code, verdict.refusal.message);
  if (conventionsAt === null) return internal('conventions were found but are missing');
  const conventions = parseConventions(conventionsAt.text);
  if (!conventions.ok) return refused('conventions-invalid', `.avarice/config.json at ${conventionsAt.revision.slice(0, 7)} is invalid: ${describeError(conventions.error)}`);

  const runId = deps.ids.next('run_');
  const compiled = compileRunContract({
    runId,
    projectId: project.projectId,
    baseRevision: pin,
    conventionsRevision: conventionsAt.revision,
    brief: brief.value,
    conventions: conventions.value,
    nowIso: new Date(nowMs).toISOString(),
    policy: request.policy,
    ...(Object.keys(request.budgetOverrides).length > 0 ? { budgetOverrides: request.budgetOverrides } : {}),
  });
  if (!compiled.ok) return usage(compiled.error.kind === 'invalid' ? compiled.error.field : 'contract', describeError(compiled.error));
  const { contract, digest } = compiled.value;

  const item = contract.intent.workItems[0];
  if (item === undefined) return internal('the compiled contract has no work item');
  const created = deps.ledger.createRunWithContract({
    run: { runId, projectId: project.projectId, title: contract.intent.title, nowMs, baseRevision: pin, branch: contract.workspace.branch },
    contract: { digest, body: contract, policyRevision: contract.policyRevision, authorizedBy: 'cli:start', budgets: budgetRowsOfRun(contract), nowMs },
    workItems: [{ runId, itemId: item.id, type: 'implement', dependsOn: item.dependsOn, size: item.size, model: item.model, spec: item, nowMs }],
  });
  if (!created.ok) return internal(describeError(created.error));

  // The ledger holds the run now. A failure past this point leaves the run `contract_ready` without its file; the supervisor
  // (plan 02-12) rewrites the file from the ledger before it launches anything.
  let contractPath: string;
  try {
    contractPath = writeContractFile(deps.profile.dataRoot, runId, canonicalJson(contract));
  } catch (e) {
    return internal(`run ${runId} is stored but its contract file could not be written: ${e instanceof Error ? e.message : String(e)}`);
  }
  const step = deps.ledger.recordRunStep(runId, {
    step: 'start:preflight',
    status: 'completed',
    result: {
      pin,
      head: head.value,
      conventionsRevision: conventionsAt.revision,
      commitsOutside: staleness.commitsOutside,
      briefDigest: brief.value.digest,
    },
    nowMs,
    completedAtMs: nowMs,
  });
  if (!step.ok) return internal(`run ${runId} is stored but the start step could not be recorded: ${describeError(step.error)}`);

  return {
    ok: true,
    value: {
      runId,
      projectId: project.projectId,
      repoPath: project.repoPath,
      head: head.value,
      conventionsRevision: conventionsAt.revision,
      commitsOutside: staleness.commitsOutside,
      briefDigest: brief.value.digest,
      contract,
      contractDigest: digest,
      contractPath,
    },
  };
}
