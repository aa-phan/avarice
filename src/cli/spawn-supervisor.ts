// Starting and waiting for a run's supervisor (plan 02-12; D-18, SC 6, T-02-40). `start` returns once a detached
// `avarice supervise <runId>` is running: its own process group, standard streams ignored, working directory the data root, and
// unref'd, so closing the shell (or killing `start --wait`) leaves it running. The spawn lives in src/cli because the application
// layer may not start processes; the entry is the script that is running now (the bin script in production, the test entry in tests).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { AppDeps } from '../app/deps.ts';
import { isRunStopState } from '../domain/run-lifecycle.ts';
import type { RunRow } from '../ports/ledger.ts';

export interface SpawnRequest {
  // Absolute path of the CLI entry script (process.argv[1] of the command that spawns).
  entry: string;
  runId: string;
  env: NodeJS.ProcessEnv;
  // The data root: the supervisor never inherits the user's working directory.
  cwd: string;
}

export type SpawnResult = { ok: true; pid: number } | { ok: false; message: string };

// A missing or relative entry refuses the spawn (the caller exits 70): a relative path would resolve against the data root.
export function spawnSupervisor(request: SpawnRequest): SpawnResult {
  if (!isAbsolute(request.entry)) return { ok: false, message: `the CLI entry ${JSON.stringify(request.entry)} is not an absolute path, so a supervisor cannot be started from the data root` };
  if (!existsSync(request.entry)) return { ok: false, message: `the CLI entry ${request.entry} does not exist` };
  try {
    const child = spawn(process.execPath, [...process.execArgv, request.entry, 'supervise', request.runId], {
      detached: true,
      stdio: 'ignore',
      cwd: request.cwd,
      env: request.env,
    });
    // A failed spawn reports on the event, not by throwing: without a listener it would end this process.
    child.on('error', () => undefined);
    if (child.pid === undefined) return { ok: false, message: 'the supervisor process did not start' };
    child.unref();
    return { ok: true, pid: child.pid };
  } catch (e) {
    return { ok: false, message: `the supervisor could not be started: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists but is not ours to signal.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export type WaitResult =
  // The run reached a stop state.
  | { kind: 'final'; run: RunRow }
  // The supervisor is gone and the lease has lapsed with the run unfinished; `nextAction` is the latest checkpoint's.
  | { kind: 'interrupted'; run: RunRow; nextAction: string | null }
  // The wait budget ran out while the supervisor was still working.
  | { kind: 'timeout'; run: RunRow };

export interface WaitOptions {
  pollMs?: number;
  maxMs?: number;
}

const leaseIsLive = (run: RunRow, nowMs: number): boolean => run.leaseHolder !== null && run.leaseExpiresAt !== null && Date.parse(run.leaseExpiresAt) >= nowMs;

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Polls the ledger until the run stops, the supervisor dies with the run unfinished, or `maxMs` passes. A non-stop run whose recorded
// supervisor PID is gone and whose lease has expired (or was released) is interrupted: nobody is working on it.
export async function waitForRun(deps: AppDeps, runId: string, pid: number, options: WaitOptions = {}): Promise<WaitResult | { kind: 'error'; message: string }> {
  const pollMs = options.pollMs ?? 250;
  const deadline = options.maxMs === undefined ? Number.POSITIVE_INFINITY : Date.now() + options.maxMs;
  for (;;) {
    const read = deps.ledger.getRun(runId);
    if (!read.ok) return { kind: 'error', message: `run ${runId} cannot be read: ${read.error.kind}` };
    const run = read.value;
    if (isRunStopState(run.state)) return { kind: 'final', run };
    if (!isProcessAlive(pid) && !leaseIsLive(run, deps.clock.nowMs())) {
      // Read again: the supervisor may have committed its last transition between the two reads.
      const again = deps.ledger.getRun(runId);
      if (again.ok && isRunStopState(again.value.state)) return { kind: 'final', run: again.value };
      const latest = deps.ledger.latestRunCheckpoint(runId);
      return { kind: 'interrupted', run: again.ok ? again.value : run, nextAction: latest.ok && latest.value !== null ? latest.value.nextAction : null };
    }
    if (Date.now() >= deadline) return { kind: 'timeout', run };
    await pause(pollMs);
  }
}
