// The required checks of a run (plan 02-13; FR-5, FR-6, T-02-41). Each declared check that is required, or that the brief targets, runs as
// a sandboxed subprocess started by AVARICE through the CommandExecutor, never inside an invocation and never unsandboxed: the executor
// returns `unavailable` when there is no sandbox and then nothing is spawned. The check may write its own declared paths and the run's
// scratch directory and nothing else, cannot read the credential directories or the data root, and has no network. Its output is
// stored as one artifact; its result becomes one insert-only evidence row naming the command, exit code, duration, status, revision
// and environment. A check the sandbox could not run is `unavailable`, a timeout `inconclusive` (evidenceStatusOf), never `passed`.
import { mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { sha256Hex } from '../domain/digest.ts';
import { evidenceStatusOf, revisionOf } from '../domain/evidence.ts';
import type { CommandResultStatus, EvidenceStatus } from '../domain/evidence.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { RunContract } from '../domain/run-contract.ts';
import type { RunRow } from '../ports/ledger.ts';
import type { AppDeps } from './deps.ts';

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
  // What the run is doing: `g2` (the working tree before the commit) or `final` (the committed revision).
  label: string;
  contractVersion: number;
  itemId?: string;
  // Called after each check's evidence row is stored (the kill point `mid-verify` fires after the first).
  afterEach?: (index: number) => void;
}

const STORE = 'local';
const RUN_RETENTION = 'run';
const OUTPUT_KIND = 'check-output';
const WILDCARD = /[*?[{]/;

// The directory (or file) a check's `writes` glob names: its segments before the first wildcard. A glob with none names the path itself;
// one that starts with a wildcard names nothing the sandbox could allow narrowly, so it names nothing.
function writePathOf(cwd: string, glob: string): string | null {
  const segments = glob.split('/');
  const wild = segments.findIndex((segment) => WILDCARD.test(segment));
  const prefix = wild === -1 ? segments : segments.slice(0, wild);
  if (prefix.length === 0 || prefix.some((segment) => segment === '' || segment === '.' || segment === '..')) return null;
  return join(cwd, ...prefix);
}

function canonical(path: string): string {
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

export async function runRequiredChecks(deps: AppDeps, run: RunRow, contract: RunContract, options: RunChecksOptions): Promise<Result<CheckRunResult[]>> {
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  const cwd = canonical(options.cwd);

  // The revision every row of this run of checks names: the commit when the tree is clean, else a digest of the working tree.
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

  const scratch = join(canonical(deps.profile.workRoot), run.runId, 'scratch');
  try {
    mkdirSync(join(scratch, 'npm-cache'), { recursive: true, mode: 0o700 });
  } catch (cause) {
    return err({ kind: 'internal', cause: `the scratch directory of run ${run.runId} could not be created: ${cause instanceof Error ? cause.message : String(cause)}` });
  }
  const scratchReal = canonical(scratch);
  const home = canonical(deps.home ?? homedir());
  const denyReadPaths = [join(home, '.ssh'), join(home, '.aws'), join(home, '.config/gh'), canonical(deps.profile.dataRoot)];
  const path = [dirname(process.execPath), process.env['PATH'] ?? '/usr/bin:/bin'].join(':');

  const results: CheckRunResult[] = [];
  for (const { spec, required, target } of checksToRun(contract)) {
    const writePaths = [scratchReal, ...spec.writes.flatMap((glob) => {
      const writable = writePathOf(cwd, glob);
      return writable === null ? [] : [writable];
    })];
    const ran = await deps.executor.run({
      argv: spec.argv,
      cwd,
      env: { ...spec.env, PATH: path, HOME: scratchReal, TMPDIR: scratchReal, npm_config_cache: join(scratchReal, 'npm-cache'), CI: '1', LANG: 'C' },
      timeoutMs: spec.timeoutSec * 1000,
      invocationId: deps.ids.next('inv_'),
      writePaths,
      denyReadPaths,
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
    const evidence = deps.ledger.recordEvidence({
      attemptId: options.attemptId,
      ...(options.itemId !== undefined ? { workItem: options.itemId } : {}),
      kind: 'check',
      name: spec.name,
      status: evidenceStatus,
      revision: revision.value,
      clean,
      treeDigest,
      environment: { kind: contract.execution.environment, sandbox: 'seatbelt', label: options.label, node: process.version, ...detail },
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
      data: { runId: run.runId, attemptId: options.attemptId, name: spec.name, label: options.label, status: evidenceStatus, exitCode, durationMs, evidenceId: evidence.value.evidenceId },
      nowMs: deps.clock.nowMs(),
    });
    if (!event.ok) return event;

    results.push({ name: spec.name, status: evidenceStatus, evidenceId: evidence.value.evidenceId, exitCode, required, target });
    options.afterEach?.(results.length - 1);
  }
  return ok(results);
}
