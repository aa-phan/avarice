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
//  - installDependencies: the conventions' install command, in the clone, with network only to an allowlisting proxy on loopback whose
//    allowlist is the registry hosts on 443 (D-11). Agent invocations never get the proxy.
//  - measureInventory: the test inventory (the list command's IDs, skip and focus markers, the test file count), measured by AVARICE after
//    an invocation has ended, never from what the model said (AUT-9).
import { mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkSpecDigest } from '../domain/conventions.ts';
import type { CheckSpec } from '../domain/conventions.ts';
import { digestOf, sha256Hex } from '../domain/digest.ts';
import { evidenceStatusOf, revisionOf } from '../domain/evidence.ts';
import type { CheckOutcome, CommandResultStatus, EvidenceStatus } from '../domain/evidence.ts';
import { matchesAny } from '../domain/glob.ts';
import { credentialPaths, defaultAvariceParents } from '../domain/invocation-scope.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { RunContract } from '../domain/run-contract.ts';
import type { RunBlockedReason } from '../domain/run-lifecycle.ts';
import { redactSecrets } from '../domain/secret-patterns.ts';
import { scanMarkers } from '../domain/test-inventory.ts';
import type { InventorySnapshot } from '../domain/test-inventory.ts';
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
  // Re-allowed below a denied parent: the command's working tree and the run's scratch directory, nothing else under the work root.
  allowReadPaths: string[];
}

// `cwd` is the working tree the command runs in (the run's clone, the validation clone or the baseline clone): the only part of the work
// root, besides the scratch directory, a command may read. The default parents of every profile's roots are denied (plan 02-20): another
// profile's data root, config and run clones are out of reach; a profile placed elsewhere by an environment variable is not covered.
export function sandboxSetup(deps: AppDeps, run: RunRow, cwd: string): Result<SandboxSetup> {
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
    denyReadPaths: [...credentialPaths(home), canonical(deps.profile.dataRoot), ...defaultAvariceParents(home)],
    allowReadPaths: [canonical(cwd), scratchReal],
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
  const sandbox = sandboxSetup(deps, run, cwd);
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
      allowReadPaths: sandbox.value.allowReadPaths,
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

    // A check's output is repository-controlled text that the owner reads: secret-shaped strings are redacted before it is stored, as transcripts are.
    const stored = deps.artifacts.put(new TextEncoder().encode(redactSecrets(output)), { kind: OUTPUT_KIND, runId: run.runId });
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


// ---- the dependency install (D-11, T-02-47) ------------------------------------------------------------------------------------

export interface InstallAttempt {
  host: string;
  port: number;
  allowed: boolean;
  count: number;
}

export interface InstallFailure {
  reason: RunBlockedReason;
  decisionClass: 'permission' | 'repeated_failure';
  issue: string;
}

export interface InstallResult {
  // `skipped`: the conventions declare no dependency install.
  outcome: 'installed' | 'skipped' | 'failed';
  reason?: string;
  lockfile?: string;
  lockfileDigest?: string;
  exitCode?: number | null;
  durationMs?: number;
  attempts: InstallAttempt[];
  failure?: InstallFailure;
}

const INSTALL_TIMEOUT_MS = 15 * 60_000;
const LOCKFILE_MAX_BYTES = 32 * 1024 * 1024;
const MAX_ATTEMPT_ROWS = 20;

function groupAttempts(raw: ReadonlyArray<{ host: string; port: number; allowed: boolean }>): InstallAttempt[] {
  const groups = new Map<string, InstallAttempt>();
  for (const a of raw) {
    const key = `${a.host}:${a.port}:${a.allowed}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { host: a.host, port: a.port, allowed: a.allowed, count: 1 });
    else group.count += 1;
  }
  return [...groups.values()].slice(0, MAX_ATTEMPT_ROWS);
}

// Runs the conventions' install command in `clonePath`. The only network is one loopback port, in front of which an allowlisting proxy
// admits `<registry host>:443` for each registry host of the conventions and nothing else; the proxy lives for this command only. The
// writes allowed are the clone's node_modules and the scratch directory, and install scripts are switched off (`npm_config_ignore_scripts`)
// whatever the declared command says.
export async function installDependencies(deps: AppDeps, run: RunRow, contract: RunContract, clonePath: string): Promise<Result<InstallResult>> {
  const spec = contract.execution.dependencies;
  if (spec === null) return ok({ outcome: 'skipped', reason: 'no-dependencies', attempts: [] });
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  const cwd = canonical(clonePath);

  const sandbox = sandboxSetup(deps, run, cwd);
  if (!sandbox.ok) return sandbox;
  const lock = workspace.readText(cwd, spec.lockfile, LOCKFILE_MAX_BYTES);
  if (!lock.ok) return lock;
  if (lock.value === null) {
    return ok({ outcome: 'failed', lockfile: spec.lockfile, attempts: [], failure: { reason: 'decision', decisionClass: 'repeated_failure', issue: `the lockfile ${spec.lockfile} is not in the repository at the pin, so the dependencies were not installed` } });
  }
  const lockfileDigest = `sha256:${sha256Hex(lock.value)}`;

  if (deps.egress === undefined) {
    return ok({ outcome: 'failed', lockfile: spec.lockfile, lockfileDigest, attempts: [], failure: { reason: 'enforcement_failure', decisionClass: 'permission', issue: 'the egress proxy is not composed, so the dependency install cannot run with registry-only network' } });
  }
  const proxy = await deps.egress.start({ allow: contract.execution.supervisorEndpoints.map((host) => `${host}:443`) });
  if (!proxy.ok) {
    return ok({ outcome: 'failed', lockfile: spec.lockfile, lockfileDigest, attempts: [], failure: { reason: 'enforcement_failure', decisionClass: 'permission', issue: `the egress proxy could not start (${proxy.error.kind}), so the dependency install did not run` } });
  }
  try {
    const url = `http://127.0.0.1:${proxy.value.port}`;
    const ran = await deps.executor.run({
      argv: spec.install,
      cwd,
      env: { ...sandbox.value.env, npm_config_https_proxy: url, npm_config_proxy: url, HTTPS_PROXY: url, npm_config_update_notifier: 'false', npm_config_ignore_scripts: 'true' },
      timeoutMs: INSTALL_TIMEOUT_MS,
      invocationId: deps.ids.next('inv_'),
      writePaths: [join(cwd, 'node_modules'), sandbox.value.scratch],
      denyReadPaths: sandbox.value.denyReadPaths,
      allowReadPaths: sandbox.value.allowReadPaths,
      allowLoopbackPorts: [proxy.value.port],
    });
    const attempts = groupAttempts(proxy.value.attempts());
    const refused = attempts.filter((a) => !a.allowed);
    const base = { lockfile: spec.lockfile, lockfileDigest, attempts };
    if (!ran.ok) {
      if (ran.error.kind === 'unavailable') {
        return ok({ outcome: 'failed', ...base, failure: { reason: 'enforcement_failure', decisionClass: 'permission', issue: `no sandbox is available, so the dependency install did not run: ${ran.error.cause}`.slice(0, 300) } });
      }
      return ran;
    }
    const result = { ...base, exitCode: ran.value.exitCode, durationMs: ran.value.durationMs };
    if (refused.length > 0) {
      const hosts = [...new Set(refused.map((a) => `${a.host}:${a.port}`))].join(', ');
      return ok({ outcome: 'failed', ...result, failure: { reason: 'decision', decisionClass: 'permission', issue: `the dependency install tried to reach a host that is not an allowed registry: ${hosts}` } });
    }
    if (ran.value.status !== 'passed') {
      const tail = ran.value.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300);
      return ok({ outcome: 'failed', ...result, failure: { reason: 'decision', decisionClass: 'repeated_failure', issue: `the dependency install ${ran.value.status === 'timed_out' ? 'timed out' : `exited ${String(ran.value.exitCode)}`}${tail === '' ? '' : `: ${tail}`}` } });
    }
    return ok({ outcome: 'installed', ...result });
  } finally {
    await proxy.value.close();
  }
}


