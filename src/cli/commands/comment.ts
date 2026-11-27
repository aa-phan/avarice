// avarice comment --print --run <runId>
// The manual equivalent of writing to a tracker (plan 04-27; FR-19): prints the body of a comment for the owner to paste. The body is built only from ledger rows (the run's
// title and state, its items' states, the checks that passed with the revision each passed at, the decisions still open); nothing is posted and nothing is written, so the
// store is opened read-only. Without `--print` the command refuses: it has no way to post.
//
// Exit 0 printed, 3 an unknown run, 64 a usage error, 70 an internal failure.
import type { AppDeps } from '../../app/deps.ts';
import { renderComment } from '../../app/manual-inputs.ts';
import type { Io, ParsedArgs } from '../args.ts';
import { failure, runIdProblem } from '../manual-command.ts';

const USAGE = 'usage: avarice comment --print --run <runId>';

export const readOnly = true;
export const needsGsd = false;
export const booleanFlags = ['print'] as const;

export function usage(args: ParsedArgs): string | undefined {
  const message = (text: string): string => `${text}\n${USAGE}`;
  if (args.positionals.length > 0) return message('comment takes no argument');
  if (args.flags['print'] !== true) return message('--print is required: this command prints the comment and cannot post it');
  const run = runIdProblem(args.flags['run']);
  if (run !== undefined) return message(run);
  return undefined;
}

export function run(args: ParsedArgs, deps: AppDeps, io: Io): number {
  const body = renderComment(deps, args.flags['run'] as string);
  if (!body.ok) return failure(io, 'comment', body.error);
  io.out(body.value);
  return 0;
}
