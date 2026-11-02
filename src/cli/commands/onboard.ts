// avarice onboard --policy onboarding [--mode full|fast] [--promote none] [--budget name=value]... <repo>
// Registers the repository, runs the onboarding stages under a lease and prints where it ended.
// Exit 0 when the project is active, 3 when onboarding stopped without activating (blocked,
// incompatible, paused) or was refused (existing_state_conflict), 64 for a usage error (including a
// promotion other than none), 70 for an internal failure.
import { describeError } from '../../adapters/sqlite/db.ts';
import { ONBOARDING_POLICY, runOnboarding, startOnboarding } from '../../app/onboarding-service.ts';
import type { AppDeps } from '../../app/deps.ts';
import type { Io, ParsedArgs } from '../args.ts';

export const EXIT_NOT_ACTIVE = 3;
const EXIT_USAGE = 64;
const EXIT_INTERNAL = 70;

function usage(io: Io, message: string): number {
  io.err(`avarice onboard: ${message}\nusage: avarice onboard --policy ${ONBOARDING_POLICY} [--mode full|fast] [--promote none] [--budget name=value]... <repo>\n`);
  return EXIT_USAGE;
}

const BUDGET_FLAG = /^([A-Za-z][A-Za-z0-9]*)=(.+)$/;

// Repeatable `--budget name=value`. The names and the lower-only rule belong to the contract compiler (RC-5); this
// only checks the shape, so a typo never registers anything.
function budgetOverrides(args: ParsedArgs): Record<string, number> | string {
  if (args.flags['budget'] === true) return '--budget needs name=value';
  const out: Record<string, number> = {};
  for (const entry of args.repeated?.['budget'] ?? []) {
    const match = BUDGET_FLAG.exec(entry);
    const value = match === null ? Number.NaN : Number(match[2]);
    if (match === null || !Number.isFinite(value)) return `--budget ${JSON.stringify(entry)} is not name=value with a number`;
    out[match[1] as string] = value;
  }
  return out;
}

export async function run(args: ParsedArgs, deps: AppDeps, io: Io): Promise<number> {
  const policy = args.flags['policy'];
  if (policy !== ONBOARDING_POLICY) return usage(io, `--policy ${ONBOARDING_POLICY} is required`);
  const promote = args.flags['promote'];
  if (promote === true) return usage(io, '--promote needs a value');
  // Phase 1 maps full (default) or fast; path-scoped mapping and adoption arrive in Phase 4.
  const mode = args.flags['mode'];
  if (mode !== undefined && mode !== 'full' && mode !== 'fast') return usage(io, '--mode must be full or fast');
  const repoPath = args.positionals[0];
  if (repoPath === undefined || args.positionals.length !== 1) return usage(io, 'exactly one repository path is required');

  const overrides = budgetOverrides(args);
  if (typeof overrides === 'string') return usage(io, overrides);

  const started = startOnboarding(deps, {
    repoPath,
    policy,
    mode: mode ?? 'full',
    ...(promote !== undefined ? { promote } : {}),
    ...(Object.keys(overrides).length > 0 ? { budgetOverrides: overrides } : {}),
  });
  if (!started.ok) {
    io.err(`avarice onboard: ${started.error.kind === 'conflict' ? 'refused: ' : ''}${describeError(started.error)}\n`);
    if (started.error.kind === 'conflict') return EXIT_NOT_ACTIVE;
    return started.error.kind === 'invalid' || started.error.kind === 'not_found' ? EXIT_USAGE : EXIT_INTERNAL;
  }

  const outcome = await runOnboarding(deps, started.value.onboardingId);
  if (!outcome.ok) {
    io.err(`avarice onboard: onboarding ${started.value.onboardingId} did not finish: ${describeError(outcome.error)}\n`);
    return EXIT_INTERNAL;
  }
  const { state, reason, message, onboardingId } = outcome.value;
  io.out(`onboarding ${onboardingId}: ${state}${reason !== null ? ` (${reason})` : ''}\n`);
  if (message !== null) io.out(`${message}\n`);
  return state === 'active' ? 0 : EXIT_NOT_ACTIVE;
}
