// The checks pipeline of a run (plans 02-13 and 02-14; FR-5, FR-6, AUT-8, AUT-9, ONB-10, CON-8, D-11, D-12, T-02-41, T-02-45..48).
//
// Every command here is started by AVARICE through the CommandExecutor, never inside an invocation and never unsandboxed: the executor
// returns `unavailable` when there is no sandbox and then nothing is spawned.
//
//  - runRequiredChecks: each declared check that is required or targeted, AND has an `active` validation verdict (ONB-10), runs in a clone at
//    one of three phases (`base` before the unit, `item` on the working tree after it, `final` on the committed revision). The check may
//    write its declared paths and the run's scratch directory and nothing else (CON-8), cannot read the credential directories or the
//    data root, and has no network. One insert-only evidence row per check; a check that failed at base and at head is flagged
//    `preExisting` in its environment, never turned into another status (D-12).
import { mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkSpecDigest } from '../domain/conventions.ts';
import type { CheckSpec } from '../domain/conventions.ts';
import { sha256Hex } from '../domain/digest.ts';
import { evidenceStatusOf, revisionOf } from '../domain/evidence.ts';
import type { CheckOutcome, CommandResultStatus, EvidenceStatus } from '../domain/evidence.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { RunContract } from '../domain/run-contract.ts';
import type { RunRow } from '../ports/ledger.ts';
import type { AppDeps } from './deps.ts';

export type ChecksPhase = 'base' | 'item' | 'final';

// The label an evidence row carries in its environment: `g2` is the run of G2 (the working tree before the commit).
const PHASE_LABEL: Readonly<Record<ChecksPhase, string>> = { base: 'base', item: 'g2', final: 'final' };

export interface CheckRunResult {
  name: string;
  status: EvidenceStatus;
  evidenceId: string;
  exitCode: number | null;
  required: boolean;
  target: boolean;
}

export interface RunChecksOptions {
  // The clone the checks run in.
  cwd: string;
  attemptId: string;
  // `base` (before the unit, at the pin), `item` (the working tree after the unit, G2) or `final` (the committed revision, G4).
  phase: ChecksPhase;
  contractVersion: number;
  itemId?: string;
  // The outcomes recorded at base: a check that failed there and fails again, and is not a brief target, is flagged `preExisting`.
  base?: readonly CheckOutcome[];
  // Called after each check's evidence row is stored (the kill point `mid-verify` fires after the first).
  afterEach?: (index: number) => void;
}

