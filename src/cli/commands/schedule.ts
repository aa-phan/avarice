// avarice schedule install | remove (plan 03-23; D-23, AUT-6; T-03-44, T-03-45, T-03-46). `install` writes a user LaunchAgent under ~/Library/LaunchAgents,
// with no admin rights, that runs `avarice digest` at the profile's digest times (notify.digestTimes, default 12:30 and 17:30) and loads it with
// `launchctl bootstrap gui/<uid>`; running it again replaces the agent. `remove` unloads it with `launchctl bootout` and deletes the file, but only a
// file that carries the marker AVARICE writes; an agent that is not installed is not an error. launchd keeps the clock, so no AVARICE process waits.
//
// Both refuse inside a run (AVARICE_RUN), without a terminal on standard input and output, and from the process tree of a run, before the profile is
// resolved, so a refusal creates nothing (CS-11), and then for a profile that is not the user's own. Exit 0 done or already absent; 3 a refusal that
// wrote nothing (a symbolic link, a file AVARICE did not write); 64 a usage error, a refusal of who runs it, a value that is not allowed; 70 a tool failed.
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describeError } from '../../adapters/sqlite/db.ts';
import { DIGEST_LABEL_PREFIX, LaunchdScheduler } from '../../adapters/schedule/launchd.ts';
import type { SchedulerSeam } from '../../adapters/schedule/launchd.ts';
import type { AppDeps } from '../../app/deps.ts';
import type { PortError } from '../../domain/result.ts';
import type { CommandExtras, Io, ParsedArgs } from '../args.ts';
import { ownsProfile, refuseOutsideTerminal } from '../identity.ts';
import type { IdentityContext } from '../identity.ts';
import { errorLine, stripControl } from '../render/style.ts';

const EXIT_REFUSED = 3;
const EXIT_USAGE = 64;
const EXIT_INTERNAL = 70;
const USAGE = 'usage: avarice schedule install | remove';
// The one node flag the bin script's own shebang passes; any other flag of the running process is not copied into the agent.
const NODE_FLAG = /^--disable-warning=[A-Za-z]{1,40}$/;

export function usage(args: ParsedArgs, env: NodeJS.ProcessEnv = process.env, context?: IdentityContext): string | undefined {
  const refused = context === undefined ? 'needs an interactive terminal' : refuseOutsideTerminal(env, context);
  if (refused !== undefined) return refused;
  const verb = args.positionals[0];
  if ((verb !== 'install' && verb !== 'remove') || args.positionals.length > 1 || Object.keys(args.flags).length > 0) return USAGE;
  return undefined;
}

function fail(io: Io, error: PortError): number {
  switch (error.kind) {
    case 'denied':
      io.err(`${errorLine('schedule', error.rule)}\n`);
      return EXIT_REFUSED;
    case 'invalid':
      io.err(`${errorLine('schedule', describeError(error))}\n`);
      return EXIT_USAGE;
    default:
      io.err(`${errorLine('schedule', `failed: ${describeError(error)}`)}\n`);
      return EXIT_INTERNAL;
  }
}

// The agents directory and tools of this machine. A test passes its own through the main() seam.
function productionOptions(deps: AppDeps): SchedulerSeam | undefined {
  if (process.platform !== 'darwin' || typeof process.getuid !== 'function') return undefined;
  return { agentsDir: join(deps.home ?? homedir(), 'Library', 'LaunchAgents'), launchctl: '/bin/launchctl', plutil: '/usr/bin/plutil', uid: process.getuid() };
}

export function run(args: ParsedArgs, deps: AppDeps, io: Io, extras: CommandExtras = {}): number {
  // Only the user who owns the profile schedules its digest; the others are refused without a write.
  if (!ownsProfile(deps.profile.dataRoot)) {
    io.err(`${errorLine('schedule', 'only the user who owns the profile schedules its digest')}\n`);
    return EXIT_USAGE;
  }
  const options = extras.scheduler ?? productionOptions(deps);
  if (options === undefined) {
    io.err(`${errorLine('schedule', 'the digest schedule is a macOS LaunchAgent; this system has no launchd')}\n`);
    return EXIT_USAGE;
  }
  const scheduler = new LaunchdScheduler(options);
  const label = `${DIGEST_LABEL_PREFIX}${deps.profile.profile}`;

  if (args.positionals[0] === 'remove') {
    const removed = scheduler.remove(label);
    if (!removed.ok) return fail(io, removed.error);
    io.out(`digest schedule ${removed.value.status === 'removed' ? 'removed' : 'not installed'}: ${stripControl(label)}\n`);
    return 0;
  }

  const settings = deps.notify?.settings();
  if (settings === undefined) {
    io.err(`${errorLine('schedule', 'failed: the notification settings are not available')}\n`);
    return EXIT_INTERNAL;
  }
  if (!settings.ok) return fail(io, settings.error);
  const times = settings.value.digestTimes;
  if (times.length === 0) {
    io.err(`${errorLine('schedule', 'notify.digestTimes in the profile config is empty, so there is no time to run the digest; add at least one HH:MM')}\n`);
    return EXIT_USAGE;
  }

  let entryPath: string;
  try {
    entryPath = options.entryPath ?? realpathSync(process.argv[1] ?? '');
  } catch {
    io.err(`${errorLine('schedule', 'the CLI entry of this process cannot be resolved, so the agent has nothing to run')}\n`);
    return EXIT_USAGE;
  }
  const installed = scheduler.install({
    label,
    nodePath: options.nodePath ?? process.execPath,
    nodeArgs: options.nodeArgs ?? (extras.scheduler !== undefined ? [] : process.execArgv.filter((flag) => NODE_FLAG.test(flag))),
    entryPath,
    times,
    env: { AVARICE_CONFIG_HOME: deps.profile.configHome, AVARICE_DATA_ROOT: deps.profile.dataRoot, AVARICE_WORK_ROOT: deps.profile.workRoot },
    logPath: join(deps.profile.dataRoot, 'logs', 'digest.log'),
  });
  if (!installed.ok) return fail(io, installed.error);
  io.out(`digest schedule ${installed.value.status}: ${stripControl(label)} at ${times.join(', ')}\n`);
  io.out(`log: ${stripControl(join(deps.profile.dataRoot, 'logs', 'digest.log'))}\n`);
  return 0;
}
