// avarice approve <apr id> | avarice approve --revoke <approval id> (plan 04-16; FR-12). Skeleton: the behavior arrives with the GREEN commit.
import type { AppDeps } from '../../app/deps.ts';
import type { Io, ParsedArgs } from '../args.ts';
import { errorLine } from '../render/style.ts';

export async function run(_args: ParsedArgs, _deps: AppDeps, io: Io): Promise<number> {
  io.err(`${errorLine('approve', 'not implemented')}\n`);
  return 70;
}
