// avarice pr record <url> --run <runId>
// The manual equivalent of opening a pull request (plan 04-27; FR-19, FR-18): the owner opens it in the web UI and records its URL as a reference of the run. Ledger only:
// no network call is made, so nothing says whether the pull request exists or what state it is in (a change-request adapter is a later phase's). The reference is the
// provider `github` (an enterprise host serves the same URL shape), the kind `pull-request`, the ID `<owner>/<repository>#<number>` as written, and the URL as its scope.
//
// It refuses inside a run (AVARICE_RUN, or the run's process tree) before the profile is resolved, and needs no terminal. Exit 0 recorded (or already recorded), 3 an
// unknown run, 64 a usage error or a URL that is not a pull request, 70 an internal failure.
import type { AppDeps } from '../../app/deps.ts';
import { parsePullRequestUrl, recordPullRequest } from '../../app/manual-inputs.ts';
import { describeError } from '../../adapters/sqlite/db.ts';
import type { Io, ParsedArgs } from '../args.ts';
import { refuseInsideRun, responderName } from '../identity.ts';
import type { IdentityContext } from '../identity.ts';
import { failure, runIdProblem } from '../manual-command.ts';
import { stripControl } from '../render/style.ts';

const USAGE = 'usage: avarice pr record <url> --run <runId>';

export const readOnly = false;
export const needsGsd = false;

// Checked before the profile is resolved, so a refusal or a usage error leaves nothing on disk (T-04-74). The URL is judged here too, so a bad one creates nothing.
export function usage(args: ParsedArgs, env: NodeJS.ProcessEnv = process.env, context?: IdentityContext): string | undefined {
  const refused = refuseInsideRun(env, context);
  if (refused !== undefined) return refused;
  const message = (text: string): string => `${text}\n${USAGE}`;
  const [verb, url, ...rest] = args.positionals;
  if (verb !== 'record' || url === undefined || rest.length > 0) return message('the form is `pr record <url>`');
  const parsed = parsePullRequestUrl(url);
  if (!parsed.ok) return message(describeError(parsed.error));
  const run = runIdProblem(args.flags['run']);
  if (run !== undefined) return message(run);
  return undefined;
}

export function run(args: ParsedArgs, deps: AppDeps, io: Io): number {
  const recorded = recordPullRequest(deps, { runId: args.flags['run'] as string, url: args.positionals[1] as string, by: responderName(), nowMs: deps.clock.nowMs() });
  if (!recorded.ok) return failure(io, 'pr', recorded.error);
  const { ref, parts, duplicate } = recorded.value;
  io.out(`${duplicate ? 'already recorded' : 'recorded'} pull request ${stripControl(ref.id)} on ${stripControl(parts.host)} for run ${args.flags['run'] as string}; nothing was fetched\n`);
  return 0;
}
