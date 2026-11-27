// avarice repo add <path>
// Registers a repository and records preflight (what exists, what is not mapped) as an onboarding in
// `discovered`. It creates no staging workspace and runs nothing; `avarice onboard <path>` continues the same
// onboarding. Exit 0 on success, 3 when the repository is refused (existing_state_conflict), 64 for a usage
// error or a path that is not a git repository, 70 for an internal failure.
import { resolve } from 'node:path';
import { writeBinding } from '../../adapters/fs/profile-bindings.ts';
import { readRepositoryFacts } from '../../adapters/git/repo-identity.ts';
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

// The repository this command is about, so main() can read its binding before a store opens (D-16).
export function repository(args: ParsedArgs): string | undefined {
  return args.positionals[1];
}

// `repo add --profile <name> <path>` binds the repository to the profile it was just registered under (D-16, S-9): after this, a
// command in that repository that names another profile is refused. Without `--profile` nothing is bound. Create-only: a repository
// already bound to this profile is left as it is.
function bindRepository(args: ParsedArgs, deps: AppDeps, repoPath: string, io: Io): number | undefined {
  const flag = args.flags['profile'];
  if (typeof flag !== 'string') return undefined;
  const facts = readRepositoryFacts(resolve(repoPath));
  if (facts === undefined) {
    io.err(`${errorLine('repo add', `registered, but cannot bind: ${oneLine(repoPath)} has no git root and root commit to bind`)}\n`);
    return EXIT_INTERNAL;
  }
  const bound = writeBinding(deps.profile.configHome, {
    gitRoot: facts.gitRoot,
    rootCommit: facts.rootCommit,
    profile: deps.profile.profile,
    boundAt: new Date(deps.clock.nowMs()).toISOString(),
  });
  if (bound.ok) return undefined;
  io.err(`${errorLine('repo add', `registered, but cannot bind: ${describeError(bound.error)}`)}\n`);
  return bound.error.kind === 'conflict' || bound.error.kind === 'invalid' ? EXIT_REFUSED : EXIT_INTERNAL;
}

// Recorded and repository-derived text on one line, without control characters (T-02-03): a file name may hold a newline.
function oneLine(value: unknown): string {
  return stripControl(String(value)).replace(/[\n\t]+/g, ' ');
}

// What onboarding will do with the map the repository already has; the final outcome of a complete stamped map waits for GSD's drift check in staging.
function mapNote(codebaseMap: string | undefined): string {
  switch (codebaseMap) {
    case 'stamped-complete':
      return ' (adopted if the drift check in staging passes, else refreshed in staging)';
    case 'stamped-partial':
    case 'unstamped':
      return ' (mapped in full in staging)';
    case 'unknown-format':
    case 'user-edited':
      return ' (left untouched; mapped in isolation in staging)';
    default:
      return '';
  }
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
  const bindFailure = bindRepository(args, deps, repoPath, io);
  if (bindFailure !== undefined) return bindFailure;
  const row = deps.ledger.getOnboarding(registered.value.onboardingId);
  if (!row.ok) {
    io.err(`${errorLine('repo add', describeError(row.error))}\n`);
    return EXIT_INTERNAL;
  }
  const preflight = (typeof row.value.preflight === 'object' && row.value.preflight !== null ? row.value.preflight : {}) as Record<string, unknown>;
  const state = preflight['existingState'] as { planningExists?: boolean; codebaseMap?: string; userOwned?: string[] } | undefined;

  const lines = [
    resultLine(`project ${registered.value.projectId}`, 'registered'),
    resultLine(`onboarding ${registered.value.onboardingId}`, row.value.state),
    `repository ${oneLine(preflight['gitRoot'])}`,
    `pin ${oneLine(preflight['pin'])}${typeof preflight['branch'] === 'string' && preflight['branch'] !== '' ? ` (branch ${oneLine(preflight['branch'])})` : ' (detached HEAD)'}`,
    `tracked files ${oneLine(preflight['trackedFiles'])}, ${oneLine(preflight['trackedBytes'])} bytes`,
    `existing .planning/: ${state?.planningExists === true ? 'yes' : 'no'}; codebase map: ${oneLine(state?.codebaseMap ?? 'unknown')}${mapNote(state?.codebaseMap)}`,
    list('instruction files', preflight['instructionFiles']),
    list('workspace manifests', preflight['workspaceManifests']),
    list('ADR directories', preflight['adrDirs']),
    list('runtimes', preflight['runtimes']),
    list('submodules', preflight['submodules']),
    list('nested repositories', preflight['nestedRepos']),
    list('user-owned planning files (left untouched)', state?.userOwned),
    list('not mapped (uncommitted or untracked, names only)', preflight['notMapped']),
  ].filter((line): line is string => line !== null);
  io.out(`${lines.join('\n')}\nnext: avarice onboard --policy ${ONBOARDING_POLICY} ${oneLine(repoPath)}\n`);
  return 0;
}
