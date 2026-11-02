// avarice resume {onboardingId}
// Continues an interrupted onboarding from its committed state. Exit 0 when the project is active, 3 when
// it stopped without activating (blocked, incompatible) or another process holds the lease, 64 for a usage
// error or an unknown ID, 70 for an internal failure.
import { describeError } from '../../adapters/sqlite/db.ts';
import { resumeOnboarding } from '../../app/resume.ts';
import type { AppDeps } from '../../app/deps.ts';
import type { Io, ParsedArgs } from '../args.ts';

const EXIT_NOT_ACTIVE = 3;
const EXIT_USAGE = 64;
const EXIT_INTERNAL = 70;

function usage(io: Io, message: string): number {
  io.err(`avarice resume: ${message}\nusage: avarice resume <onboardingId>\n`);
  return EXIT_USAGE;
}

export async function run(args: ParsedArgs, deps: AppDeps, io: Io): Promise<number> {
  const onboardingId = args.positionals[0];
  if (onboardingId === undefined || onboardingId === '' || args.positionals.length !== 1) return usage(io, 'exactly one onboarding ID is required');

  const outcome = await resumeOnboarding(deps, onboardingId);
  if (!outcome.ok) {
    const e = outcome.error;
    if (e.kind === 'not_found') {
      io.err(`avarice resume: ${describeError(e)}\n`);
      return EXIT_USAGE;
    }
    if (e.kind === 'conflict') {
      io.err(`avarice resume: onboarding ${onboardingId} is held by another process; its lease must expire first (${describeError(e)})\n`);
      return EXIT_NOT_ACTIVE;
    }
    io.err(`avarice resume: onboarding ${onboardingId} did not finish: ${describeError(e)}\n`);
    return EXIT_INTERNAL;
  }
  const { state, reason, message } = outcome.value;
  io.out(`onboarding ${onboardingId}: ${state}${reason !== null ? ` (${reason})` : ''}\n`);
  if (message !== null) io.out(`${message}\n`);
  return state === 'active' ? 0 : EXIT_NOT_ACTIVE;
}
