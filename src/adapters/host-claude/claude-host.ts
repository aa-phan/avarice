// ClaudeHostAdapter: the contained Claude Code host (ONB-3, ONB-12, CON-2, CON-3, CON-6; docs/containment.md "How a
// run is launched"). One invocation is: generate the five launch inputs, prove every containment layer is in place
// (settings keys, the hook denying a write in a self-test, the sandbox, an admitted host version), build the launch
// line and judge it, start the host in its own process group in the staging copy with an allowlisted environment,
// read its stream-json while it runs, enforce the wall clock ourselves (SIGTERM, then SIGKILL after a grace), and
// classify what happened from the host's final result, the exit, the staging HEAD and our own hook events, never
// from model text. The transcript is stored as an artifact only after secrets are redacted.
//
// Fail closed: any refusal before the spawn is `denied` with rule `enforcement_failure:{reason}` and nothing is
// started. The descriptor says `enforced` only when the startup check (hook entry, sandbox, admitted version) passed.
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';

import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { classifyOutcome } from '../../domain/outcome.ts';
import { redactSecrets } from '../../domain/secret-patterns.ts';
import type { InvocationScope } from '../../domain/invocation-scope.ts';
import type { AgentHost, InvocationOutcome, InvocationRequest, PermissionDenial, ReapRequest } from '../../ports/agent-host.ts';
import type { ArtifactStore } from '../../ports/artifact-store.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';
import type { StagingWorkspace } from '../../ports/staging-workspace.ts';
import { buildInvocationEnv } from './env.ts';
import { canonicalPath } from './settings.ts';
import { assertLaunchArgsSafe, buildLaunchArgs } from './launch-args.ts';
import { checkHostReady, checkLaunchReady } from './launch-preflight.ts';
import { writeInvocationFiles } from './invocation-files.ts';
import type { GsdLocations, InvocationFiles } from './invocation-files.ts';
import type { PreambleFingerprint } from './hook-policy.ts';
import { StreamJsonParser } from './stream-json.ts';

export const DEFAULT_KILL_GRACE_MS = 10_000;
export const MAX_TRANSCRIPT_BYTES = 20 * 1024 * 1024;
// How long to wait for the output pipe to close after the process has exited, before it is cut.
const STDOUT_CLOSE_WAIT_MS = 2_000;
const MAX_EXPECTED_FILE_BYTES = 1024 * 1024;
const ADAPTER_VERSION = '0.1.0';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// An ID that becomes a directory name: no separator, no leading dot.
const PATH_PART = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export interface BeforeSpawn {
  invDir: string;
  files: InvocationFiles;
  request: InvocationRequest;
}

export interface ClaudeHostOptions {
  claudeBin: string;
  // `src/hook/pre-tool-use.ts`, the script the generated settings run.
  hookEntry: string;
  // The ledger the hook records its decisions in.
  ledgerPath: string;
  dataRoot: string;
  gsd: GsdLocations & { preamble?: PreambleFingerprint };
  artifacts: ArtifactStore;
  staging: StagingWorkspace;
  // Hook denials recorded for an invocation, and how many were budget_exhausted.
  countHookDenies(invocationId: string): Result<{ total: number; budget: number }>;
  // The environment the invocation environment is built from (default: this process's).
  env?: NodeJS.ProcessEnv;
  // Tests only: runs after the launch files are written and before the launch checks.
  onBeforeSpawn?: (info: BeforeSpawn) => void;
  // Tests only: the sandbox probe command.
  sandboxProbe?: readonly string[];
  // SIGTERM to SIGKILL grace (default 10 s).
  killGraceMs?: number;
  maxTranscriptBytes?: number;
}

