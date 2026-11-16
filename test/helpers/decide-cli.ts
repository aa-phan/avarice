// What the Phase 3 exit suites (plan 03-26) share to drive `decide`, `contract amend`, `inbox` and `status` in this process on a terminal that is a stream
// claiming to be one, and to bring the four-item scenario of plan 03-18 to the point where B has asked and the run is blocked. The detached supervisor that
// `decide` starts is the real `supervise` of the test CLI (production main() with the fake run host). No helper here calls a real model.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { configPathFor } from '../../src/adapters/fs/profile-paths.ts';
import type { ProcessEntry } from '../../src/adapters/proc/ancestry.ts';
import { main } from '../../src/cli/main.ts';
import type { MainOverrides } from '../../src/cli/main.ts';
import { ok } from '../../src/domain/result.ts';
import type { Result } from '../../src/domain/result.ts';
import type { Clock } from '../../src/app/deps.ts';
import type { FakeRunOptions } from './fake-run-host.ts';
import { TEST_CLI } from './fault-run.ts';
import { s17Fixture, s17Host, runIdOfOutput, unitOf } from './independent-work.ts';
import type { S17Fixture } from './independent-work.ts';
import { runCli } from './run-cli.ts';
import type { CliRoots } from './run-cli.ts';
import { ledgerRows, profileEnv } from './run-fixtures.ts';
import { fakeTerminal } from './shell-streams.ts';

const entry = (pid: number, ppid: number, command: string): ProcessEntry => ({ pid, ppid, command });
// A shell, a login and launchd: a person at a terminal.
export const CALM_CHAIN = (): Result<ProcessEntry[]> => ok([entry(300, 200, 'node avarice.ts decide'), entry(200, 100, '-zsh'), entry(100, 1, 'login'), entry(1, 0, '/sbin/launchd')]);

export interface Ran {
  code: number;
  out: string;
  err: string;
  // The questions the command asked through the io, in order.
  questions: string[];
}

export interface RunMainOptions {
  // Replaces the clock of the composition (an injected clock for the commands that read time).
  clock?: Clock;
  // The answers to the questions the command asks (the prompt and the amendment confirmation), in order. An exhausted list answers end of input.
  answers?: string[];
  stdinIsTty?: boolean;
  stdoutIsTty?: boolean;
}

// Any command in this process through production main(), on a terminal.
export async function runMain(roots: CliRoots, argv: readonly string[], options: RunMainOptions = {}): Promise<Ran> {
  const term = fakeTerminal({ inputIsTty: options.stdinIsTty ?? true, outputIsTty: options.stdoutIsTty ?? true });
  const out: string[] = [];
  const err: string[] = [];
  const questions: string[] = [];
  const answers = [...(options.answers ?? [])];
  const overrides: MainOverrides = {
    env: profileEnv(roots),
    io: { out: (t) => void out.push(t), err: (t) => void err.push(t) },
    stdin: term.stdin,
    stdout: term.stdout,
    ancestry: CALM_CHAIN,
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
    ...(options.answers !== undefined
      ? {
          ask: (question: string): Promise<string | undefined> => {
            questions.push(question);
            return Promise.resolve(answers.shift());
          },
        }
      : {}),
  };
  const code = await main(argv, overrides);
  return { code, out: out.join(''), err: err.join(''), questions };
}

// `avarice decide <argv>` in this process, on a terminal.
export const decideMain = (roots: CliRoots, argv: readonly string[], options: RunMainOptions = {}): Promise<Ran> => runMain(roots, ['decide', ...argv], options);

