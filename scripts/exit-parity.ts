// The parity guard of the exit tools (plan 03-65; AUT-16, AUT-1; D-26, D-27, D-29).
//
// What it proves: run 2 of the Phase 3 exit failed twice on a mismatch between what the unit (the model host) is told to run and what the supervisor runs. In attempt 1 the unit was not
// told a check was already red (plan 03-61). In attempt 2 it was not given the check's environment (plan 03-64). D-29 allows no third attempt without the owner, so this guard finds a
// mismatch of that kind before any spend. For every check the unit is told to run (every required and every target check of the briefs), on the pinned repository, it runs the check
// twice in fresh temporary clones of the pin:
//   - as the unit would run it: the exact string the contract lists for the check (checkAgentCommand), judged by the real hook decision under the policy the real run scope builds, then
//     run through `/bin/sh -c` under the environment the real host adapter builds, with the run scope's write roots and read limits, in the production sandboxed executor. The host's own
//     sandbox cannot be started without the host, so the executor stands in for it; the report says so.
//   - as the supervisor runs it: runRequiredChecks' own command shape (argv, `{ ...spec.env, ...sandboxSetup env }`, the check's writes and sandboxSetup's read rules).
// It records whether the two statuses agree. `--with-pre-fix` also runs each check by its bare argument vector, the list the unit was given before plan 03-64.
//
// What it never does: it spends nothing, launches no model host, installs nothing, uses no network and never writes to the source repository. The clones come from git objects into a
// temporary work root; the node_modules tree the checks need is copied out of a tree the caller names (default: the source checkout's), without following symlinks, and only when the
// lockfile of the source checkout is byte-identical to the lockfile blob at the pin. The state of the source checkout (HEAD, status, refs, the Phase 2 composite digest, and a digest
// of its node_modules) is recorded before and after and must be equal.
//
// The module imports nothing from exit-run-phase3-tools.ts, which dispatches to it.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { checksToRun, sandboxSetup, writePathOf } from '../src/app/checks.ts';
import type { AppDeps } from '../src/app/deps.ts';
import { canonicalAbsolute } from '../src/adapters/fs/canonical-path.ts';
import { SandboxedExecutor } from '../src/adapters/exec/sandboxed-executor.ts';
import { CloneRunWorkspace } from '../src/adapters/git/run-workspace.ts';
import { GitRunSource } from '../src/adapters/git/run-source.ts';
import { buildHookPolicy } from '../src/adapters/host-claude/hook-policy.ts';
import { buildInvocationEnv } from '../src/adapters/host-claude/env.ts';
import { parseBrief } from '../src/domain/brief.ts';
import type { Brief } from '../src/domain/brief.ts';
import { parseConventions } from '../src/domain/conventions.ts';
import type { Conventions } from '../src/domain/conventions.ts';
import { decideToolCall, normalizeToolCall } from '../src/domain/hook-decision.ts';
import type { HookDecision, HookPolicy } from '../src/domain/hook-decision.ts';
import { newId } from '../src/domain/ids.ts';
import { computeRunScope, runScopeDirs } from '../src/domain/invocation-scope.ts';
import type { InvocationScope } from '../src/domain/invocation-scope.ts';
import { checkAgentCommand, compileRunContract } from '../src/domain/run-contract.ts';
import type { RunContract } from '../src/domain/run-contract.ts';
import { redactSecrets } from '../src/domain/secret-patterns.ts';
import type { CommandExecutor, CommandSpec } from '../src/ports/command-executor.ts';
import type { RunRow } from '../src/ports/ledger.ts';
import { compositeOf, snapshot } from './exit-run-phase2-tools.ts';

type Json = Record<string, unknown>;
type CheckSpec = RunContract['execution']['checks'][number];

const DEFAULT_PIN = '9f1cd8d';
const PLAN = '03-65';
const TAIL_LINES = 15;
const USAGE =
  'usage: parity --source REPO --config F --brief B [--brief B ...] --out F [--pin SHA] [--node-modules-from DIR] [--gsd-core-bin DIR] [--with-pre-fix] [--anchor-evidence F --anchor-run-id R] [--keep]';

const out = (text: string): void => void process.stdout.write(text);
const errOut = (text: string): void => void process.stderr.write(`${text}\n`);
const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');
const tildeHome = (text: string): string => (homedir() === '' ? text : text.split(homedir()).join('~'));

