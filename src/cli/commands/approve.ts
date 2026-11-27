// avarice approve <apr id> | avarice approve --revoke <approval id> (plan 04-16; FR-12, FR-13, ADR-005, T-04-43).
// The owner's one way to approve a privileged action. `<apr id>` is the request a denied action named (`approval-required:<apr id>`): the command shows
// the action, its scope and a redacted summary of its parameters, asks, and on yes inserts one approval for exactly those parameters, usable once and
// expiring 30 minutes after it was granted. `--revoke <approval id>` sets revoked_at on an approval that was not consumed. Nothing else writes an approval:
// a plan approval, a decision answer and a contract amendment do not (FR-13).
//
// It refuses inside a run (AVARICE_RUN), without a terminal on standard input and output, and from the process tree of a run, before the profile is
// resolved, so a refusal creates nothing (CS-11), and then for a profile that is not the user's own. Exit 0 approved, declined or revoked; 3 a request
// already approved, or an approval already revoked or consumed; 64 a usage error, an unknown request or approval, a refusal; 70 an internal failure.
import { describeError } from '../../adapters/sqlite/db.ts';
import type { AppDeps } from '../../app/deps.ts';
import { APPROVAL_TTL_MS } from '../../domain/approval.ts';
import type { PortError } from '../../domain/result.ts';
import type { Io, ParsedArgs } from '../args.ts';
import { ownsProfile, refuseOutsideTerminal, responderName } from '../identity.ts';
import type { IdentityContext } from '../identity.ts';
import { errorLine, stripControl } from '../render/style.ts';
import { askStdin } from './contract.ts';

const EXIT_NOT_APPLIED = 3;
const EXIT_USAGE = 64;
const EXIT_INTERNAL = 70;
const REQUEST_ID = /^apr_[0-9A-Za-z]{4,64}$/;
const APPROVAL_ID = /^apv_[0-9A-Za-z]{4,64}$/;
const USAGE = 'usage: avarice approve <approval request id>\n       avarice approve --revoke <approval id>';

export const booleanFlags: readonly string[] = ['revoke'];

// What is named: the approval to revoke (`--revoke <id>` or `--revoke=<id>`), or the request to approve.
function target(args: ParsedArgs): { revoke: boolean; id: string | undefined; extra: number } {
  const flag = args.flags['revoke'];
  if (flag === undefined) return { revoke: false, id: args.positionals[0], extra: args.positionals.length - 1 };
  if (typeof flag === 'string') return { revoke: true, id: flag, extra: args.positionals.length };
  return { revoke: true, id: args.positionals[0], extra: args.positionals.length - 1 };
}

// Checked before the profile is resolved, so a refusal or a usage error leaves nothing on disk (CS-11). Without the context that tells where the
// command runs, it refuses.
export function usage(args: ParsedArgs, env: NodeJS.ProcessEnv = process.env, context?: IdentityContext): string | undefined {
  const refused = context === undefined ? 'needs an interactive terminal' : refuseOutsideTerminal(env, context);
  if (refused !== undefined) return refused;
  const message = (text: string): string => `${text}\n${USAGE}`;
  const { revoke, id, extra } = target(args);
  if (id === undefined || id === '') return message(revoke ? 'an approval ID (apv_...) is required' : 'an approval request ID (apr_...) is required');
  if (extra > 0) return message('give one ID');
  if (revoke && !APPROVAL_ID.test(id)) return message('--revoke takes an approval ID (apv_...)');
  if (!revoke && !REQUEST_ID.test(id)) return message('an approval request ID is apr_...');
  return undefined;
}

function fail(io: Io, error: PortError): number {
  switch (error.kind) {
    case 'not_found':
      io.err(`${errorLine('approve', `no such ${error.ref.startsWith('approval request ') ? 'approval request' : 'approval'} (${describeError(error)})`)}\n`);
      return EXIT_USAGE;
    case 'invalid':
      io.err(`${errorLine('approve', describeError(error))}\n`);
      return EXIT_USAGE;
    case 'conflict':
      io.err(`${errorLine('approve', `not applied: ${describeError(error)}`)}\n`);
      return EXIT_NOT_APPLIED;
    default:
      io.err(`${errorLine('approve', `failed: ${describeError(error)}`)}\n`);
      return EXIT_INTERNAL;
  }
}

export async function run(args: ParsedArgs, deps: AppDeps, io: Io): Promise<number> {
  const { revoke, id } = target(args);
  const named = id as string;

  // Only the user who owns the profile writes into it; the others are refused without a write.
  if (!ownsProfile(deps.profile.dataRoot)) {
    io.err(`${errorLine('approve', 'only the user who owns the profile approves an action')}\n`);
    return EXIT_USAGE;
  }

  if (revoke) {
    const revoked = deps.ledger.revokeApproval(named, deps.clock.nowMs());
    if (!revoked.ok) return fail(io, revoked.error);
    io.out(`approval ${named} revoked (${stripControl(revoked.value.action)} in ${stripControl(revoked.value.scope)})\n`);
    return 0;
  }

  const found = deps.ledger.findApprovalRequest(named);
  if (!found.ok) return fail(io, found.error);
  const request = found.value;
  if (request === null) return fail(io, { kind: 'not_found', ref: `approval request ${named}` });

  io.out(`approval request ${named}\n`);
  io.out(`  action:  ${stripControl(request.action)}\n`);
  io.out(`  scope:   ${stripControl(request.scope)}\n`);
  io.out(`  params:  ${stripControl(request.paramsSummary)}\n`);
  io.out(`  digest:  ${stripControl(request.paramsDigest)}\n`);
  io.out(`  grants:  one use of ${stripControl(request.action)} with exactly these parameters, for ${APPROVAL_TTL_MS / 60_000} minutes\n`);

  // The question goes to whoever supplied the io (the shell's prompt, a test) or, on a real terminal, to standard input. With no way to ask, nothing is granted.
  const ask = io.ask ?? (process.stdin.isTTY === true && process.stdout.isTTY === true ? askStdin : undefined);
  if (ask === undefined) {
    io.err(`${errorLine('approve', 'needs an interactive terminal to ask')}\n`);
    return EXIT_USAGE;
  }
  const answer = (await ask(`approve ${stripControl(request.action)} with these parameters? [y/N]: `))?.trim().toLowerCase() ?? '';
  if (answer !== 'y' && answer !== 'yes') {
    io.out('not approved\n');
    return 0;
  }

  const granted = deps.ledger.grantApproval({
    scope: request.scope,
    action: request.action,
    paramsDigest: request.paramsDigest,
    grantedBy: `owner:${responderName()}`,
    requestId: request.requestId,
    nowMs: deps.clock.nowMs(),
  });
  if (!granted.ok) return fail(io, granted.error);
  io.out(`approval ${granted.value.approvalId} granted for ${stripControl(request.action)}; used once, expires ${granted.value.expiresAt}\n`);
  return 0;
}
