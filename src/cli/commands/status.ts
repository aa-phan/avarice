// avarice status [--json]: read-only, offline, no lease.
import { describeError } from '../../adapters/sqlite/db.ts';
import { getStatus, renderStatus } from '../../app/status.ts';
import type { AppDeps } from '../../app/deps.ts';
import type { Io, ParsedArgs } from '../args.ts';

export const readOnly = true;
export const booleanFlags = ['json'] as const;

export function run(args: ParsedArgs, deps: AppDeps, io: Io): number {
  const status = getStatus(deps.ledger, deps.clock.nowMs());
  if (!status.ok) {
    io.err(`avarice: status failed: ${describeError(status.error)}\n`);
    return 70;
  }
  io.out(args.flags['json'] === true ? JSON.stringify(status.value, null, 2) + '\n' : renderStatus(status.value));
  return 0;
}