// The supervisor `decide` starts is spawned from the script that is running (process.argv[1]); inside a test that is the test runner, so for the duration
// of `body` the entry is the test CLI (production main() with the fake run host), and the host script travels in AVARICE_FAKE_HOST. `env` is set for the
// duration too, so a detached supervisor inherits it.
export async function withSupervisorEntry<T>(host: FakeRunOptions, body: () => Promise<T>, env: Readonly<Record<string, string>> = {}): Promise<T> {
  const saved = { argv1: process.argv[1], execArgv: process.execArgv, fake: process.env['AVARICE_FAKE_HOST'], env: Object.keys(env).map((k) => [k, process.env[k]] as const) };
  process.argv[1] = TEST_CLI;
  process.execArgv = ['--disable-warning=ExperimentalWarning'];
  process.env['AVARICE_FAKE_HOST'] = JSON.stringify({ run: host });
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  try {
    return await body();
  } finally {
    process.argv[1] = saved.argv1 as string;
    process.execArgv = saved.execArgv;
    if (saved.fake === undefined) delete process.env['AVARICE_FAKE_HOST'];
    else process.env['AVARICE_FAKE_HOST'] = saved.fake;
    for (const [k, v] of saved.env) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

export interface Blocked {
  f: S17Fixture;
  runId: string;
  decisionId: string;
  // The session B's first unit ran under: the one a resume must name (D-08).
  firstSession: string;
}

// `start --brief ... --wait` through the test CLI: the detached supervisor runs the scenario and stops with B blocked on its question.
export function startBlocked(cleanup: string[], host: FakeRunOptions = s17Host(), extraArgs: readonly string[] = [], env: Record<string, string | undefined> = {}): Blocked {
  const f = s17Fixture(cleanup);
  const result = runCli(['start', '--brief', f.brief, '--policy', 'routine', ...extraArgs, '--wait'], {
    roots: f.roots,
    cwd: f.repo.path,
    entry: TEST_CLI,
    env: { AVARICE_FAKE_HOST: JSON.stringify({ run: host }), ...env },
    timeoutMs: 300_000,
  });
  assert.equal(result.code, 3, result.stdout + result.stderr);
  const runId = runIdOfOutput(result.stdout);
  return blockedOf(f, runId);
}

// The open decision of a blocked run and the session B first ran under.
export function blockedOf(f: S17Fixture, runId: string): Blocked {
  const decisionId = (ledgerRows<{ decision_id: string }>(f.roots, "SELECT decision_id FROM decisions WHERE run_id = ? AND state = 'open'", runId)[0] as { decision_id: string }).decision_id;
  const firstSession = (ledgerRows<{ gsd_session: string }>(f.roots, "SELECT gsd_session FROM work_items WHERE run_id = ? AND item_id = 'B'", runId)[0] as { gsd_session: string }).gsd_session;
  return { f, runId, decisionId, firstSession };
}

// The host script of the resumed run: B's resumed call finishes the item (it edits the file B parked, so the parked content is read first) under its own quick
// directory, and records what it was asked and what it found in the clone.
export function resumedHost(recordTo: string, extra: FakeRunOptions = {}): FakeRunOptions {
  const resumed: FakeRunOptions = {
    edits: { 'src/status.ts': 'export const status = 410;\nexport const resumed = true;\n' },
    summary: true,
    verification: 'passed',
    quickId: '261105-fk2-resume',
    recordTo,
    observe: ['src/status.ts'],
    ...extra,
  };
  return { perItem: { A: unitOf('A'), B: { ...unitOf('B'), resume: resumed }, C: unitOf('C'), D: unitOf('D') } };
}

// A clock a test moves: it follows the real time and adds an offset, so what the supervisor does in real time (leases, git) keeps working while a test
// makes hours pass between two calls.
export class MovableClock implements Clock {
  #offsetMs = 0;
  nowMs(): number {
    return Date.now() + this.#offsetMs;
  }
  advance(ms: number): void {
    this.#offsetMs += ms;
  }
  // Moves the clock so that it reads `ms` now (never backwards).
  setTo(ms: number): void {
    const delta = ms - this.nowMs();
    assert.ok(delta >= -5, `the clock does not run backwards (${delta} ms)`);
    this.#offsetMs += delta;
  }
}

// The profile config is hand-edited JSON; resolveProfile leaves an existing file alone.
export function writeProfileConfig(roots: CliRoots, extra: Record<string, unknown>): void {
  const path = configPathFor(roots.AVARICE_CONFIG_HOME, 'personal-local');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify({ schema: 1, profile: 'personal-local', dataRoot: roots.AVARICE_DATA_ROOT, workRoot: roots.AVARICE_WORK_ROOT, ...extra }, null, 2)}\n`, { mode: 0o600 });
}
