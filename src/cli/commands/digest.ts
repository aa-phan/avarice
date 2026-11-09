// avarice digest (plan 03-23). Stub: filled in by the GREEN commit of the same task.
import { runDigest } from '../../app/digest.ts';
import type { AppDeps } from '../../app/deps.ts';
import type { Io, ParsedArgs } from '../args.ts';

export function usage(_args: ParsedArgs, _env?: NodeJS.ProcessEnv): string | undefined {
  return undefined;
}

export async function run(_args: ParsedArgs, deps: AppDeps, io: Io): Promise<number> {
  const result = await runDigest(deps, deps.clock.nowMs());
  if (!result.ok) {
    io.err('digest: not implemented\n');
    return 70;
  }
  return 0;
}
