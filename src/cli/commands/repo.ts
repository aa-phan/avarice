// avarice repo add <path>
// Registers a repository and records preflight (what exists, what is not mapped) as an onboarding in
// `discovered`. It creates no staging workspace and runs nothing; `avarice onboard <path>` continues the same
// onboarding. Exit 0 on success, 3 when the repository is refused (existing_state_conflict), 64 for a usage
// error or a path that is not a git repository, 70 for an internal failure.
import { describeError } from '../../adapters/sqlite/db.ts';
import { ONBOARDING_POLICY } from '../../app/onboarding-service.ts';
import { registerAndPreflight } from '../../app/stages/register.ts';
import type { AppDeps } from '../../app/deps.ts';
import type { Io, ParsedArgs } from '../args.ts';
import { errorLine, resultLine, stripControl } from '../render/style.ts';

const EXIT_REFUSED = 3;
const EXIT_USAGE = 64;
const EXIT_INTERNAL = 70;
const USAGE = 'usage: avarice repo add <path>\n';

// A malformed command line is rejected before the profile is opened (nothing is created for it).
export function usage(args: ParsedArgs): string | undefined {
  if (args.positionals[0] !== 'add') return `unknown or missing subcommand\n${USAGE.trimEnd()}`;
  if (args.positionals.length !== 2) return `exactly one repository path is required\n${USAGE.trimEnd()}`;
  return undefined;
}

// Recorded and repository-derived text on one line, without control characters (T-02-03): a file name may hold a newline.
function oneLine(value: unknown): string {
  return stripControl(String(value)).replace(/[\n\t]+/g, ' ');
}

function list(label: string, values: unknown): string | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  return `${label}: ${values.map(oneLine).join(', ')}`;
}

// A path as a shell word, so the line naming the resolving command can be pasted.
function shellWord(path: string): string {
  return /^[A-Za-z0-9_/.:@%+=,-]+$/.test(path) ? path : `'${path.replace(/'/g, "'\\''")}'`;
}

// OPS-7: an error that has a resolving or inspecting command is followed by one line naming it; any other error by none.
function resolvingLine(e: { kind: string; field?: string }, repoPath: string): string | null {
  if (e.kind === 'conflict') return 'run: avarice status';
  if (e.kind === 'invalid' && e.field === 'repoPath') return `run: git -C ${shellWord(oneLine(repoPath))} rev-parse --show-toplevel`;
  return null;
}

export async function run(args: ParsedArgs, deps: AppDeps, io: Io): Promise<number> {
  const repoPath = args.positionals[1];
  if (args.positionals[0] !== 'add' || repoPath === undefined || args.positionals.length !== 2) {
    io.err(`${errorLine('repo', USAGE.trimEnd())}\n`);
    return EXIT_USAGE;
  }

  const registered = registerAndPreflight(deps, { repoPath, policy: ONBOARDING_POLICY, mode: 'full', promote: 'none', budgetOverrides: {} });
  if (!registered.ok) {
    const e = registered.error;
    const resolving = resolvingLine(e as { kind: string; field?: string }, repoPath);
    io.err(`${errorLine('repo add', `${e.kind === 'conflict' ? 'refused: ' : ''}${describeError(e)}`)}\n${resolving === null ? '' : `${resolving}\n`}`);
    if (e.kind === 'conflict') return EXIT_REFUSED;
    return e.kind === 'invalid' || e.kind === 'not_found' ? EXIT_USAGE : EXIT_INTERNAL;
  }
  const row = deps.ledger.getOnboarding(registered.value.onboardingId);
  if (!row.ok) {
    io.err(`${errorLine('repo add', describeError(row.error))}\n`);
    return EXIT_INTERNAL;
  }
  const preflight = (typeof row.value.preflight === 'object' && row.value.preflight !== null ? row.value.preflight : {}) as Record<string, unknown>;
  const state = preflight['existingState'] as { planningExists?: boolean; codebaseMap?: string; adoptionDeferred?: boolean } | undefined;

  const lines = [
    resultLine(`project ${registered.value.projectId}`, 'registered'),
    resultLine(`onboarding ${registered.value.onboardingId}`, row.value.state),
    `repository ${oneLine(preflight['gitRoot'])}`,
    `pin ${oneLine(preflight['pin'])}${typeof preflight['branch'] === 'string' && preflight['branch'] !== '' ? ` (branch ${oneLine(preflight['branch'])})` : ' (detached HEAD)'}`,
    `tracked files ${oneLine(preflight['trackedFiles'])}, ${oneLine(preflight['trackedBytes'])} bytes`,
    `existing .planning/: ${state?.planningExists === true ? 'yes' : 'no'}; codebase map: ${oneLine(state?.codebaseMap ?? 'unknown')}${state?.adoptionDeferred === true ? ' (adoption deferred, regenerated in staging)' : ''}`,
    list('instruction files', preflight['instructionFiles']),
    list('workspace manifests', preflight['workspaceManifests']),
    list('ADR directories', preflight['adrDirs']),
    list('runtimes', preflight['runtimes']),
    list('submodules', preflight['submodules']),
    list('nested repositories', preflight['nestedRepos']),
    list('not mapped (uncommitted or untracked, names only)', preflight['notMapped']),
  ].filter((line): line is string => line !== null);
  io.out(`${lines.join('\n')}\nnext: avarice onboard --policy ${ONBOARDING_POLICY} ${oneLine(repoPath)}\n`);
  return 0;
}
