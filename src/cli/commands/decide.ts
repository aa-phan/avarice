// avarice decide <decisionId> [<option-key> | --text "..."] [--wait]
// Answers a decision as the owner (plan 03-20; D-13 to D-17, AUT-4, AUT-5). `<option-key>` is one of the numbers the record lists, `--text` is free text
// where the record allows it, and `withdraw` takes back a decision whose only option is withdraw. The answer is recorded as `owner:<os user>` on the
// terminal channel. After an answer or a withdrawal, a blocked run that is now continuable gets the detached supervisor through the one spawn path
// when nobody holds its lease; when a supervisor holds it, nothing starts and its scheduler takes the answered item next (D-16). `decide` changes no
// contract field, budget or scope (D-17): the way to do that is `avarice contract amend`.
//
// With no answer on a terminal the command prints the record and asks `answer (<keys>; empty leaves it open): `: a key, `withdraw`, free text where the
// record allows it, all through the same engine as the one-line form (D-13), or an empty line, which changes nothing and exits 0 with `left open`. On a
// record that carries an amend command, `amend` records the request and chains into the `contract amend` diff and confirmation, pre-filled from the
// record's measured request with the decision set, so one `y` records contract version n+1 and answers the decision in one transaction (D-17).
//
// It refuses inside a run (AVARICE_RUN), without a terminal on standard input and output, and from the process tree of a run, before the profile is
// resolved, so a refusal creates nothing (CS-11), and then for a profile that is not the user's own. Exit 0 answered, withdrawn or an identical answer
// ignored; 3 an answer that was not applied for the state of the decision or the run (closed, stale, answered differently, to be made by an amendment);
// 64 a usage error, an unknown decision, an option or text the record does not allow, a refusal; 70 an internal failure. `--wait` follows a supervisor
// this command started to where the run stops.
import { describeError } from '../../adapters/sqlite/db.ts';
import { planAmendment } from '../../app/amend.ts';
import { decide, findDecision, pickupOf, requestAmendment } from '../../app/decide.ts';
import type { DecideOutcome, Pickup } from '../../app/decide.ts';
import type { AppDeps } from '../../app/deps.ts';
import { amendCommandOf, optionsOf } from '../../domain/decision-policy.ts';
import type { DecisionOption } from '../../domain/decision-policy.ts';
import type { PortError } from '../../domain/result.ts';
import type { DecisionRow } from '../../ports/ledger.ts';
import type { Io, ParsedArgs } from '../args.ts';
import { ownsProfile, refuseOutsideTerminal, responderName } from '../identity.ts';
import type { IdentityContext } from '../identity.ts';
import { renderDecision } from '../render/decision-view.ts';
import { errorLine, stripControl } from '../render/style.ts';
import { isProcessAlive, spawnSupervisor, supervisorEnv, waitForRun } from '../spawn-supervisor.ts';
import { askStdin, confirmAndCommit, renderAmendmentPreview } from './contract.ts';
import { renderWait } from './start.ts';

const EXIT_NOT_APPLIED = 3;
const EXIT_USAGE = 64;
const EXIT_INTERNAL = 70;
const WAIT_MAX_MS = 24 * 60 * 60_000;
const DECISION_ID = /^dec_[0-9A-Za-z]{4,64}$/;
const KEY_MAX_CHARS = 200;
const USAGE = 'usage: avarice decide <decisionId> [<option-key> | --text "..."] [--wait]';
const UNKNOWN_WIDTH = 80;

// The width of the terminal this process writes to, or 80 when it does not say.
function terminalWidth(): number {
  const columns = process.stdout.columns;
  return Number.isInteger(columns) && columns > 0 ? columns : UNKNOWN_WIDTH;
}

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
  const spawned = spawnSupervisor({ entry: process.argv[1] ?? '', runId, env: supervisorEnv(deps, runId), cwd: deps.profile.dataRoot });
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

// Who continues the run after an answer, an amendment or a withdrawal (D-16): a live supervisor takes the answered item next, or this command starts the
// detached one through the one spawn path, or nothing happens.
async function reportPickup(deps: AppDeps, args: ParsedArgs, io: Io, pickup: Pickup, decision: DecisionRow, withdrawn: boolean): Promise<number> {
  const runId = decision.runId;
  if (pickup === 'live-supervisor') {
    const item = decision.affectedItems[0];
    io.out(`${withdrawn || item === undefined ? `run ${runId}: a running supervisor continues the run` : `run ${runId}: a running supervisor takes item ${stripControl(item)} next`}\n`);
    return 0;
  }
  if (pickup === 'spawn') return startSupervisor(deps, io, runId, args.flags['wait'] === true);
  return 0;
}

// The question of the prompt: what can be typed for this record. A key of an option, `withdraw` when the record lists it, `text` when it takes free
// text, and `amend` when it carries an amend command.
function promptOf(options: readonly DecisionOption[], amendable: boolean): string {
  const parts = options.filter((o) => o.kind === 'choice').map((o) => stripControl(o.key));
  if (options.some((o) => o.kind === 'withdraw')) parts.push('withdraw');
  if (options.some((o) => o.kind === 'text')) parts.push('text');
  if (amendable) parts.push('amend');
  return `answer (${parts.length === 0 ? '' : `${parts.join(', ')}; `}empty leaves it open): `;
}

