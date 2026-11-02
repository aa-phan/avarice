// Fail-closed launch readiness check (ONB-12, CON-3, CS-13; docs/containment.md "Fail-closed behavior").
// Nothing starts the contained host unless the generated settings carry every required key, the AVARICE hook
// is configured to block on failure and its script can be read, the sandbox runs, and `claude --version` is a
// version AVARICE has tested. Every refusal is `denied` with rule `enforcement_failure:{reason}`, so the
// onboarding blocks with reason enforcement_failure. Plan 01-12 adds the hook self-test; plan 01-15 calls this
// before every launch.
import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';

// Host versions the containment suite has run against (spike S0 and the pre-slice spike).
export const ADMITTED_CLAUDE_VERSIONS: readonly string[] = ['2.1.312', '2.1.316'];

// Seatbelt must be able to apply a profile; /usr/bin/true is the confined process.
const DEFAULT_SANDBOX_PROBE: readonly string[] = ['/usr/bin/sandbox-exec', '-p', '(version 1)(allow default)', '/usr/bin/true'];
const DEFAULT_TIMEOUT_MS = 10_000;

export interface LaunchReadyInput {
  settingsFile: string;
  claudeBin: string;
  // The command (argv) whose exit status says whether the OS sandbox works. Tests inject another.
  sandboxProbe?: readonly string[];
  timeoutMs?: number;
}

function refuse(reason: string): Result<never> {
  return err({ kind: 'denied', rule: `enforcement_failure:${reason}`, enforcer: 'avarice' });
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

function at(root: Json, path: readonly string[]): unknown {
  let node: unknown = root;
  for (const key of path) {
    if (!isObject(node)) return undefined;
    node = node[key];
  }
  return node;
}

// Keys every generated settings file carries (docs/containment.md "Generated host settings"; CON-3, CON-5).
const REQUIRED_KEYS: ReadonlyArray<readonly [path: readonly string[], expected: unknown]> = [
  [['permissions', 'defaultMode'], 'dontAsk'],
  [['permissions', 'disableBypassPermissionsMode'], 'disable'],
  [['sandbox', 'enabled'], true],
  [['sandbox', 'failIfUnavailable'], true],
  [['sandbox', 'allowUnsandboxedCommands'], false],
  [['sandbox', 'autoAllowBashIfSandboxed'], false],
  [['sandbox', 'excludedCommands'], []],
  // The onboarding sandbox lists no network domain (CON-5, SEC-5).
  [['sandbox', 'network', 'allowedDomains'], []],
];

interface HookRef {
  command: string;
  args: string[];
  onFailure: unknown;
}

// Hook commands under an event whose arguments carry `--event <name>` (AVARICE's own entries).
function avariceHooks(settings: Json, event: string, name: string): HookRef[] {
  const groups = at(settings, ['hooks', event]);
  if (!Array.isArray(groups)) return [];
  const found: HookRef[] = [];
  for (const group of groups) {
    const hooks = isObject(group) ? group['hooks'] : undefined;
    if (!Array.isArray(hooks)) continue;
    for (const hook of hooks) {
      if (!isObject(hook) || typeof hook['command'] !== 'string') continue;
      const args = Array.isArray(hook['args']) ? hook['args'].filter((a): a is string => typeof a === 'string') : [];
      const flag = args.indexOf('--event');
      if (flag !== -1 && args[flag + 1] === name) found.push({ command: hook['command'], args, onFailure: hook['onFailure'] });
    }
  }
  return found;
}

// The script the hook command runs: the first argument that is not an option (the interpreter's flags come first).
function hookScript(hook: HookRef): string {
  return hook.args.find((arg) => !arg.startsWith('-')) ?? hook.command;
}

function readable(path: string): boolean {
  try {
    accessSync(path, constants.R_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// Environment for the two probes: enough for the host to find itself, nothing that carries a credential.
function probeEnv(): Record<string, string> {
  const env: Record<string, string> = { PATH: '/usr/bin:/bin:/opt/homebrew/bin' };
  for (const name of ['HOME', 'USER', 'LOGNAME', 'LANG', 'TMPDIR', 'CLAUDE_CONFIG_DIR']) {
    const value = process.env[name];
    if (value !== undefined && value !== '') env[name] = value;
  }
  return env;
}

export function checkLaunchReady(input: LaunchReadyInput): Result<{ claudeVersion: string }> {
  const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // 1. Generated settings: present, valid, and carrying every required key.
  let text: string;
  try {
    text = readFileSync(input.settingsFile, 'utf8');
  } catch (e) {
    return refuse((e as NodeJS.ErrnoException).code === 'ENOENT' ? 'settings-missing' : 'settings-invalid');
  }
  let settings: unknown;
  try {
    settings = JSON.parse(text);
  } catch {
    return refuse('settings-invalid');
  }
  if (!isObject(settings)) return refuse('settings-invalid');
  for (const [path, expected] of REQUIRED_KEYS) {
    if (JSON.stringify(at(settings, path)) !== JSON.stringify(expected)) return refuse(`settings-key:${path.join('.')}`);
  }

  // 2. The AVARICE hook: configured, blocking on failure (hooks fail open by default), and its script readable.
  const pre = avariceHooks(settings, 'PreToolUse', 'pre');
  if (pre.length === 0) return refuse('hook-missing');
  if (pre.some((hook) => hook.onFailure !== 'block')) return refuse('hook-not-blocking');
  const config = avariceHooks(settings, 'ConfigChange', 'config-change');
  if (config.length === 0) return refuse('config-hook-missing');
  if (config.some((hook) => hook.onFailure !== 'block')) return refuse('hook-not-blocking');
  for (const hook of [...pre, ...config]) {
    if (!readable(hookScript(hook))) return refuse('hook-script-unreadable');
  }

  // 3. The OS sandbox applies a profile.
  const probe = input.sandboxProbe ?? DEFAULT_SANDBOX_PROBE;
  const [probeBin, ...probeArgs] = probe;
  if (probeBin === undefined) return refuse('sandbox-unavailable');
  const probed = spawnSync(probeBin, probeArgs, { timeout, stdio: 'ignore', env: probeEnv() });
  if (probed.error !== undefined || probed.status !== 0) return refuse('sandbox-unavailable');

  // 4. The host is a version the containment suite has run against.
  const version = spawnSync(input.claudeBin, ['--version'], {
    timeout,
    killSignal: 'SIGKILL',
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: probeEnv(),
  });
  if (version.error !== undefined || version.status !== 0) return refuse('host-unavailable');
  const reported = /^\s*(\d+\.\d+\.\d+)\b/.exec(version.stdout)?.[1];
  if (reported === undefined) return refuse('host-version-unreadable');
  if (!ADMITTED_CLAUDE_VERSIONS.includes(reported)) return refuse(`host-version-not-admitted:${reported}`);
  return ok({ claudeVersion: reported });
}
