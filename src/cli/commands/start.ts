// avarice start --brief <file> --policy routine [--project <id>] [--budget name=value]...
// Authorizes one run: compiles the contract from the preset, the repository conventions and the brief, stores it with its
// budgets and work item, and prints a one-screen summary. Running the command is the authorization; it asks nothing and
// reads no input (RC-3). Exit 0 when the run is stored in contract_ready, 3 when a start rule refused it (nothing is created),
// 64 for a usage error, an invalid brief, an invalid budget override or a G0 static failure, 70 for an internal failure.
//
// Then (D-18) it spawns a detached `avarice supervise <runId>` and returns: the run is recorded and the supervisor owns it, so closing
// the shell leaves it running. With `--wait` it polls the ledger and exits 0 at `ready_for_review` and 3 at any other stop state or when
// the supervisor died with the run unfinished, printing the final result line and, when interrupted, how to continue.
import { startRun } from '../../app/run-start.ts';
import { spawnSupervisor, waitForRun } from '../spawn-supervisor.ts';
import type { WaitResult } from '../spawn-supervisor.ts';
import type { RunStartOutcome } from '../../app/run-start.ts';
import { ROUTINE_POLICY } from '../../domain/run-contract.ts';
import type { AppDeps } from '../../app/deps.ts';
import { parseBudgetFlags } from '../args.ts';
import type { Io, ParsedArgs } from '../args.ts';
import { errorLine, resultLine, stripControl, usd } from '../render/style.ts';

export const EXIT_REFUSED = 3;
const EXIT_USAGE = 64;
const EXIT_INTERNAL = 70;

export const booleanFlags: readonly string[] = ['wait'];

const USAGE = `usage: avarice start --brief <file> --policy ${ROUTINE_POLICY} [--project <id>] [--budget name=value]... [--wait]`;

// Checked before the profile is resolved, so a usage error leaves nothing on disk.
export function usage(args: ParsedArgs): string | undefined {
  const brief = args.flags['brief'];
  if (brief === undefined || brief === true || brief === '') return `--brief <file> is required\n${USAGE}`;
  const policy = args.flags['policy'];
  if (policy === undefined || policy === true) return `--policy ${ROUTINE_POLICY} is required\n${USAGE}`;
  if (policy !== ROUTINE_POLICY) return `--policy must be ${ROUTINE_POLICY}, not ${JSON.stringify(policy)}\n${USAGE}`;
  const project = args.flags['project'];
  if (project === true || project === '') return `--project needs a project ID\n${USAGE}`;
  if (args.positionals.length > 0) return `start takes no positional argument, found ${JSON.stringify(args.positionals[0])}\n${USAGE}`;
  const overrides = parseBudgetFlags(args);
  if (typeof overrides === 'string') return `${overrides}\n${USAGE}`;
  return undefined;
}

const list = (items: readonly string[]): string => (items.length === 0 ? 'none' : items.map(stripControl).join(', '));

// One screen: the result line, then what was authorized.
export function renderStart(outcome: RunStartOutcome): string {
  const c = outcome.contract;
  const b = c.budgets;
  const item = c.intent.workItems[0];
  const criteria = c.intent.acceptance.length;
  return [
    resultLine(`run ${outcome.runId}`, 'contract_ready'),
    `project: ${stripControl(outcome.projectId)} (${stripControl(outcome.repoPath)})`,
    `base revision: ${outcome.contract.workspace.baseRevision}`,
    `conventions revision: ${outcome.conventionsRevision}`,
    `title: ${stripControl(c.intent.title)}`,
    `acceptance: ${criteria} ${criteria === 1 ? 'criterion' : 'criteria'}`,
    `write paths: ${list(c.files.write)}`,
    `required checks: ${list(c.verification.requiredChecks)}`,
    `budgets: ${usd(b.costUsd.perRun)} per run, ${usd(b.costUsd.perInvocation)} per invocation; ${b.wallClockMinutes} min, ${b.invocations} invocations, ${b.toolCalls} tool calls`,
    `model: ${stripControl(item?.model ?? 'unknown')}`,
    `contract: ${c.policyPreset} v${c.contractVersion} ${outcome.contractDigest}`,
    `stored at: ${stripControl(outcome.contractPath)}`,
    '',
  ].join('\n');
}