function describeError(error: { kind: string } & Record<string, unknown>): string {
  return `${error.kind}${typeof error['cause'] === 'string' ? `: ${error['cause']}` : typeof error['reason'] === 'string' ? `: ${error['reason']}` : ''}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The source checkout, read only
// ---------------------------------------------------------------------------------------------------------------

function readGit(repo: string, args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const ran = spawnSync('git', ['--no-optional-locks', '-C', repo, ...args], { encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' }, maxBuffer: 1 << 26 });
  return { status: ran.status, stdout: ran.stdout ?? '', stderr: ran.stderr ?? '' };
}

function mustRead(repo: string, args: readonly string[]): string {
  const ran = readGit(repo, args);
  if (ran.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${ran.stderr.trim()}`);
  return ran.stdout;
}

// The blob at the pin, byte for byte (no text decoding).
function blobAt(repo: string, pin: string, path: string): Buffer | null {
  const ran = spawnSync('git', ['--no-optional-locks', '-C', repo, 'cat-file', 'blob', `${pin}:${path}`], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' }, maxBuffer: 1 << 28 });
  return ran.status === 0 ? Buffer.from(ran.stdout) : null;
}

// What "the owner's checkout did not change" compares: HEAD, `git status`, every ref with its object, and the composite digest of the Phase 2 snapshot (tracked and untracked file
// bytes, index entries, symbolic HEAD).
interface CheckoutState {
  head: string;
  status: string;
  refs: string;
  composite: string;
  nodeModules: string;
}

// Git ignores node_modules, so `status` and the composite do not see a write inside it. This digest covers: every top-level entry (type, size and mtime by lstat, so a symlink is not
// followed), the entries one level below each `@scope` directory, and every file below the directories the declared checks write under node_modules (the caches: .tmp, .vite,
// .vite-temp, .vitest, .vitest-cache, .cache), by relative path, size and mtime. It does not hash the contents of the packages themselves.
const CACHE_DIRS: readonly string[] = ['.tmp', '.vite', '.vite-temp', '.vitest', '.vitest-cache', '.cache'];
export const NODE_MODULES_DIGEST_COVERS =
  'every top-level entry of node_modules by lstat (type, size, mtime), the entries below each @scope directory, and every file under .tmp, .vite, .vite-temp, .vitest, .vitest-cache and .cache by relative path, size and mtime; not package file contents';

function lstatLine(path: string, label: string): string {
  try {
    const st = lstatSync(path);
    return `${label}|${st.isSymbolicLink() ? 'l' : st.isDirectory() ? 'd' : 'f'}|${st.size}|${st.mtimeMs}`;
  } catch {
    return `${label}|missing`;
  }
}

function walkFiles(root: string, base: string, lines: string[]): void {
  let names: string[];
  try {
    names = readdirSync(root).sort();
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(root, name);
    const label = relative(base, path);
    lines.push(lstatLine(path, label));
    let isDir = false;
    try {
      isDir = lstatSync(path).isDirectory();
    } catch {
      isDir = false;
    }
    if (isDir) walkFiles(path, base, lines);
  }
}

export function nodeModulesDigest(dir: string): string {
  const lines: string[] = [];
  let top: string[] = [];
  try {
    top = readdirSync(dir).sort();
  } catch {
    return sha256('missing');
  }
  for (const name of top) {
    lines.push(lstatLine(join(dir, name), name));
    if (name.startsWith('@')) {
      try {
        for (const inner of readdirSync(join(dir, name)).sort()) lines.push(lstatLine(join(dir, name, inner), `${name}/${inner}`));
      } catch {
        // an unreadable scope directory is part of the state as it is
      }
    }
  }
  for (const cache of CACHE_DIRS) walkFiles(join(dir, cache), dir, lines);
  return sha256(lines.join('\n'));
}

function checkoutState(repo: string, nodeModulesDir: string): CheckoutState {
  const snap = snapshot(repo);
  return {
    head: mustRead(repo, ['rev-parse', 'HEAD']).trim(),
    status: mustRead(repo, ['status', '--porcelain=v2', '--untracked-files=all']),
    refs: mustRead(repo, ['for-each-ref', '--format=%(refname) %(objectname)']),
    composite: String(snap['composite'] ?? compositeOf(snap)),
    nodeModules: nodeModulesDigest(nodeModulesDir),
  };
}

const sameState = (a: CheckoutState, b: CheckoutState): boolean => a.head === b.head && a.status === b.status && a.refs === b.refs && a.composite === b.composite && a.nodeModules === b.nodeModules;
const stateSummary = (s: CheckoutState): Json => ({
  head: s.head,
  composite: s.composite,
  refCount: s.refs.split('\n').filter((l) => l !== '').length,
  statusEntries: s.status.split('\n').filter((l) => l !== '').length,
  nodeModulesDigest: s.nodeModules,
});

// ---------------------------------------------------------------------------------------------------------------
// One command's result
// ---------------------------------------------------------------------------------------------------------------

interface RunResult {
  status: string;
  exitCode: number | null;
  durationMs: number;
  outputSha256: string | null;
  tail: { stdout: string[]; stderr: string[] };
}

const tailOf = (text: string): string[] => tildeHome(redactSecrets(text)).replace(/\n+$/, '').split('\n').filter((l, i, all) => all.length > 1 || l !== '').slice(-TAIL_LINES);

const NOT_RUN: RunResult = { status: 'refused', exitCode: null, durationMs: 0, outputSha256: null, tail: { stdout: [], stderr: [] } };

async function runSpec(executor: CommandExecutor, spec: CommandSpec, label: string, problems: string[]): Promise<RunResult> {
  const ran = await executor.run(spec);
  if (!ran.ok) {
    const kind = ran.error.kind === 'unavailable' ? 'unavailable' : 'error';
    problems.push(`${label}: the executor did not run the command (${kind}): ${describeError(ran.error as unknown as { kind: string } & Record<string, unknown>)}`);
    return { ...NOT_RUN, status: kind };
  }
  const value = ran.value;
  const stdout = redactSecrets(value.stdout);
  const stderr = redactSecrets(value.stderr);
  return {
    status: value.status,
    exitCode: value.exitCode,
    durationMs: value.durationMs,
    outputSha256: `sha256:${sha256(`${stdout}\n--- stderr ---\n${stderr}`)}`,
    tail: { stdout: tailOf(value.stdout), stderr: tailOf(value.stderr) },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------------------------------------------

export interface ParityOptions {
  source: string;
  config: string;
  briefs: string[];
  out: string;
  pin?: string;
  nodeModulesFrom?: string;
  gsdCoreBin?: string;
  withPreFix?: boolean;
  anchorEvidence?: string;
  anchorRunId?: string;
  keep?: boolean;
}

export interface ParityOutcome {
  report: Json | null;
  exitCode: number;
}

// The one place the module refuses an input: exit 2 and nothing written.
class Refused extends Error {}

interface Contracts {
  pin: string;
  conventionsRevision: string;
  conventionsText: string;
  contracts: Array<{ path: string; digest: string; contract: RunContract }>;
  problems: string[];
}

function compileBriefs(options: ParityOptions, source: string, pinRef: string, problems: string[]): Contracts {
  const pinOut = readGit(source, ['rev-parse', '--verify', `${pinRef}^{commit}`]);
  if (pinOut.status !== 0) throw new Refused(`the pin ${pinRef} is not a commit of ${source}`);
  const pin = pinOut.stdout.trim();
  const gitSource = new GitRunSource();
  const head = gitSource.head(source);
  if (!head.ok) throw new Refused(`cannot read the HEAD of ${source}: ${describeError(head.error as unknown as { kind: string } & Record<string, unknown>)}`);
  const found = gitSource.conventionsAt(source, pin, head.value);
  if (!found.ok) throw new Refused(`no committed conventions: ${describeError(found.error as unknown as { kind: string } & Record<string, unknown>)}`);
  const committed = parseConventions(found.value.text);
  if (!committed.ok) throw new Refused(`the committed conventions do not parse: ${describeError(committed.error as unknown as { kind: string } & Record<string, unknown>)}`);
  const conventions: Conventions = committed.value;

  // The reviewed draft the owner approved must be the conventions the run reads (a read-only comparison of parsed values).
  const draftText = readFileSync(options.config, 'utf8');
  const draft = parseConventions(draftText);
  if (!draft.ok) problems.push(`${options.config}: the conventions draft does not parse: ${describeError(draft.error as unknown as { kind: string } & Record<string, unknown>)}`);
  else if (JSON.stringify(draft.value) !== JSON.stringify(conventions)) problems.push(`the conventions committed at ${found.value.revision} differ from the draft ${basename(options.config)}`);

  const files = mustRead(source, ['ls-tree', '-r', '--name-only', pin]).split('\n').filter((l) => l !== '');
  const contracts: Contracts['contracts'] = [];
  let n = 0;
  for (const briefPath of options.briefs) {
    n += 1;
    const parsed = parseBrief(readFileSync(briefPath, 'utf8'), { kind: 'file', id: basename(briefPath) });
    if (!parsed.ok) {
      problems.push(`${briefPath}: does not parse: ${describeError(parsed.error as unknown as { kind: string } & Record<string, unknown>)}`);
      continue;
    }
    const brief: Brief = parsed.value;
    const compiled = compileRunContract({
      projectId: 'portfolio',
      baseRevision: pin,
      conventionsRevision: found.value.revision,
      brief,
      conventions,
      nowIso: new Date().toISOString(),
      policy: 'routine',
      indexFacts: { files, symbolsByFile: {} },
      runId: `run_ParityBrief${n}`,
    });
    if (!compiled.ok) {
      problems.push(`${briefPath}: does not compile against the committed conventions: ${JSON.stringify(compiled.error)}`);
      continue;
    }
    contracts.push({ path: briefPath, digest: brief.digest, contract: compiled.value.contract });
  }
  const first = contracts[0];
  if (first !== undefined) {
    for (const other of contracts.slice(1)) {
      if (JSON.stringify(other.contract.execution.commands) !== JSON.stringify(first.contract.execution.commands)) problems.push(`${other.path} lists different agent commands than ${first.path}`);
    }
  }
  return { pin, conventionsRevision: found.value.revision, conventionsText: found.value.text, contracts, problems };
}

interface PassContext {
  executor: CommandExecutor;
  base: string;
  workRoot: string;
  dataRoot: string;
  source: string;
  pin: string;
  nodeModulesFrom: string;
  copyMode: { value: 'clone' | 'copy' | 'none' };
  contract: RunContract;
}

// A fresh validation clone of the pin with the node_modules tree copied in (symlinks stay symlinks, so nothing links back into the owner's tree) and every directory a declared check
// writes under node_modules removed from the copy, so neither form reads a stale cache.
function prepareClone(ctx: PassContext, runId: string, problems: string[], pass: string): string | null {
  const made = new CloneRunWorkspace().prepareValidationClone({ repoPath: ctx.source, workRoot: ctx.workRoot, runId, pin: ctx.pin });
  if (!made.ok) {
    problems.push(`${pass}: the validation clone could not be made: ${describeError(made.error as unknown as { kind: string } & Record<string, unknown>)}`);
    return null;
  }
  const clone = realpathSync(made.value);
  const target = join(clone, 'node_modules');
  let copied = spawnSync('cp', ['-c', '-R', '-P', ctx.nodeModulesFrom, target], { encoding: 'utf8' });
  if (copied.status === 0) ctx.copyMode.value = 'clone';
  else {
    rmSync(target, { recursive: true, force: true });
    copied = spawnSync('cp', ['-R', '-P', ctx.nodeModulesFrom, target], { encoding: 'utf8' });
    if (copied.status === 0) ctx.copyMode.value = 'copy';
  }
  if (copied.status !== 0) {
    problems.push(`${pass}: node_modules could not be copied: ${copied.stderr.trim()}`);
    return null;
  }
  for (const spec of ctx.contract.execution.checks) {
    for (const glob of spec.writes) {
      const path = writePathOf(clone, glob);
      if (path !== null && path.startsWith(`${target}${sep}`)) rmSync(path, { recursive: true, force: true });
    }
  }
  return clone;
}

interface UnitSetup {
  clone: string;
  scope: InvocationScope;
  policy: HookPolicy;
  env: Record<string, string>;
  writePaths: string[];
}

function unitSetup(ctx: PassContext, clone: string, runId: string, gsdCoreBin: string): UnitSetup {
  const workspace = new CloneRunWorkspace();
  const described = workspace.describe(clone, runScopeDirs(ctx.contract.files));
  if (!described.ok) throw new Error(`the clone cannot be described: ${describeError(described.error as unknown as { kind: string } & Record<string, unknown>)}`);
  const scratchDir = join(realpathSync(join(ctx.workRoot, runId)), 'scratch');
  for (const name of ['tmp', 'npm-cache']) mkdirSync(join(scratchDir, name), { recursive: true, mode: 0o700 });
  const scope = computeRunScope({
    contract: ctx.contract,
    clonePath: clone,
    repoPath: realpathSync(ctx.source),
    dataRoot: realpathSync(ctx.dataRoot),
    home: realpathSync(homedir()),
    workRoot: realpathSync(ctx.workRoot),
    scratchDir,
    workspace: described.value,
    readRoots: [],
  });
  const built = buildHookPolicy(scope, { onboardingId: runId, runId, invocationId: 'inv_Parity', subagentTypes: [] }, join(ctx.dataRoot, 'state.db'));
  if (!built.ok) throw new Error(`the hook policy cannot be built: ${describeError(built.error as unknown as { kind: string } & Record<string, unknown>)}`);
  const env = buildInvocationEnv(process.env, { gsdCoreBin, onboardingId: runId, marker: runId, scratchDir });
  return { clone, scope, policy: built.value, env, writePaths: [...scope.writeRoots, ...(scope.writeFiles ?? []), scratchDir] };
}

function hookOf(command: string, setup: UnitSetup): { decision: string; rule: string } {
  const normalized = normalizeToolCall('Bash', { command }, setup.clone);
  if (!normalized.ok) return { decision: 'deny', rule: `not-normalized: ${normalized.reason}` };
  const decided: HookDecision = decideToolCall(normalized.call, setup.policy, (path) => canonicalAbsolute(path));
  return { decision: decided.decision, rule: decided.rule };
}

const sh = (command: string, setup: UnitSetup, spec: CheckSpec, runId: string): CommandSpec => ({
  argv: ['/bin/sh', '-c', command],
  cwd: setup.clone,
  env: setup.env,
  timeoutMs: spec.timeoutSec * 1000,
  invocationId: `inv_${runId}`,
  writePaths: setup.writePaths,
  denyReadPaths: setup.scope.denyRead,
  allowReadPaths: setup.scope.allowRead,
});

interface CheckReport extends Json {
  name: string;
  parity: boolean;
}

export async function parityReport(options: ParityOptions): Promise<ParityOutcome> {
  const source = resolve(options.source);
  const outPath = options.out;
  const pinRef = options.pin ?? DEFAULT_PIN;
  const nodeModulesFrom = resolve(options.nodeModulesFrom ?? join(source, 'node_modules'));
  const gsdCoreBin = resolve(options.gsdCoreBin ?? join(homedir(), '.claude', 'gsd-core', 'bin'));
  const problems: string[] = [];
  const startedAt = Date.now();
  const recordPlan = /^(\d{2}-\d{2})-/.exec(basename(outPath))?.[1] ?? PLAN;

  let before: CheckoutState;
  let compiled: Contracts;
  let lockfile: string;
  let lockfileSha: string;
  try {
    // 1. Refusals before anything is made: the node_modules tree and its lockfile, the pin, the conventions.
    if (!existsSync(source)) throw new Refused(`${source} does not exist`);
    if (!existsSync(nodeModulesFrom) || !lstatSync(nodeModulesFrom).isDirectory()) throw new Refused(`node_modules is not a directory: ${nodeModulesFrom}`);
    before = checkoutState(source, nodeModulesFrom);
    compiled = compileBriefs(options, source, pinRef, problems);
    const first = compiled.contracts[0];
    lockfile = first?.contract.execution.dependencies?.lockfile ?? 'package-lock.json';
    const onDisk = existsSync(join(source, lockfile)) ? readFileSync(join(source, lockfile)) : null;
    const atPin = blobAt(source, compiled.pin, lockfile);
    if (onDisk === null || atPin === null) throw new Refused(`${lockfile} is missing in the source checkout or at the pin ${compiled.pin}`);
    lockfileSha = sha256(atPin);
    if (sha256(onDisk) !== lockfileSha) throw new Refused(`${lockfile} of the source checkout is not byte-identical to the lockfile at the pin ${compiled.pin}: its node_modules is not the pin's tree`);
  } catch (error) {
    if (error instanceof Refused) {
      errOut(`parity: refused: ${error.message}`);
      return { report: null, exitCode: 2 };
    }
    throw error;
  }

  const report: Json = {
    schema: 1,
    plan: recordPlan,
    checkedAt: new Date(startedAt).toISOString(),
    source: tildeHome(source),
    pin: compiled.pin,
    conventionsRevision: compiled.conventionsRevision,
    briefs: compiled.contracts.map((c) => ({ path: relative(process.cwd(), c.path), digest: c.digest })),
    spentUsd: 0,
    modelHostLaunched: false,
    installs: false,
    network: false,
    node: process.version,
    unitSandbox: "the production sandboxed executor stands in for the host's own sandbox, which cannot be started without the host",
  };

  const names = new Map<string, { spec: CheckSpec; required: boolean; target: boolean }>();
  for (const { contract } of compiled.contracts) {
    for (const { spec, required, target } of checksToRun(contract)) {
      const known = names.get(spec.name);
      names.set(spec.name, { spec: known?.spec ?? spec, required: (known?.required ?? false) || required, target: (known?.target ?? false) || target });
    }
  }
  const firstContract = compiled.contracts[0];

  const checks: CheckReport[] = [];
  let mismatches: string[] = [];
  let preFix: Json | null = null;
  let anchor: Json | null = null;
  let copyMode: 'clone' | 'copy' | 'none' = 'none';
  let base = '';
  let cwdsInsideSource = false;
  let unitEnvNames: string[] = [];
  let supervisorEnvNames: string[] = [];

  if (firstContract !== undefined && problems.length === 0) {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-parity-')));
    try {
      const workRoot = join(base, 'work');
      const dataRoot = join(base, 'data');
      mkdirSync(workRoot, { recursive: true, mode: 0o700 });
      mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
      writeFileSync(join(dataRoot, 'state.db'), '');
      const executor = new SandboxedExecutor();
      const mode = { value: 'none' as 'clone' | 'copy' | 'none' };
      const ctx: PassContext = { executor, base, workRoot, dataRoot, source, pin: compiled.pin, nodeModulesFrom, copyMode: mode, contract: firstContract.contract };
      const newRun = (): string => newId('run_', Date.now(), randomBytes(10));
      const insideSource = (path: string): boolean => path === realpathSync(source) || path.startsWith(`${realpathSync(source)}${sep}`);

      // 2. The supervisor pass: runRequiredChecks' own command shape.
      const supervisorRun = newRun();
      const supervisorClone = prepareClone(ctx, supervisorRun, problems, 'supervisor');
      const supervisor = new Map<string, RunResult>();
      if (supervisorClone !== null) {
        cwdsInsideSource ||= insideSource(supervisorClone);
        const deps = { profile: { workRoot, dataRoot }, home: homedir() } as unknown as AppDeps;
        const setup = sandboxSetup(deps, { runId: supervisorRun } as unknown as RunRow, supervisorClone);
        if (!setup.ok) throw new Error(`the supervisor sandbox could not be set up: ${describeError(setup.error as unknown as { kind: string } & Record<string, unknown>)}`);
        const envNames = new Set<string>(Object.keys(setup.value.env));
        for (const { spec } of names.values()) {
          for (const name of Object.keys(spec.env)) envNames.add(name);
          const writePaths = [setup.value.scratch, ...spec.writes.flatMap((glob) => {
            const writable = writePathOf(supervisorClone, glob);
            return writable === null ? [] : [writable];
          })];
          out(`parity: supervisor ${spec.name}\n`);
          supervisor.set(
            spec.name,
            await runSpec(
              executor,
              {
                argv: spec.argv,
                cwd: supervisorClone,
                env: { ...spec.env, ...setup.value.env },
                timeoutMs: spec.timeoutSec * 1000,
                invocationId: `inv_${supervisorRun}`,
                writePaths,
                denyReadPaths: setup.value.denyReadPaths,
                allowReadPaths: setup.value.allowReadPaths,
              },
              `supervisor ${spec.name}`,
              problems,
            ),
          );
        }
        supervisorEnvNames = [...envNames].sort();
      }

      // 3. The unit pass: the exact listed command, judged by the real hook, run under the host's environment.
      const unitRun = newRun();
      const unitClone = prepareClone(ctx, unitRun, problems, 'unit');
      const unit = new Map<string, { command: string; listed: boolean; hook: { decision: string; rule: string }; result: RunResult }>();
      if (unitClone !== null) {
        cwdsInsideSource ||= insideSource(unitClone);
        const setup = unitSetup(ctx, unitClone, unitRun, gsdCoreBin);
        unitEnvNames = Object.keys(setup.env).sort();
        for (const { spec } of names.values()) {
          const command = checkAgentCommand(spec);
          const listed = compiled.contracts.every((c) => c.contract.execution.commands.includes(command));
          const hook = hookOf(command, setup);
          out(`parity: unit ${spec.name}: ${command} (${hook.decision} ${hook.rule})\n`);
          const result = hook.decision === 'allow' ? await runSpec(executor, sh(command, setup, spec, unitRun), `unit ${spec.name}`, problems) : { ...NOT_RUN };
          unit.set(spec.name, { command, listed, hook, result });
        }
      }

      // 4. The pre-fix pass: the bare argument vectors the unit was given before plan 03-64, run whatever today's hook says.
      let prefixRows: Array<Json & { name: string }> | null = null;
      if (options.withPreFix === true) {
        const prefixRun = newRun();
        const prefixClone = prepareClone(ctx, prefixRun, problems, 'pre-fix');
        prefixRows = [];
        if (prefixClone !== null) {
          cwdsInsideSource ||= insideSource(prefixClone);
          const setup = unitSetup(ctx, prefixClone, prefixRun, gsdCoreBin);
          for (const { spec } of names.values()) {
            const command = spec.argv.join(' ');
            const hook = hookOf(command, setup);
            out(`parity: pre-fix ${spec.name}: ${command} (${hook.decision} ${hook.rule})\n`);
            const result = await runSpec(executor, sh(command, setup, spec, prefixRun), `pre-fix ${spec.name}`, problems);
            prefixRows.push({ name: spec.name, command, hook, ...result });
          }
        }
      }
      copyMode = mode.value;

      // 5. Per check: both results and the verdict.
      for (const [name, { spec, required, target }] of names) {
        const sup = supervisor.get(name) ?? { ...NOT_RUN, status: 'not-run' };
        const uni = unit.get(name);
        const unitResult = uni?.result ?? { ...NOT_RUN, status: 'not-run' };
        const listed = uni?.listed ?? false;
        const hook = uni?.hook ?? { decision: 'deny', rule: 'not-run' };
        const same = unitResult.status === sup.status;
        const parity = listed && hook.decision === 'allow' && same && sup.status !== 'not-run';
        checks.push({ name, required, target, unitCommand: uni?.command ?? checkAgentCommand(spec), listed, hook, unit: unitResult, supervisor: sup, parity });
      }
      mismatches = checks.filter((c) => !c.parity).map((c) => c.name);
      if (prefixRows !== null) {
        const wrong = prefixRows.filter((row) => row['status'] !== (supervisor.get(row.name)?.status ?? 'not-run')).map((row) => row.name);
        preFix = {
          note: 'each check by its bare argument vector, the list the unit was given before plan 03-64; evidence of run 2 attempt 2, not part of the verdict',
          checks: prefixRows,
          mismatches: wrong,
        };
      }

      // 6. The anchor: the supervisor form against what AVARICE measured live at the pin.
      if (options.anchorEvidence !== undefined && options.anchorRunId !== undefined) {
        const anchorProblems: string[] = [];
        const compared: Array<{ name: string; recorded: string; measured: string }> = [];
        let recordedRows: Array<{ name: string; status: string }> = [];
        try {
          const evidence = JSON.parse(readFileSync(options.anchorEvidence, 'utf8')) as { runs?: Array<{ runId?: string; evidenceRows?: Array<{ kind?: string; name?: string; status?: string; phase?: string }> }> };
          const entry = (evidence.runs ?? []).find((r) => r.runId === options.anchorRunId);
          if (entry === undefined) anchorProblems.push(`the evidence file has no run ${options.anchorRunId}`);
          else {
            recordedRows = (entry.evidenceRows ?? []).filter((r) => r.kind === 'check' && r.phase === 'base' && typeof r.name === 'string' && typeof r.status === 'string').map((r) => ({ name: r.name as string, status: r.status as string }));
            if (recordedRows.length === 0) anchorProblems.push(`run ${options.anchorRunId} records no base check rows`);
          }
        } catch (error) {
          anchorProblems.push(`the evidence file cannot be read: ${error instanceof Error ? error.message : String(error)}`);
        }
        for (const row of recordedRows) {
          const measured = supervisor.get(row.name);
          if (measured === undefined) continue;
          compared.push({ name: row.name, recorded: row.status, measured: measured.status });
          if (measured.status !== row.status) anchorProblems.push(`${row.name}: the supervisor form gives ${measured.status}, the live base evidence of run ${options.anchorRunId} records ${row.status}`);
        }
        if (anchorProblems.length === 0 && compared.length === 0) anchorProblems.push('no check of the report is named by the anchor');
        anchor = { evidence: tildeHome(options.anchorEvidence), runId: options.anchorRunId, compared, matches: anchorProblems.length === 0, problems: anchorProblems };
        for (const p of anchorProblems) problems.push(`anchor: ${p}`);
      }
    } finally {
      if (options.keep === true) out(`parity: work root kept at ${base}\n`);
      else rmSync(base, { recursive: true, force: true });
    }
  }

  // 7. The checkout, again.
  const after = checkoutState(source, nodeModulesFrom);
  const unchanged = sameState(before, after);
  if (!unchanged) problems.push('the source checkout changed during the parity run (HEAD, status, refs, composite digest or node_modules digest differ)');
  if (cwdsInsideSource) problems.push('a check run had its working directory inside the source checkout');

  const parity = checks.length > 0 && checks.every((c) => c.parity);
  Object.assign(report, {
    nodeModules: { from: tildeHome(nodeModulesFrom), lockfile, lockfileSha256: `sha256:${lockfileSha}`, matchesPin: true, copy: copyMode, copiedWithoutFollowingSymlinks: true },
    unitEnvironment: unitEnvNames,
    supervisorEnvironment: supervisorEnvNames,
    checks,
    mismatches,
    preFix,
    anchor,
    checkout: {
      before: stateSummary(before),
      after: stateSummary(after),
      unchanged,
      nodeModulesDigestCovers: NODE_MODULES_DIGEST_COVERS,
      runCwdInsideSourceCheckout: cwdsInsideSource,
    },
    parity,
    problems,
    durationMs: Date.now() - startedAt,
  });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  out(`parity: ${parity ? 'true' : 'false'}${mismatches.length > 0 ? `, mismatches: ${mismatches.join(', ')}` : ''}${problems.length > 0 ? `, ${problems.length} problem(s)` : ''}\n`);
  for (const p of problems) out(`PROBLEM: ${p}\n`);
  out(`report ${outPath}\n`);
  return { report, exitCode: parity && problems.length === 0 ? 0 : 1 };
}

export async function parityCommand(named: Record<string, string>, many: Record<string, string[]>, bools: ReadonlySet<string>): Promise<number> {
  const source = named['source'];
  const config = named['config'];
  const briefs = (many['brief'] ?? []).map((p) => resolve(p));
  const outPath = named['out'];
  const hasAnchorEvidence = named['anchor-evidence'] !== undefined;
  const hasAnchorRun = named['anchor-run-id'] !== undefined;
  if (source === undefined || config === undefined || !existsSync(resolve(config)) || briefs.length === 0 || briefs.some((b) => !existsSync(b)) || outPath === undefined || hasAnchorEvidence !== hasAnchorRun) {
    errOut(USAGE);
    return 2;
  }
  const outcome = await parityReport({
    source,
    config: resolve(config),
    briefs,
    out: resolve(outPath),
    ...(named['pin'] !== undefined ? { pin: named['pin'] } : {}),
    ...(named['node-modules-from'] !== undefined ? { nodeModulesFrom: named['node-modules-from'] } : {}),
    ...(named['gsd-core-bin'] !== undefined ? { gsdCoreBin: named['gsd-core-bin'] } : {}),
    ...(bools.has('with-pre-fix') ? { withPreFix: true } : {}),
    ...(named['anchor-evidence'] !== undefined ? { anchorEvidence: resolve(named['anchor-evidence']) } : {}),
    ...(named['anchor-run-id'] !== undefined ? { anchorRunId: named['anchor-run-id'] } : {}),
    ...(bools.has('keep') ? { keep: true } : {}),
  });
  return outcome.exitCode;
}