// ---- the test inventory (AUT-9) ------------------------------------------------------------------------------------------------

const MAX_TEST_IDS = 50_000;
const MAX_ID_CHARS = 500;
const MAX_TEST_FILES = 20_000;
const TEST_FILE_MAX_BYTES = 4 * 1024 * 1024;

export interface InventoryMeasure {
  evidenceId: string;
  status: EvidenceStatus;
  snapshot: InventorySnapshot;
}

// Measures the inventory of the clone `cwd` and records it: an artifact `test-inventory` with the full ID list and one evidence row of kind
// `test-inventory` (count, idsDigest, markers per file). Null when the conventions declare no inventory. A list command that cannot run or
// fails is recorded as `unavailable` or `failed` with an empty ID list, which can only make the comparison stricter.
export async function measureInventory(deps: AppDeps, run: RunRow, contract: RunContract, cwd: string, options: { phase: 'base' | 'item'; attemptId: string; itemId?: string; contractVersion: number }): Promise<Result<InventoryMeasure | null>> {
  const spec = contract.verification.testInventory;
  if (spec === null) return ok(null);
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  const root = canonical(cwd);
  const where = cloneRevision(deps, root);
  if (!where.ok) return where;
  const sandbox = sandboxSetup(deps, run, root);
  if (!sandbox.ok) return sandbox;

  let status: EvidenceStatus = 'passed';
  let exitCode: number | undefined;
  let durationMs = 0;
  let ids: string[] = [];
  if (spec.argv !== undefined) {
    // A list command loads the project's tool configuration, and the tool may make its cache directories while it does (vitest list on the
    // portfolio makes node_modules/.cache/imagetools and node_modules/.vite-temp): the cache and output paths the repository's own checks
    // declare as writes are the only places it may write, besides the scratch directory (plan 02-21; the dry run found `EPERM ... mkdir`).
    const declared = contract.execution.checks.flatMap((check) => check.writes.flatMap((glob) => writePathOf(root, glob) ?? []));
    const ran = await deps.executor.run({
      argv: spec.argv,
      cwd: root,
      env: sandbox.value.env,
      timeoutMs: 120_000,
      invocationId: deps.ids.next('inv_'),
      writePaths: [...new Set([sandbox.value.scratch, ...declared])],
      denyReadPaths: sandbox.value.denyReadPaths,
      allowReadPaths: sandbox.value.allowReadPaths,
    });
    if (ran.ok) {
      status = evidenceStatusOf(ran.value.status);
      exitCode = ran.value.exitCode ?? undefined;
      durationMs = ran.value.durationMs;
      if (ran.value.status === 'passed') {
        ids = ran.value.stdout
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== '')
          .slice(0, MAX_TEST_IDS)
          .map((line) => line.slice(0, MAX_ID_CHARS));
      }
    } else if (ran.error.kind === 'unavailable') {
      status = 'unavailable';
    } else {
      return ran;
    }
  }

  const listed = workspace.listFiles(root);
  if (!listed.ok) return listed;
  const markers: Record<string, number> = {};
  let fileCount = 0;
  for (const path of listed.value.filter((p) => matchesAny(p, spec.globs)).slice(0, MAX_TEST_FILES)) {
    const text = workspace.readText(root, path, TEST_FILE_MAX_BYTES);
    // A file that is gone (a deleted tracked file) is not counted; one too large to read is counted and its markers are unknown.
    if (text.ok && text.value === null) continue;
    fileCount += 1;
    if (text.ok && text.value !== null) {
      const hits = scanMarkers(path, text.value).length;
      if (hits > 0) markers[path] = hits;
    }
  }

  const sortedIds = [...ids].sort();
  const idsDigest = digestOf(sortedIds);
  const stored = deps.artifacts.put(new TextEncoder().encode(JSON.stringify({ ids: sortedIds })), { kind: INVENTORY_KIND, runId: run.runId });
  if (!stored.ok) return stored;
  const recorded = deps.ledger.recordArtifact({ digest: stored.value.digest, size: stored.value.size, kind: INVENTORY_KIND, runId: run.runId, retention: RUN_RETENTION, store: STORE, nowMs: deps.clock.nowMs() });
  if (!recorded.ok) return recorded;
  const label = PHASE_LABEL[options.phase];
  const evidence = deps.ledger.recordEvidence({
    attemptId: options.attemptId,
    ...(options.itemId !== undefined ? { workItem: options.itemId } : {}),
    kind: 'test-inventory',
    name: 'test-inventory',
    status,
    revision: where.value.revision,
    clean: where.value.clean,
    treeDigest: where.value.treeDigest,
    environment: { kind: contract.execution.environment, sandbox: 'seatbelt', label, phase: options.phase },
    contractVersion: options.contractVersion,
    policyRevision: contract.policyRevision,
    independence: 'deterministic',
    acceptance: [],
    tests: { count: sortedIds.length, idsDigest, markers, fileCount },
    ...(spec.argv !== undefined ? { command: spec.argv } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    durationMs,
    artifactDigest: stored.value.digest,
    nowMs: deps.clock.nowMs(),
  });
  if (!evidence.ok) return evidence;
  return ok({ evidenceId: evidence.value.evidenceId, status, snapshot: { ids: sortedIds, markers, fileCount } });
}

