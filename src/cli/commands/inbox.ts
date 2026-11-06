// avarice inbox [--json]: the open decisions and the runs that wait for a review. Read-only, offline, no lease. Exit 0, 64 for an
// argument it does not take, 70 when the ledger cannot be read. Answering a decision is Phase 3 (`decide`).
import { describeError } from '../../adapters/sqlite/db.ts';
import { getInbox } from '../../app/run-status.ts';
import type { AppDeps } from '../../app/deps.ts';
import type { Io, ParsedArgs } from '../args.ts';
import { renderInbox } from '../render/run-view.ts';
import { errorLine } from '../render/style.ts';
import { terminalWidth } from '../render/table.ts';

export const readOnly = true;
export const booleanFlags = ['json'] as const;

export function usage(args: ParsedArgs): string | undefined {
  if (args.positionals.length > 0) return `inbox takes no argument, found ${JSON.stringify(args.positionals[0])}\nusage: avarice inbox [--json]`;
  return undefined;
}

export function run(args: ParsedArgs, deps: AppDeps, io: Io): number {
  const inbox = getInbox(deps.ledger);
  if (!inbox.ok) {
    io.err(`${errorLine('inbox', `failed: ${describeError(inbox.error)}`)}\n`);
    return 70;
  }
  io.out(args.flags['json'] === true ? JSON.stringify(inbox.value, null, 2) + '\n' : renderInbox(inbox.value, deps.clock.nowMs(), terminalWidth(process.stdout.columns)));
  return 0;
}
