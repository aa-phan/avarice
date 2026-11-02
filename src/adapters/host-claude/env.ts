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

export interface InvocationEnvOptions {
  // The gsd-core `bin` directory (holds `gsd_run`).
  gsdCoreBin: string;
  // Recorded as AVARICE_RUN, the marker `avarice` commands and the hook use to recognise a contained run.
  onboardingId: string;
  // Directories appended after the system ones: the graphify directory, for the knowledge pass only (S0-G).
  extraPath?: readonly string[];
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
  env['AVARICE_RUN'] = options.onboardingId;
  return env;
}