const STORE = 'local';
const RUN_RETENTION = 'run';
const OUTPUT_KIND = 'check-output';
const INVENTORY_KIND = 'test-inventory';
const WILDCARD = /[*?[{]/;

// The directory (or file) a check's `writes` glob names: its segments before the first wildcard. A glob with none names the path itself;
// one that starts with a wildcard names nothing the sandbox could allow narrowly, so it names nothing.
export function writePathOf(cwd: string, glob: string): string | null {
  const segments = glob.split('/');
  const wild = segments.findIndex((segment) => WILDCARD.test(segment));
  const prefix = wild === -1 ? segments : segments.slice(0, wild);
  if (prefix.length === 0 || prefix.some((segment) => segment === '' || segment === '.' || segment === '..')) return null;
  return join(cwd, ...prefix);
}

export function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

// The checks to run, in declaration order: every required check and every target check.
export function checksToRun(contract: RunContract): Array<{ spec: RunContract['execution']['checks'][number]; required: boolean; target: boolean }> {
  const required = new Set(contract.verification.requiredChecks);
  const targets = new Set(contract.verification.targetChecks);
  return contract.execution.checks.filter((check) => required.has(check.name) || targets.has(check.name)).map((spec) => ({ spec, required: required.has(spec.name), target: targets.has(spec.name) }));
}

// ---- the sandbox every check, install and list command runs in -----------------------------------------------------------------

interface SandboxSetup {
  // The run's scratch directory, symlink-resolved: HOME, TMPDIR and the npm cache of every command AVARICE runs.
  scratch: string;
  env: Record<string, string>;
  denyReadPaths: string[];
}

export function sandboxSetup(deps: AppDeps, run: RunRow): Result<SandboxSetup> {
  const scratch = join(canonical(deps.profile.workRoot), run.runId, 'scratch');
  try {
    mkdirSync(join(scratch, 'npm-cache'), { recursive: true, mode: 0o700 });
  } catch (cause) {
    return err({ kind: 'internal', cause: `the scratch directory of run ${run.runId} could not be created: ${cause instanceof Error ? cause.message : String(cause)}` });
  }
  const scratchReal = canonical(scratch);
  const home = canonical(deps.home ?? homedir());
  const path = [dirname(process.execPath), process.env['PATH'] ?? '/usr/bin:/bin'].join(':');
  return ok({
    scratch: scratchReal,
    env: { PATH: path, HOME: scratchReal, TMPDIR: scratchReal, npm_config_cache: join(scratchReal, 'npm-cache'), CI: '1', LANG: 'C' },
    denyReadPaths: [join(home, '.ssh'), join(home, '.aws'), join(home, '.config/gh'), canonical(deps.profile.dataRoot)],
  });
}

// The revision every row of one pass names: the commit when the tree is clean, else a digest of the working tree.
interface CloneRevision {
  revision: string;
  clean: boolean;
  treeDigest: string;
}

export function cloneRevision(deps: AppDeps, cwd: string): Result<CloneRevision> {
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  const head = workspace.head(cwd);
  if (!head.ok) return head;
  const status = workspace.status(cwd);
  if (!status.ok) return status;
  const snapshot = workspace.snapshot(cwd);
  if (!snapshot.ok) return snapshot;
  const clean = status.value.length === 0;
  const treeDigest = sha256Hex(`git-tree:${snapshot.value.tree}`);
  const revision = revisionOf({ head: head.value, clean, treeDigest });
  if (!revision.ok) return revision;
  return ok({ revision: revision.value, clean, treeDigest });
}

// ---- validation verdicts (ONB-10) ----------------------------------------------------------------------------------------------

export interface CachedVerdict {
  verdict: string;
  detail: unknown;
}

// A verdict is cached per project, pin, check name and the digest of that one check's spec (name, argv, timeout, env, writes), so a change
// to one check's argv in a later conventions commit re-validates that check and no other.
export function verdictKey(spec: CheckSpec): string {
  return checkSpecDigest([spec]);
}

export function cachedVerdicts(deps: AppDeps, run: RunRow, contract: RunContract): Result<Map<string, CachedVerdict>> {
  const found = new Map<string, CachedVerdict>();
  for (const spec of contract.execution.checks) {
    const rows = deps.ledger.getCheckValidations(run.projectId, contract.workspace.baseRevision, verdictKey(spec));
    if (!rows.ok) return rows;
    const row = rows.value.find((r) => r.name === spec.name && (r.verdict === 'active' || r.verdict === 'rejected'));
    if (row !== undefined) found.set(spec.name, { verdict: row.verdict, detail: row.detail });
  }
  return ok(found);
}

// ---- required checks -----------------------------------------------------------------------------------------------------------

export async function runRequiredChecks(deps: AppDeps, run: RunRow, contract: RunContract, options: RunChecksOptions): Promise<Result<CheckRunResult[]>> {
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  const cwd = canonical(options.cwd);

  const where = cloneRevision(deps, cwd);
  if (!where.ok) return where;
  const sandbox = sandboxSetup(deps, run);
  if (!sandbox.ok) return sandbox;

  // A check that has not passed active validation is never run (ONB-10): a required one is then `missing` in the delta and blocks.
  const verdicts = cachedVerdicts(deps, run, contract);
  if (!verdicts.ok) return verdicts;
  const baseStatus = new Map((options.base ?? []).map((outcome) => [outcome.name, outcome.status]));
  const label = PHASE_LABEL[options.phase];

  const results: CheckRunResult[] = [];
  for (const { spec, required, target } of checksToRun(contract)) {
    if (verdicts.value.get(spec.name)?.verdict !== 'active') continue;
    const writePaths = [sandbox.value.scratch, ...spec.writes.flatMap((glob) => {
      const writable = writePathOf(cwd, glob);
      return writable === null ? [] : [writable];
    })];
    const ran = await deps.executor.run({
      argv: spec.argv,
      cwd,
      env: { ...spec.env, ...sandbox.value.env },
      timeoutMs: spec.timeoutSec * 1000,
      invocationId: deps.ids.next('inv_'),
      writePaths,
      denyReadPaths: sandbox.value.denyReadPaths,
    });

    let commandStatus: CommandResultStatus;
    let exitCode: number | null = null;
    let durationMs = 0;
    let output = '';
    let detail: Record<string, unknown> = {};
    if (ran.ok) {
      commandStatus = ran.value.status;
      exitCode = ran.value.exitCode;
      durationMs = ran.value.durationMs;
      output = `$ ${spec.argv.join(' ')}\n--- stdout ---\n${ran.value.stdout}\n--- stderr ---\n${ran.value.stderr}\n`;
      detail = { truncated: ran.value.truncated, ...(ran.value.signal !== null ? { signal: ran.value.signal } : {}) };
    } else if (ran.error.kind === 'unavailable') {
      commandStatus = 'sandbox_unavailable';
      output = `$ ${spec.argv.join(' ')}\nnot run: ${ran.error.cause}\n`;
    } else {
      return ran;
    }

    const stored = deps.artifacts.put(new TextEncoder().encode(output), { kind: OUTPUT_KIND, runId: run.runId });
    if (!stored.ok) return stored;
    const recorded = deps.ledger.recordArtifact({ digest: stored.value.digest, size: stored.value.size, kind: OUTPUT_KIND, runId: run.runId, retention: RUN_RETENTION, store: STORE, nowMs: deps.clock.nowMs() });
    if (!recorded.ok) return recorded;

    const evidenceStatus = evidenceStatusOf(commandStatus);
    // D-12: failed at base and failed again, not a brief target: a flag on the failed row, never another status.
    const preExisting = evidenceStatus === 'failed' && baseStatus.get(spec.name) === 'failed' && !target;
    const evidence = deps.ledger.recordEvidence({
      attemptId: options.attemptId,
      ...(options.itemId !== undefined ? { workItem: options.itemId } : {}),
      kind: 'check',
      name: spec.name,
      status: evidenceStatus,
      revision: where.value.revision,
      clean: where.value.clean,
      treeDigest: where.value.treeDigest,
      environment: { kind: contract.execution.environment, sandbox: 'seatbelt', label, phase: options.phase, node: process.version, ...detail, ...(preExisting ? { preExisting: true } : {}) },
      contractVersion: options.contractVersion,
      policyRevision: contract.policyRevision,
      independence: 'deterministic',
      acceptance: contract.intent.acceptance.filter((a) => a.verifiedBy.includes(`check:${spec.name}`)).map((a) => a.id),
      command: spec.argv,
      ...(exitCode !== null ? { exitCode } : {}),
      durationMs,
      artifactDigest: stored.value.digest,
      nowMs: deps.clock.nowMs(),
    });
    if (!evidence.ok) return evidence;
    const event = deps.ledger.appendEvent({
      type: 'check.finished',
      runId: run.runId,
      attemptId: options.attemptId,
      data: { runId: run.runId, attemptId: options.attemptId, name: spec.name, label, status: evidenceStatus, exitCode, durationMs, evidenceId: evidence.value.evidenceId, ...(preExisting ? { preExisting: true } : {}) },
      nowMs: deps.clock.nowMs(),
    });
    if (!event.ok) return event;

    results.push({ name: spec.name, status: evidenceStatus, evidenceId: evidence.value.evidenceId, exitCode, required, target });
    options.afterEach?.(results.length - 1);
  }
  return ok(results);
}

// The check outcomes recorded at base (D-12), read from the ledger so a later stage, or a resumed one, judges against the same facts. A
// check measured more than once (a baseline repeated after a kill) counts by its latest row.
export function recordedBase(deps: AppDeps, runId: string): Result<CheckOutcome[]> {
  const evidence = deps.ledger.listEvidence(runId);
  if (!evidence.ok) return evidence;
  const latest = new Map<string, CheckOutcome>();
  for (const row of evidence.value) {
    if (row.kind === 'check' && row.environment['label'] === PHASE_LABEL.base) latest.set(row.name, { name: row.name, status: row.status, evidenceId: row.evidenceId });
  }
  return ok([...latest.values()]);
}

// The names of the checks that failed at base and at head and are flagged pre-existing in the evidence of one revision (T-02-48).
export function preExistingAt(deps: AppDeps, runId: string, revision: string): Result<string[]> {
  const evidence = deps.ledger.listEvidence(runId);
  if (!evidence.ok) return evidence;
  return ok([...new Set(evidence.value.filter((row) => row.kind === 'check' && row.revision === revision && row.environment['preExisting'] === true).map((row) => row.name))].sort());
}

