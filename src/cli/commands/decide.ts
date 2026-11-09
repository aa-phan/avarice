// avarice decide <decisionId> [<option-key> | --text "..."] [--wait]
// Answers a decision as the owner (plan 03-20; D-13 to D-17, AUT-4, AUT-5). `<option-key>` is one of the numbers the record lists, `--text` is free text
// where the record allows it, and `withdraw` takes back a decision whose only option is withdraw. The answer is recorded as `owner:<os user>` on the
// terminal channel. After an answer or a withdrawal, a blocked run that is now continuable gets the detached supervisor through the one spawn path
// when nobody holds its lease; when a supervisor holds it, nothing starts and its scheduler takes the answered item next (D-16). `decide` changes no
// contract field, budget or scope (D-17): the way to do that is `avarice contract amend`.
//
// It refuses inside a run (AVARICE_RUN), without a terminal on standard input and output, and from the process tree of a run, before the profile is
// resolved, so a refusal creates nothing (CS-11), and then for a profile that is not the user's own. Exit 0 answered, withdrawn or an identical answer
// ignored; 3 an answer that was not applied for the state of the decision or the run (closed, stale, answered differently, to be made by an amendment);
// 64 a usage error, an unknown decision, an option or text the record does not allow, a refusal; 70 an internal failure. `--wait` follows a supervisor
// this command started to where the run stops.
import { describeError } from '../../adapters/sqlite/db.ts';
import { decide } from '../../app/decide.ts';
import type { DecideOutcome } from '../../app/decide.ts';
import type { AppDeps } from '../../app/deps.ts';
import type { PortError } from '../../domain/result.ts';
import type { Io, ParsedArgs } from '../args.ts';
import { ownsProfile, refuseOutsideTerminal, responderName } from '../identity.ts';
import type { IdentityContext } from '../identity.ts';
import { errorLine, stripControl } from '../render/style.ts';
import { isProcessAlive, spawnSupervisor, supervisorEnv, waitForRun } from '../spawn-supervisor.ts';
import { renderWait } from './start.ts';

const EXIT_NOT_APPLIED = 3;
const EXIT_USAGE = 64;
const EXIT_INTERNAL = 70;
const WAIT_MAX_MS = 24 * 60 * 60_000;
const DECISION_ID = /^dec_[0-9A-Za-z]{4,64}$/;
const KEY_MAX_CHARS = 200;
const USAGE = 'usage: avarice decide <decisionId> [<option-key> | --text "..."] [--wait]';

export const booleanFlags: readonly string[] = ['wait'];

// Checked before the profile is resolved, so a refusal or a usage error leaves nothing on disk: no data root, no store, no row, no event (CS-11). The
// refusals come first: inside a run (AVARICE_RUN), without a terminal on standard input and output, and from the process tree of a run. Without the
// context that tells where the command runs, it refuses.
export function usage(args: ParsedArgs, env: NodeJS.ProcessEnv = process.env, context?: IdentityContext): string | undefined {
  const refused = context === undefined ? 'needs an interactive terminal' : refuseOutsideTerminal(env, context);
  if (refused !== undefined) return refused;
  const message = (text: string): string => `${text}\n${USAGE}`;
  const [id, key, ...rest] = args.positionals;
  if (id === undefined || !DECISION_ID.test(id)) return message('a decision ID (dec_...) is required');
  if (rest.length > 0) return message('give one option key, or --text with the text');
  const text = args.flags['text'];
  if (text !== undefined && (typeof text !== 'string' || text === '')) return message('--text needs the text of the answer');
  if (key !== undefined && text !== undefined) return message('give an option key or --text, not both');
  if (key !== undefined && (key === '' || key.length > KEY_MAX_CHARS)) return message(`an option key is 1 to ${KEY_MAX_CHARS} characters`);
  return undefined;
}

function fail(io: Io, error: PortError): number {
  switch (error.kind) {
    case 'not_found':
      io.err(`${errorLine('decide', `no such decision (${describeError(error)})`)}\n`);
      return EXIT_USAGE;
    case 'invalid':
      io.err(`${errorLine('decide', describeError(error))}\n`);
      return EXIT_USAGE;
    case 'conflict':
      io.err(`${errorLine('decide', `not applied: ${describeError(error)}`)}\n`);
      return EXIT_NOT_APPLIED;
    default:
      io.err(`${errorLine('decide', `failed: ${describeError(error)}`)}\n`);
      return EXIT_INTERNAL;
  }
}

// A refusal that is about the state of the decision exits 3, the same as a contract that moved; one about what was typed or who typed it exits 64.
function rejectedExit(outcome: DecideOutcome): number {
  return outcome.check !== undefined && ['decision-answered', 'decision-withdrawn', 'decision-stale', 'decision-not-open'].includes(outcome.check) ? EXIT_NOT_APPLIED : EXIT_USAGE;
}

