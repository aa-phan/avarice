// avarice status [--json]: read-only, offline, no lease.
import { describeError } from '../../adapters/sqlite/db.ts';
import { getStatus } from '../../app/status.ts';
import type { AppDeps } from '../../app/deps.ts';
import type { Io, ParsedArgs } from '../args.ts';
import { renderStatus } from '../render/status-view.ts';
import { errorLine } from '../render/style.ts';
import { terminalWidth } from '../render/table.ts';

export const readOnly = true;
export const booleanFlags = ['json'] as const;

export function run(args: ParsedArgs, deps: AppDeps, io: Io): number {
  const nowMs = deps.clock.nowMs();
  const status = getStatus(deps.ledger, nowMs);
  if (!status.ok) {
    io.err(`${errorLine('status', `failed: ${describeError(status.error)}`)}\n`);
    return 70;
  }
  io.out(args.flags['json'] === true ? JSON.stringify(status.value, null, 2) + '\n' : renderStatus(status.value, { width: terminalWidth(process.stdout.columns), nowMs }));
  return 0;
}
