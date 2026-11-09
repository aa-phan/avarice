// avarice digest: one batched banner that counts the open decisions and the runs ready for review, or nothing when none waits (plan 03-23; D-23,
// D-24; AUT-6). launchd runs it at the profile's digest times (`avarice schedule install`), so it needs no terminal; a person can run it too.
// It refuses inside a run (AVARICE_RUN) before the profile is resolved. Exit 0 when it posted, held the banner for quiet hours, or had nothing to say;
// 64 for a refusal or an argument; 70 when the banner was not delivered after the last attempt or the ledger cannot be read. It answers no decision.
import { describeError } from '../../adapters/sqlite/db.ts';
import { runDigest } from '../../app/digest.ts';
import type { AppDeps } from '../../app/deps.ts';
import type { Io, ParsedArgs } from '../args.ts';
import { errorLine, stripControl } from '../render/style.ts';

const EXIT_INTERNAL = 70;
const USAGE = 'usage: avarice digest';

export function usage(args: ParsedArgs, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env['AVARICE_RUN'] !== undefined) return 'refused inside a run (AVARICE_RUN is set)';
  if (args.positionals.length > 0) return `digest takes no argument, found ${JSON.stringify(args.positionals[0])}\n${USAGE}`;
  return undefined;
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

export async function run(_args: ParsedArgs, deps: AppDeps, io: Io): Promise<number> {
  const result = await runDigest(deps, deps.clock.nowMs());
  if (!result.ok) {
    io.err(`${errorLine('digest', `failed: ${describeError(result.error)}`)}\n`);
    return EXIT_INTERNAL;
  }
  const digest = result.value;
  if (digest.result === 'failed') {
    io.err(`${errorLine('digest', `the banner was not delivered (${stripControl(digest.errorCode ?? 'notifier-error')}); ${plural(digest.decisions, 'decision')} and ${plural(digest.reviews, 'run')} still wait in avarice inbox`)}\n`);
    return EXIT_INTERNAL;
  }
  if (digest.posted) io.out(`digest: ${plural(digest.decisions, 'decision')} waiting, ${plural(digest.reviews, 'run')} ready for review\n`);
  return 0;
}
