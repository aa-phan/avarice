// Shared by the cancel suites (plan 03-24; AUT-12): `avarice cancel` in this process through main() on a stream that claims to be a terminal, and the
// reads of what a cancelled run leaves behind. The commands that need a person at a terminal (decide, cancel) run this way; a supervisor that has to
// start is the real detached `supervise` of the test CLI. No test calls a real model.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { ProcessEntry } from '../../src/adapters/proc/ancestry.ts';
import { main } from '../../src/cli/main.ts';
import type { MainOverrides } from '../../src/cli/main.ts';
import { ok } from '../../src/domain/result.ts';
import type { Result } from '../../src/domain/result.ts';
import { checkoutDigest, RUN_REF_PATTERN } from '../../scripts/checkout-digest.ts';
import { join } from 'node:path';
import { makeRoots, runCli } from './run-cli.ts';
import type { CliRoots } from './run-cli.ts';
import { TEST_CLI } from './fault-run.ts';
import { RUN_CONVENTIONS_WITH_COMMANDS, commitConventions, ledgerRows, makeRunRepo, onboardRunRepo, profileEnv, writeBrief } from './run-fixtures.ts';
import type { ScratchRepo } from './scratch-repo.ts';
import { runIdOfOutput, runRowOf, s17Fixture, s17Host } from './independent-work.ts';
import type { S17Fixture } from './independent-work.ts';
import { fakeTerminal } from './shell-streams.ts';

const entry = (pid: number, ppid: number, command: string): ProcessEntry => ({ pid, ppid, command });
// A shell, a login and launchd: a person at a terminal.
export const CALM_CHAIN = (): Result<ProcessEntry[]> => ok([entry(300, 200, 'node avarice.ts cancel'), entry(200, 100, '-zsh'), entry(100, 1, 'login'), entry(1, 0, '/sbin/launchd')]);

export interface CancelRan {
  code: number;
  out: string;
  err: string;
}

export interface CancelCliOptions {
  stdinIsTty?: boolean;
  stdoutIsTty?: boolean;
  env?: NodeJS.ProcessEnv;
  ancestry?: () => Result<ProcessEntry[]>;
  // Replaces the host of the composition (the cancel of a run whose host survived reaps through it) or any other seam of main().
  overrides?: MainOverrides;
}

// `avarice cancel <argv>` in this process, on a terminal.
export async function cancelCli(roots: CliRoots, argv: readonly string[], options: CancelCliOptions = {}): Promise<CancelRan> {
  const term = fakeTerminal({ inputIsTty: options.stdinIsTty ?? true, outputIsTty: options.stdoutIsTty ?? true });
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(['cancel', ...argv], {
    ...(options.overrides ?? {}),
    env: { ...profileEnv(roots), ...options.env },
    io: { out: (t) => void out.push(t), err: (t) => void err.push(t) },
    stdin: term.stdin,
    stdout: term.stdout,
    ancestry: options.ancestry ?? CALM_CHAIN,
  });
  return { code, out: out.join(''), err: err.join('') };
}

export interface SingleFixture {
  roots: CliRoots;
  repo: ScratchRepo;
  brief: string;
}

// An onboarded repository with the conventions committed and the one-item brief written; `cleanup` collects the directories to remove.
export function singleFixture(cleanup: string[]): SingleFixture {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo, RUN_CONVENTIONS_WITH_COMMANDS);
  return { roots, repo, brief: writeBrief(join(roots.base, 'briefs')) };
}

export interface StartedBlocked {
  f: S17Fixture;
  runId: string;
  decisionId: string;
}

// The S-17 run (plan 03-18) through the test CLI until B has asked and the run is blocked on that one decision with no supervisor alive.
export function startBlockedS17(cleanup: string[]): StartedBlocked {
  const f = s17Fixture(cleanup);
  const result = runCli(['start', '--brief', f.brief, '--policy', 'routine', '--wait'], {
    roots: f.roots,
    cwd: f.repo.path,
    entry: TEST_CLI,
    env: { AVARICE_FAKE_HOST: JSON.stringify({ run: s17Host() }) },
    timeoutMs: 300_000,
  });
  if (result.code !== 3) throw new Error(`the S-17 run did not block: ${String(result.code)}\n${result.stdout}${result.stderr}`);
  const runId = runIdOfOutput(result.stdout);
  const decisionId = (ledgerRows<{ decision_id: string }>(f.roots, "SELECT decision_id FROM decisions WHERE run_id = ? AND state = 'open'", runId)[0] as { decision_id: string }).decision_id;
  return { f, runId, decisionId };
}

// What the run's rows say, for "nothing was written" comparisons: the run row's version and state, the cancel columns, and the number of events and checkpoints.
export interface RunRowsSnapshot {
  version: number;
  state: string;
  cancelRequestedAt: string | null;
  events: number;
  checkpoints: number;
  decisions: string;
}

export function rowsSnapshot(roots: CliRoots, runId: string): RunRowsSnapshot {
  const run = ledgerRows<{ version: number; state: string; cancel_requested_at: string | null }>(roots, 'SELECT version, state, cancel_requested_at FROM runs WHERE run_id = ?', runId)[0];
  if (run === undefined) throw new Error(`no run ${runId}`);
  const count = (table: string): number => (ledgerRows<{ n: number }>(roots, `SELECT count(*) AS n FROM ${table} WHERE run_id = ?`, runId)[0] as { n: number }).n;
  const decisions = ledgerRows<{ decision_id: string; state: string }>(roots, 'SELECT decision_id, state FROM decisions WHERE run_id = ? ORDER BY decision_id', runId);
  return {
    version: run.version,
    state: run.state,
    cancelRequestedAt: run.cancel_requested_at,
    events: count('events'),
    checkpoints: count('checkpoints'),
    decisions: decisions.map((d) => `${d.decision_id}:${d.state}`).join(','),
  };
}

// The data of every event of a type for a run, oldest first.
export function eventsOf(roots: CliRoots, runId: string, type: string): Array<Record<string, unknown>> {
  return ledgerRows<{ data_json: string }>(roots, 'SELECT data_json FROM events WHERE run_id = ? AND type = ? ORDER BY seq', runId, type).map((r) => JSON.parse(r.data_json) as Record<string, unknown>);
}

// The user's checkout as one digest (HEAD, index, tree with untracked files, config, refs except a run branch, linked worktrees): equal before and after
// means nothing in it changed.
export function checkoutState(repoPath: string): string {
  const { counts, ...digest } = checkoutDigest(repoPath, [RUN_REF_PATTERN]);
  void counts;
  return createHash('sha256').update(JSON.stringify(digest)).digest('hex');
}

// The run clone is still there: its directory and its HEAD resolve (the clone and its branch are kept for inspection, S-20).
export function cloneKept(roots: CliRoots, runId: string): { directory: boolean; head: boolean; branch: string | null } {
  const row = runRowOf(roots, runId);
  const directory = existsSync(row.workspace_path);
  let head = false;
  if (directory) {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: row.workspace_path, stdio: 'ignore' });
      head = true;
    } catch {
      head = false;
    }
  }
  const branch = ledgerRows<{ branch: string | null }>(roots, 'SELECT branch FROM runs WHERE run_id = ?', runId)[0]?.branch ?? null;
  return { directory, head, branch };
}