// `amend` at the prompt of a decision that is answered by an amendment (D-17): the request is recorded, the amendment the record suggests is planned
// with --decision set and shown, and one confirmation writes contract version n+1 and answers the decision in the same transaction. This command
// never widens anything itself: what it shows is the diff of `contract amend`, and nothing is written without the `y`.
async function amendChain(deps: AppDeps, args: ParsedArgs, io: Io, decisionId: string): Promise<number> {
  const requested = requestAmendment(deps, decisionId, deps.clock.nowMs());
  if (!requested.ok) return fail(io, requested.error);
  const { decision, command, request } = requested.value;
  if (request.addWrite === undefined && request.budgets === undefined) {
    // The record measured nothing to pre-fill, so there is nothing to confirm here: the owner amends with the command, naming the value.
    io.out(`decision ${decisionId} is answered by an amendment, and the record has no measured request to pre-fill\n`);
    io.out(`amend with: ${stripControl(command)}\n`);
    return EXIT_NOT_APPLIED;
  }
  const planned = planAmendment(deps, decision.runId, { reason: `answer to ${decisionId}`, ...request, decisionId });
  if (!planned.ok) return fail(io, planned.error);
  io.out(renderAmendmentPreview(planned.value));
  const confirmed = await confirmAndCommit(deps, io, planned.value, `owner:${responderName()}`);
  if (confirmed.kind === 'failed') return confirmed.code;
  if (confirmed.kind === 'declined') {
    io.out('left open\n');
    return 0;
  }
  const pickup = pickupOf(deps, decision.runId, deps.clock.nowMs());
  if (!pickup.ok) return fail(io, pickup.error);
  return reportPickup(deps, args, io, pickup.value, decision, false);
}

// No answer on the command line: the record, then (when someone can answer) the question. What is typed goes through the same engine as the one-line
// form. An empty line or end of input leaves the decision as it is.
async function promptForAnswer(deps: AppDeps, args: ParsedArgs, io: Io, decision: DecisionRow): Promise<number> {
  const options = optionsOf(decision.options);
  const amendable = amendCommandOf(decision.consequences, decision.decisionId) !== null;
  const answer = await (io.ask as NonNullable<Io['ask']>)(promptOf(options, amendable));
  const entry = answer === undefined ? '' : answer.trim();
  if (entry === '') {
    io.out('left open\n');
    return 0;
  }
  const listed = options.some((o) => o.kind !== 'text' && o.key === entry);
  if (entry === 'amend' && !listed && amendable) return amendChain(deps, args, io, decision.decisionId);
  if (listed || !options.some((o) => o.kind === 'text')) return answerWith(deps, args, io, decision.decisionId, { key: entry.slice(0, KEY_MAX_CHARS) });
  return answerWith(deps, args, io, decision.decisionId, { text: entry });
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
  // No answer given: print the record, then ask when an open decision can be answered here (D-13). The question goes to whoever supplied the io (the
  // shell's prompt, a test) or, on a real terminal, to standard input. With no way to ask, or for a decision that is not open, the record and the way
  // to answer are printed and nothing is written.
  if (key === undefined && typeof text !== 'string') {
    const found = findDecision(deps, decisionId);
    if (!found.ok) return fail(io, found.error);
    io.out(renderDecision(found.value, terminalWidth()));
    const ask = io.ask ?? (process.stdin.isTTY === true && process.stdout.isTTY === true ? askStdin : undefined);
    if (ask === undefined || found.value.state !== 'open') {
      io.err(`${errorLine('decide', 'give an option key or --text')}\n${USAGE}\n`);
      return EXIT_USAGE;
    }
    return promptForAnswer(deps, args, { ...io, ask }, found.value);
  }
  return answerWith(deps, args, io, decisionId, key !== undefined ? { key } : { text: text as string });
}

// One answer, from the command line or the prompt, through the engine: validated in the order of D-15, applied or refused and recorded, and the run
// picked up.
async function answerWith(deps: AppDeps, args: ParsedArgs, io: Io, decisionId: string, answer: { key: string } | { text: string }): Promise<number> {
  const key = 'key' in answer ? answer.key : undefined;
  // usage() has already refused AVARICE_RUN, a pipe and a run's process tree, and the profile was just shown to be the user's own.
  const result = decide(deps, {
    decisionId,
    answer,
    identity: { interactive: true, underRun: false, inRunTree: false, ownsProfile: true },
    responder: responderName(),
    nowMs: deps.clock.nowMs(),
  });
  if (!result.ok) return fail(io, result.error);
  const outcome = result.value;

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
  return reportPickup(deps, args, io, outcome.pickup, outcome.decision, outcome.kind === 'withdrawn');
}
