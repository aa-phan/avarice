// Allowlisted invocation environment (SEC-5, CON-3). The contained host and everything it starts inherit this
// environment, and the sandbox passes it on unchanged, so it is built from nothing: a name is present only
// when it is listed here. Proxy variables, TLS overrides, model-backend keys, cloud and SCM tokens, agent
// sockets and loader variables are never listed, so none can arrive from the parent.
//
// What the spikes proved necessary: PATH with the gsd-core bin first (S0-C, else `gsd_run` is not found),
// USER and LOGNAME (S0-C, the macOS credential lookup fails without USER), CLAUDE_CONFIG_DIR when the parent
// has one (login), and the two switches that keep instruction files and auto memory out (S0-E).
import { GSD_ENV_PASSTHROUGH } from '../gsd/gsd-tools.ts';
import { SAFE_GIT_ENV } from '../git/safe-git.ts';
import { canonicalPath } from './settings.ts';

export interface InvocationEnvOptions {
  // The gsd-core `bin` directory (holds `gsd_run`).
  gsdCoreBin: string;
  // Recorded as AVARICE_RUN, the marker `avarice` commands and the hook use to recognise a contained run.
  onboardingId: string;
  // Directories appended after the system ones: the graphify directory, for the knowledge pass only (S0-G).
  extraPath?: readonly string[];
  // A contained run (plan 02-08): the run ID recorded as AVARICE_RUN instead of the onboarding ID, and the run's scratch directory.
  // With a scratch directory TMPDIR and the npm cache live inside it (the sandbox lets the run write nowhere else outside the clone)
  // and npm's update notifier, which would reach for the network, is off. Nothing else is added to the allowlist.
  marker?: string;
  scratchDir?: string;
}

const SYSTEM_PATH: readonly string[] = ['/usr/bin', '/bin', '/opt/homebrew/bin'];

// CLAUDE_CODE_DISABLE_BACKGROUND_TASKS is deliberately absent: it removes run_in_background from the
// subagent tools, and the full-map workflow spawns its mappers in the background.
const FIXED: Readonly<Record<string, string>> = {
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
};

export function buildInvocationEnv(parent: NodeJS.ProcessEnv, options: InvocationEnvOptions): Record<string, string> {
  const env: Record<string, string> = { ...SAFE_GIT_ENV };
  for (const name of GSD_ENV_PASSTHROUGH) {
    const value = parent[name];
    if (value !== undefined && value !== '') env[name] = value;
  }
  env['PATH'] = [options.gsdCoreBin, ...SYSTEM_PATH, ...(options.extraPath ?? [])].join(':');
  Object.assign(env, FIXED);
  env['AVARICE_RUN'] = options.marker ?? options.onboardingId;
  if (options.scratchDir !== undefined) {
    // The realpath form, the one the generated allow rules name: on macOS /var is a symlink of /private/var, and a path the model
    // addresses through the symlink is refused by the host (phase deferred-items, 02-01 case 19).
    const scratch = canonicalPath(options.scratchDir);
    env['TMPDIR'] = `${scratch}/tmp`;
    env['npm_config_cache'] = `${scratch}/npm-cache`;
    env['npm_config_update_notifier'] = 'false';
  }
  return env;
}