function refuse(reason: string): Result<never> {
  return err({ kind: 'denied', rule: `enforcement_failure:${reason}`, enforcer: 'avarice' });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class ClaudeHostAdapter implements AgentHost {
  readonly #o: ClaudeHostOptions;
  #ready: Result<{ claudeVersion: string }> | undefined;

  constructor(options: ClaudeHostOptions) {
    this.#o = options;
  }

  // The startup check runs on first use of the descriptor (once per adapter): `enforced` only when the hook entry
  // can be read, the sandbox runs and `claude --version` is an admitted version.
  #readiness(): Result<{ claudeVersion: string }> {
    this.#ready ??= checkHostReady({
      claudeBin: this.#o.claudeBin,
      hookEntry: this.#o.hookEntry,
      ...(this.#o.sandboxProbe !== undefined ? { sandboxProbe: this.#o.sandboxProbe } : {}),
    });
    return this.#ready;
  }

  get descriptor(): CapabilityDescriptor {
    const ready = this.#readiness();
    return {
      port: 'agent-host',
      adapter: 'claude-code',
      version: ADAPTER_VERSION,
      capabilities: { 'contained-invocation': ready.ok, headless: true, resume: false },
      attributes: ready.ok
        ? { enforcement: 'enforced', claudeVersion: ready.value.claudeVersion }
        : { enforcement: 'none', reason: ready.error.kind === 'denied' ? ready.error.rule : ready.error.kind },
      offline: false,
    };
  }

  // The scope plus the real location of each skill the plugin directory links, which the invocation must be able
  // to read (the symlinks in the plugin directory point there).
  #scopeWithSkills(scope: InvocationScope, skills: readonly string[]): InvocationScope {
    const roots = [...scope.readRoots];
    for (const name of skills) {
      try {
        const real = realpathSync(join(this.#o.gsd.skillsRoot, name));
        if (!roots.includes(real)) roots.push(real);
      } catch {
        // buildPluginDir reports the missing skill with a precise error
      }
    }
    return { ...scope, readRoots: roots };
  }

  async invoke(req: InvocationRequest, signal: AbortSignal): Promise<Result<InvocationOutcome>> {
    if (signal.aborted) return err({ kind: 'cancelled', sideEffect: 'none' });
    const o = this.#o;
    const sessionId = req.sessionId ?? randomUUID();
    if (!UUID.test(sessionId)) return err({ kind: 'invalid', field: 'sessionId', reason: 'a session ID must be a UUID' });
    // Whose invocation this is: an onboarding (the default, every Phase 1 caller) or a run (plan 02-08). The owner's ID becomes a
    // directory name, so it is a plain name; the run purpose belongs to a run and only to one.
    const run = req.ownerKind === 'run';
    if (run !== (req.purpose === 'run')) return err({ kind: 'invalid', field: 'ownerKind', reason: 'the run purpose needs a run owner, and a run owner needs the run purpose' });
    const ownerId = run ? req.ownerId : req.onboardingId;
    if (ownerId === undefined || !PATH_PART.test(ownerId) || !PATH_PART.test(req.invocationId)) {
      return err({ kind: 'invalid', field: 'invocationId', reason: `${run ? 'run' : 'onboarding'} and invocation IDs must be plain names` });
    }
    const stagingPath = req.scope.stagingPath;

    // 1. The five launch inputs.
    const invDir = join(o.dataRoot, run ? 'run' : 'onboard', ownerId, `${req.purpose}-${req.invocationId}`);
    const files = writeInvocationFiles({
      invDir,
      scope: this.#scopeWithSkills(req.scope, req.extensions.skills),
      request: req,
      gsd: o.gsd,
      hookEntry: o.hookEntry,
      ledgerPath: o.ledgerPath,
      ...(o.gsd.preamble !== undefined ? { preamble: o.gsd.preamble } : {}),
    });
    if (!files.ok) return refuse(`invocation-files:${files.error.kind}`);
    o.onBeforeSpawn?.({ invDir, files: files.value, request: req });

    // 2. Every containment layer, including the hook denying a write in a self-test, or nothing starts.
    const ready = checkLaunchReady({
      settingsFile: files.value.settingsFile,
      claudeBin: o.claudeBin,
      policyFile: files.value.policyFile,
      ...(o.sandboxProbe !== undefined ? { sandboxProbe: o.sandboxProbe } : {}),
    });
    if (!ready.ok) return ready;

    // 3. The generated argv, judged before it is used.
    const args = buildLaunchArgs({
      prompt: req.prompt,
      settingsFile: files.value.settingsFile,
      pluginDir: files.value.pluginDir,
      agentsFile: files.value.agentsFile,
      mcpFile: files.value.mcpFile,
      model: req.model,
      costCapUsd: req.costCapUsd,
      sessionId,
      ...(req.agentName !== undefined ? { agent: req.agentName } : {}),
    });
    const safe = assertLaunchArgsSafe(args);
    if (!safe.ok) return refuse(safe.error.kind === 'denied' ? safe.error.rule.replace(/^launch_args:/, 'launch-args:') : 'launch-args');
    const env = buildInvocationEnv(o.env ?? process.env, {
      gsdCoreBin: join(o.gsd.gsdCoreDir, 'bin'),
      onboardingId: req.onboardingId,
      ...(run ? { marker: ownerId, ...(req.scope.scratchDir !== undefined ? { scratchDir: req.scope.scratchDir } : {}) } : {}),
    });

    const headBefore = o.staging.head(stagingPath);
    if (!headBefore.ok) return headBefore;

    // 4. Run it, in its own process group, under our own wall clock.
    const startedAt = Date.now();
    // A run starts in the realpath of its clone (the form the allow rules name); an onboarding keeps the path it was given.
    const cwd = req.purpose === 'run' ? canonicalPath(req.cwd) : req.cwd;
    const launched = await this.#run(req, cwd, args, env, signal);
    if (!launched.ok) return launched;
    const ran = launched.value;
    const durationMs = Date.now() - startedAt;

    // 5. What happened, from facts.
    const parsed = ran.parsed;
    const headAfter = o.staging.head(stagingPath);
    if (!headAfter.ok) return headAfter;
    const denies = o.countHookDenies(req.invocationId);
    if (!denies.ok) return denies;
    const expectedFilesPresent =
      req.expectedFiles.length > 0 &&
      req.expectedFiles.every((rel) => {
        const read = o.staging.read(stagingPath, rel, MAX_EXPECTED_FILE_BYTES);
        // A file above the read limit is there.
        return read.ok ? read.value !== null : read.error.kind === 'invalid' && read.error.field === 'size';
      });
    const permissionDenials = mergeDenials(parsed.result?.permissionDenials ?? [], parsed.permissionDenied);
    const result = parsed.result;
    const classified = classifyOutcome({
      resultSeen: result !== undefined,
      ...(result?.isError !== undefined ? { isError: result.isError } : {}),
      ...(result?.subtype !== undefined ? { subtype: result.subtype } : {}),
      ...(result?.terminalReason !== undefined ? { terminalReason: result.terminalReason } : {}),
      permissionDenials: permissionDenials.length,
      hookDenies: denies.value.total,
      hookBudgetDenies: denies.value.budget,
      timedOut: ran.timedOut,
      exitCode: ran.exitCode,
      signal: ran.signal,
      headBefore: headBefore.value,
      headAfter: headAfter.value,
      expectedFilesPresent,
    });

    // 6. The transcript, redacted, as an artifact. A transcript that cannot be stored is an error, not a silent gap.
    const text = redactSecrets(ran.transcript);
    const bytes = new TextEncoder().encode(text);
    const stored = o.artifacts.put(bytes, { kind: 'transcript', runId: req.runId });
    if (!stored.ok) return stored;

    return ok({
      sessionId,
      kind: classified.kind,
      permissionDenials,
      costUsd: result?.totalCostUsd ?? 0,
      durationMs,
      headBefore: headBefore.value,
      headAfter: headAfter.value,
      transcriptArtifact: stored.value.digest,
      details: {
        exitCode: ran.exitCode,
        signal: ran.signal,
        timedOut: ran.timedOut,
        headMoved: classified.headMoved,
        transcriptBytes: stored.value.size,
        hookDenies: denies.value.total,
        hookBudgetDenies: denies.value.budget,
        numTurns: result?.numTurns ?? 0,
        resultSeen: result !== undefined,
        ...(result?.isError !== undefined ? { isError: result.isError } : {}),
        ...(result?.subtype !== undefined ? { subtype: result.subtype } : {}),
        ...(result?.terminalReason !== undefined ? { terminalReason: result.terminalReason } : {}),
        ...(result?.subagentStats !== undefined ? { subagentsSpawned: result.subagentStats.spawned } : {}),
      },
    });
  }

  // Starts the host and waits for it. The process leads its own group, so a SIGTERM to the group reaches the shell
  // commands and background subagents it started; after the process exits the group is swept once more.
  async #run(
    req: InvocationRequest,
    cwd: string,
    args: readonly string[],
    env: Record<string, string>,
    signal: AbortSignal,
  ): Promise<Result<{ parsed: ReturnType<StreamJsonParser['finish']>; transcript: string; exitCode: number | null; signal: string | null; timedOut: boolean }>> {
    const o = this.#o;
    const cap = o.maxTranscriptBytes ?? MAX_TRANSCRIPT_BYTES;
    const grace = o.killGraceMs ?? DEFAULT_KILL_GRACE_MS;

    let child: ChildProcess;
    try {
      child = spawn(o.claudeBin, [...args], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return err({ kind: 'unavailable', cause: `cannot start the host: ${(e as NodeJS.ErrnoException).code ?? 'spawn failed'}` });
    }

    const parser = new StreamJsonParser();
    const chunks: Buffer[] = [];
    let kept = 0;
    let truncated = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;

    const killGroup = (sig: NodeJS.Signals): void => {
      const pid = child.pid;
      if (pid === undefined) return;
      try {
        process.kill(-pid, sig);
      } catch {
        try {
          child.kill(sig);
        } catch {
          // already gone
        }
      }
    };
    const terminate = (): void => {
      if (timedOut) return;
      timedOut = true;
      killGroup('SIGTERM');
      killTimer = setTimeout(() => killGroup('SIGKILL'), grace);
    };
    const wallClock = setTimeout(terminate, Math.max(req.wallClockMs, 1));
    const onAbort = (): void => terminate();
    signal.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => {
      parser.push(chunk);
      if (kept < cap) {
        const room = cap - kept;
        chunks.push(chunk.length <= room ? chunk : chunk.subarray(0, room));
        kept += Math.min(chunk.length, room);
        if (chunk.length > room) truncated = true;
      } else {
        truncated = true;
      }
    });
    // stderr is drained and dropped: it is host diagnostics, not evidence, and may carry paths.
    child.stderr?.resume();

    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null } | Error>((resolve) => {
      child.once('error', (e) => resolve(e));
      child.once('exit', (code, sig) => resolve({ code, signal: sig }));
    });
    clearTimeout(wallClock);
    signal.removeEventListener('abort', onAbort);
    if (exit instanceof Error) {
      if (killTimer !== undefined) clearTimeout(killTimer);
      return err({ kind: 'unavailable', cause: `cannot start the host: ${(exit as NodeJS.ErrnoException).code ?? 'spawn failed'}` });
    }
    // Anything the host left running in its group (a background subagent's shell) dies with it.
    killGroup('SIGKILL');
    if (killTimer !== undefined) clearTimeout(killTimer);

    // The output pipe closes when the group is gone; do not wait for it beyond a short bound.
    if (child.stdout !== null && !child.stdout.destroyed && !child.stdout.readableEnded) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, STDOUT_CLOSE_WAIT_MS);
        child.stdout?.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      child.stdout.destroy();
    }

    const transcript = Buffer.concat(chunks).toString('utf8') + (truncated ? `\n[avarice: transcript truncated at ${cap} bytes]\n` : '');
    return ok({ parsed: parser.finish(), transcript, exitCode: exit.code, signal: exit.signal, timedOut });
  }

  // Ends any process that carries the invocation's `--session-id`: a supervisor killed mid-invocation leaves its host
  // running in its own process group, and a resume must end it before anything else touches staging.
  async reap(request: ReapRequest): Promise<Result<{ terminated: number }>> {
    return reapBySessionId(request.sessionId, this.#o.killGraceMs ?? DEFAULT_KILL_GRACE_MS);
  }
}