// What a finished wait prints after the summary: the final result line, and for an interrupted run the way to continue.
export function renderWait(runId: string, result: WaitResult | { kind: 'error'; message: string }): string[] {
  switch (result.kind) {
    case 'final':
      return [resultLine(`run ${runId}`, result.run.state, result.run.reason)];
    case 'interrupted':
      return [
        resultLine(`run ${runId}`, `interrupted in ${result.run.state}`, result.nextAction === null ? null : `next: ${result.nextAction}`),
        `continue with: avarice resume ${stripControl(runId)}`,
      ];
    case 'timeout':
      return [resultLine(`run ${runId}`, result.run.state, result.run.reason), `still running: avarice status shows it; the supervisor keeps working`];
    default:
      return [errorLine('start', result.message)];
  }
}

// The supervisor reads the same three profile roots this command resolved, whatever else its environment says.
function supervisorEnv(deps: AppDeps): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AVARICE_CONFIG_HOME: deps.profile.configHome,
    AVARICE_DATA_ROOT: deps.profile.dataRoot,
    AVARICE_WORK_ROOT: deps.profile.workRoot,
  };
  // Under `node --test` this variable would make a spawned test entry do nothing.
  delete env['NODE_TEST_CONTEXT'];
  return env;
}

const WAIT_MARGIN_MIN = 15;

export async function run(args: ParsedArgs, deps: AppDeps, io: Io): Promise<number> {
  // usage() has vetted the flags; these narrow the types for the compiler.
  const briefPath = args.flags['brief'];
  const policy = args.flags['policy'];
  const projectId = args.flags['project'];
  const overrides = parseBudgetFlags(args);
  if (typeof briefPath !== 'string' || typeof policy !== 'string' || typeof overrides === 'string') {
    io.err(`${errorLine('start', usage(args) ?? 'invalid arguments')}\n`);
    return EXIT_USAGE;
  }

  const started = startRun(deps, {
    cwd: process.cwd(),
    ...(typeof projectId === 'string' ? { projectId } : {}),
    briefPath,
    policy,
    budgetOverrides: overrides,
  });
  if (started.ok) {
    io.out(renderStart(started.value));
    return supervise(deps, io, started.value, args.flags['wait'] === true);
  }
  const failure = started.failure;
  switch (failure.kind) {
    case 'refused':
      io.err(`${errorLine('start', `refused: ${failure.message}`)}\n`);
      return EXIT_REFUSED;
    case 'usage':
      io.err(`${errorLine('start', failure.message)}\n`);
      return EXIT_USAGE;
    default:
      io.err(`${errorLine('start', `failed: ${failure.message}`)}\n`);
      return EXIT_INTERNAL;
  }
}

// Spawns the detached supervisor, records its PID as step `supervisor:spawn`, and with --wait follows the run to where it stops.
async function supervise(deps: AppDeps, io: Io, started: RunStartOutcome, wait: boolean): Promise<number> {
  const { runId } = started;
  const spawned = spawnSupervisor({ entry: process.argv[1] ?? '', runId, env: supervisorEnv(deps), cwd: deps.profile.dataRoot });
  if (!spawned.ok) {
    io.err(`${errorLine('start', `run ${runId} is stored but its supervisor was not started: ${spawned.message}`)}\n`);
    return EXIT_INTERNAL;
  }
  const nowMs = deps.clock.nowMs();
  const recorded = deps.ledger.recordRunStep(runId, { step: 'supervisor:spawn', status: 'completed', result: { pid: spawned.pid }, nowMs, completedAtMs: nowMs });
  if (!recorded.ok) {
    io.err(`${errorLine('start', `run ${runId} is running under supervisor ${spawned.pid} but the spawn step could not be recorded`)}\n`);
    return EXIT_INTERNAL;
  }
  if (!wait) return 0;

  const maxMs = (started.contract.budgets.wallClockMinutes + WAIT_MARGIN_MIN) * 60_000;
  const result = await waitForRun(deps, runId, spawned.pid, { pollMs: 250, maxMs });
  io.out(`${renderWait(runId, result).join('\n')}\n`);
  if (result.kind === 'error') return EXIT_INTERNAL;
  return result.kind === 'final' && result.run.state === 'ready_for_review' ? 0 : EXIT_REFUSED;
}