// The inventory recorded at a phase, rebuilt from its evidence row and artifact; null when the conventions declare none or none was recorded.
// The latest row of the phase counts.
export function recordedInventory(deps: AppDeps, runId: string, phase: 'base' | 'item'): Result<InventoryMeasure | null> {
  const evidence = deps.ledger.listEvidence(runId);
  if (!evidence.ok) return evidence;
  const row = [...evidence.value].reverse().find((e) => e.kind === 'test-inventory' && e.environment['label'] === PHASE_LABEL[phase]);
  if (row === undefined) return ok(null);
  if (row.artifactDigest === null || row.artifactDigest === undefined) return err({ kind: 'internal', cause: `the ${phase} test inventory ${row.evidenceId} has no artifact` });
  const bytes = deps.artifacts.get(row.artifactDigest);
  if (!bytes.ok) return bytes;
  let ids: string[] = [];
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes.value)) as { ids?: unknown };
    ids = Array.isArray(parsed.ids) ? parsed.ids.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return err({ kind: 'internal', cause: `the ${phase} test inventory artifact of ${row.evidenceId} is not readable` });
  }
  const tests = (typeof row.tests === 'object' && row.tests !== null ? row.tests : {}) as { markers?: unknown; fileCount?: unknown };
  const markers: Record<string, number> = {};
  if (typeof tests.markers === 'object' && tests.markers !== null) {
    for (const [path, count] of Object.entries(tests.markers)) if (typeof count === 'number') markers[path] = count;
  }
  return ok({ evidenceId: row.evidenceId, status: row.status, snapshot: { ids, markers, fileCount: typeof tests.fileCount === 'number' ? tests.fileCount : 0 } });
}