// Ends any process that carries the session ID in its command line (`--session-id {uuid}`): a supervisor killed mid-invocation
// leaves its host running in its own process group, and a resume must end it before anything else touches staging. Shared by
// the adapter and the test fake host, so a test exercises the production search and kill rules.
export async function reapBySessionId(sessionId: string, killGraceMs: number = DEFAULT_KILL_GRACE_MS): Promise<Result<{ terminated: number }>> {
  if (!UUID.test(sessionId)) return err({ kind: 'invalid', field: 'sessionId', reason: 'a session ID must be a UUID' });
  // The pattern is matched as a regular expression against the whole command line; a UUID has no metacharacter.
  const found = spawnSync('/usr/bin/pgrep', ['-f', '--', `--session-id ${sessionId}`], { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] });
  if (found.error !== undefined) return err({ kind: 'unavailable', cause: `cannot search for the host process: ${(found.error as NodeJS.ErrnoException).code ?? 'pgrep failed'}` });
  // pgrep: 0 matched, 1 none matched, anything else is an error.
  if (found.status === 1) return ok({ terminated: 0 });
  if (found.status !== 0) return err({ kind: 'unavailable', cause: `cannot search for the host process: pgrep exited ${String(found.status)}` });
  const pids = found.stdout
    .split('\n')
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 1 && pid !== process.pid);

  // A host we started leads its own group (pgid === pid): end the whole group. Anything else is ended alone.
  const end = (pid: number, sig: NodeJS.Signals): void => {
    const group = spawnSync('/bin/ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] });
    const leads = Number(group.stdout.trim()) === pid;
    try {
      process.kill(leads ? -pid : pid, sig);
    } catch {
      // already gone
    }
  };
  for (const pid of pids) end(pid, 'SIGTERM');
  const waitGone = async (limitMs: number): Promise<number[]> => {
    const until = Date.now() + limitMs;
    let alive = pids.filter(isAlive);
    while (alive.length > 0 && Date.now() < until) {
      await sleep(25);
      alive = alive.filter(isAlive);
    }
    return alive;
  };
  let alive = await waitGone(killGraceMs);
  for (const pid of alive) end(pid, 'SIGKILL');
  alive = await waitGone(5_000);
  if (alive.length > 0) return err({ kind: 'unavailable', cause: `a host process (${alive.join(', ')}) survived SIGKILL` });
  return ok({ terminated: pids.length });
}

// One entry per denied call: the larger of the two sources' counts for each tool, because the host reports the same
// denial in its `permission_denied` event and in the result's `permission_denials`.
function mergeDenials(fromResult: readonly PermissionDenial[], fromEvents: readonly PermissionDenial[]): PermissionDenial[] {
  const tally = (list: readonly PermissionDenial[]): Map<string, PermissionDenial[]> => {
    const byTool = new Map<string, PermissionDenial[]>();
    for (const d of list) byTool.set(d.tool, [...(byTool.get(d.tool) ?? []), d]);
    return byTool;
  };
  const a = tally(fromResult);
  const b = tally(fromEvents);
  const merged: PermissionDenial[] = [];
  for (const tool of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(tool) ?? [];
    const y = b.get(tool) ?? [];
    merged.push(...(x.length >= y.length ? x : y));
  }
  return merged;
}