async function startSupervisor(deps: AppDeps, io: Io, runId: string, wait: boolean): Promise<number> {
  const spawned = spawnSupervisor({ entry: process.argv[1] ?? '', runId, env: supervisorEnv(deps), cwd: deps.profile.dataRoot });
  if (!spawned.ok) {
    io.err(`${errorLine('decide', `run ${runId} was not continued: ${spawned.message}`)}\n`);
    return EXIT_INTERNAL;
  }
  const nowMs = deps.clock.nowMs();
  const steps = deps.ledger.getRunSteps(runId);
  const attempt = steps.ok ? steps.value.filter((s) => s.step === 'supervisor:decide').length + 1 : 1;
  const recorded = deps.ledger.recordRunStep(runId, { step: 'supervisor:decide', attempt, status: 'completed', result: { pid: spawned.pid }, nowMs, completedAtMs: nowMs });
  if (!recorded.ok) {
    io.err(`${errorLine('decide', `run ${runId} continues under supervisor ${spawned.pid} but the spawn step could not be recorded`)}\n`);
    return EXIT_INTERNAL;
  }
  io.out(`run ${runId}: supervisor started\n`);
  if (!wait) return 0;
  // The run is already in a stop state (blocked_on_decision) when the supervisor starts, so the wait first lets the supervisor take it up.
  const giveUpAt = Date.now() + WAIT_MAX_MS;
  for (;;) {
    const read = deps.ledger.getRun(runId);
    if (!read.ok || read.value.state !== 'blocked_on_decision' || !isProcessAlive(spawned.pid) || Date.now() >= giveUpAt) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const result = await waitForRun(deps, runId, spawned.pid, { pollMs: 250, maxMs: Math.max(0, giveUpAt - Date.now()) });
  io.out(`${renderWait(runId, result).join('\n')}\n`);
  if (result.kind === 'error') return EXIT_INTERNAL;
  return result.kind === 'final' && result.run.state === 'ready_for_review' ? 0 : EXIT_NOT_APPLIED;
}

export async function run(args: ParsedArgs, deps: AppDeps, io: Io): Promise<number> {
  const decisionId = args.positionals[0] as string;
  const key = args.positionals[1];
  const text = args.flags['text'];

  // Only the user who owns the profile writes into it; the others are refused without a write.
  if (!ownsProfile(deps.profile.dataRoot)) {
    io.err(`${errorLine('decide', 'only the user who owns the profile answers a decision')}\n`);
    return EXIT_USAGE;
  }
  if (key === undefined && typeof text !== 'string') {
    io.err(`${errorLine('decide', 'give an option key or --text')}\n${USAGE}\n`);
    return EXIT_USAGE;
  }

  // usage() has already refused AVARICE_RUN, a pipe and a run's process tree, and the profile was just shown to be the user's own.
  const result = decide(deps, {
    decisionId,
    answer: key !== undefined ? { key } : { text: text as string },
    identity: { interactive: true, underRun: false, inRunTree: false, ownsProfile: true },
    responder: responderName(),
    nowMs: deps.clock.nowMs(),
  });
  if (!result.ok) return fail(io, result.error);
  const outcome = result.value;
  const runId = outcome.decision.runId;

  switch (outcome.kind) {
    case 'rejected':
      io.err(`${errorLine('decide', outcome.detail ?? outcome.check ?? 'the answer was not applied')}\n`);
      return rejectedExit(outcome);
    case 'duplicate':
      io.out(`decision ${decisionId} already answered; ignored\n`);
      return 0;
    case 'amendment-requested':
      io.out(`decision ${decisionId} is answered by an amendment, not by an option; nothing was applied\n`);
      io.out(`amend with: ${stripControl(outcome.amendCommand ?? '')}\n`);
      io.out(`or take it back: avarice decide ${decisionId} withdraw\n`);
      return EXIT_NOT_APPLIED;
    case 'stale': {
      const next = outcome.reopened?.decisionId ?? '';
      const { opened, latest } = outcome.contractVersions ?? { opened: 0, latest: 0 };
      io.out(`the run changed since decision ${decisionId} was asked${opened !== latest ? ` (contract v${opened} -> v${latest})` : ''}; your answer was not applied\n`);
      io.out(`decision ${next} asks the same question on the new state, with your answer kept as context\n`);
      io.out(`answer it with: avarice decide ${next} <option-key>\n`);
      return EXIT_NOT_APPLIED;
    }
    default:
      break;
  }

  io.out(`${outcome.kind === 'withdrawn' ? `decision ${decisionId} withdrawn` : `decision ${decisionId} answered (${stripControl(key ?? 'text')})`}\n`);
  if (outcome.pickup === 'live-supervisor') {
    const item = outcome.decision.affectedItems[0];
    io.out(`${outcome.kind === 'withdrawn' || item === undefined ? `run ${runId}: a running supervisor continues the run` : `run ${runId}: a running supervisor takes item ${stripControl(item)} next`}\n`);
    return 0;
  }
  if (outcome.pickup === 'spawn') return startSupervisor(deps, io, runId, args.flags['wait'] === true);
  return 0;
}
