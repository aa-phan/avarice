// Fail-closed launch readiness check (ONB-12, CON-3, CS-13; docs/containment.md "Fail-closed behavior").
// Nothing starts the contained host unless the generated settings carry every required key, the AVARICE hook
// is configured to block on failure and its script can be read, the sandbox runs, and `claude --version` is a
// version AVARICE has tested or a patch of a tested minor whose flags are all still listed (D-20). Every refusal is `denied` with rule `enforcement_failure:{reason}`, so the
// onboarding blocks with reason enforcement_failure. Plan 01-15 adds the hook self-test and calls this before every
// launch.
import { accessSync, constants, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { REQUIRED_HELP_FLAGS, RESTRICTED_HELP_FLAGS, RESTRICTED_ONBOARDING_HELP_FLAGS, VERIFIED_HOST_VERSIONS, admitHostVersion, helpListsFlag } from '../../domain/host-admission.ts';
import type { HostAdmission } from '../../domain/host-admission.ts';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { openDb } from '../sqlite/db.ts';
import { migrate } from '../sqlite/migrate.ts';
import { MIGRATION_0001 } from '../sqlite/migrations/0001-initial.ts';

// Host versions the containment suite has run against are VERIFIED_HOST_VERSIONS (src/domain/host-admission.ts); this alias
// keeps the name existing importers use. A patch of the verified 2.1 minor that is not in the list is admitted as an unverified
// patch when the launch probes pass (D-20, ADR-014); a new minor waits for a live T3 run.
export const ADMITTED_CLAUDE_VERSIONS: readonly string[] = VERIFIED_HOST_VERSIONS;

// Seatbelt must be able to apply a profile; /usr/bin/true is the confined process.
export const DEFAULT_SANDBOX_PROBE: readonly string[] = ['/usr/bin/sandbox-exec', '-p', '(version 1)(allow default)', '/usr/bin/true'];
const DEFAULT_TIMEOUT_MS = 10_000;

export interface LaunchReadyInput {
  settingsFile: string;
  claudeBin: string;
  // The command (argv) whose exit status says whether the OS sandbox works. Tests inject another.
  sandboxProbe?: readonly string[];
  timeoutMs?: number;
  // The generated hook policy. When given, the hook self-test runs against a scratch copy of it and the launch is
  // refused unless the hook, started the way the settings start it, denies a write outside the write roots. The host
  // adapter always passes it.
  policyFile?: string;
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
  // The host honors an empty allowlist as "no domain" only when it is strict (MF-02, docs/containment.md "Generated host settings").
  [['sandbox', 'network', 'strictAllowlist'], true],
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

// The OS sandbox applies a profile.
function checkSandbox(sandboxProbe: readonly string[] | undefined, timeout: number): Result<void> {
  const probe = sandboxProbe ?? DEFAULT_SANDBOX_PROBE;
  const [probeBin, ...probeArgs] = probe;
  if (probeBin === undefined) return refuse('sandbox-unavailable');
  const probed = spawnSync(probeBin, probeArgs, { timeout, stdio: 'ignore', env: probeEnv() });
  if (probed.error !== undefined || probed.status !== 0) return refuse('sandbox-unavailable');
  return ok(undefined);
}

// `claude --help` lists every flag the launch line relies on. It proves presence, never behaviour: a host that renamed a flag is
// caught before the launch, a host that ignores one is not (only a live T3 run shows that).
function checkHelpFlags(claudeBin: string, timeout: number, flags: readonly string[] = REQUIRED_HELP_FLAGS): Result<void> {
  const help = spawnSync(claudeBin, ['--help'], {
    timeout,
    killSignal: 'SIGKILL',
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: probeEnv(),
  });
  if (help.error !== undefined || help.status !== 0) return refuse('host-unavailable');
  for (const flag of flags) {
    // The flag as a whole word: `--settings` is not met by `--settings-profile` or `--setting-sources`.
    if (!helpListsFlag(help.stdout, flag)) return refuse(`host-flag-missing:${flag}`);
  }
  return ok(undefined);
}

export interface HostVersionOk {
  claudeVersion: string;
  admission: HostAdmission;
}

// The host is a version the containment suite has run against, or a patch of a tested minor that still lists its flags.
function checkHostVersion(claudeBin: string, timeout: number): Result<HostVersionOk> {
  const version = spawnSync(claudeBin, ['--version'], {
    timeout,
    killSignal: 'SIGKILL',
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: probeEnv(),
  });
  if (version.error !== undefined || version.status !== 0) return refuse('host-unavailable');
  const reported = /^\s*(\d+\.\d+\.\d+)\b/.exec(version.stdout)?.[1];
  if (reported === undefined) return refuse('host-version-unreadable');
  const admitted = admitHostVersion(reported);
  if ('refused' in admitted) return refuse(admitted.refused);
  if (admitted.admission === 'unverified-patch') {
    const flags = checkHelpFlags(claudeBin, timeout);
    if (!flags.ok) return flags;
  }
  return ok({ claudeVersion: reported, admission: admitted.admission });
}

export interface HostReadyInput {
  claudeBin: string;
  // The hook entry script the generated settings name.
  hookEntry: string;
  sandboxProbe?: readonly string[];
  timeoutMs?: number;
}

// The startup check behind the host's `enforced` descriptor: the hook entry can be read, the sandbox runs and
// `claude --version` is a version AVARICE has tested (or an unverified patch that lists its flags). Nothing is started that could run a model.
export function checkHostReady(input: HostReadyInput): Result<HostVersionOk> {
  const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!readable(input.hookEntry)) return refuse('hook-script-unreadable');
  const sandbox = checkSandbox(input.sandboxProbe, timeout);
  if (!sandbox.ok) return sandbox;
  return checkHostVersion(input.claudeBin, timeout);
}

export interface HookSelfTestInput {
  // The hook entry script (src/hook/pre-tool-use.ts).
  hookEntry: string;
  // The invocation's hook-policy.json; a scratch copy that points at a scratch ledger is what the test runs against.
  policyFile: string;
  // The command and its arguments before `--event`, as the generated settings start the hook. Default: this node
  // with the warning switch and `hookEntry`.
  command?: string;
  leadArgs?: readonly string[];
  timeoutMs?: number;
}

// Runs the hook the way the host will and requires it to deny a Write outside the write roots. A hook that cannot
// start, cannot read its policy, crashes, or allows the call is a hook that would not stop a model-directed write,
// so the launch is refused (`enforcement_failure:hook-self-test`). The real ledger is never touched: the policy copy
// names a scratch ledger in a scratch directory, removed afterwards.
export function hookSelfTest(input: HookSelfTestInput): Result<void> {
  const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let policy: unknown;
  try {
    policy = JSON.parse(readFileSync(input.policyFile, 'utf8'));
  } catch {
    return refuse('hook-self-test');
  }
  if (!isObject(policy)) return refuse('hook-self-test');

  let scratch: string | undefined;
  try {
    scratch = mkdtempSync(join(tmpdir(), 'avarice-hook-selftest-'));
    const ledgerPath = join(scratch, 'state.db');
    const opened = openDb(ledgerPath);
    if (!opened.ok) return refuse('hook-self-test');
    const migrated = migrate(opened.value, [MIGRATION_0001]);
    opened.value.close();
    if (!migrated.ok) return refuse('hook-self-test');

    const policyCopy = join(scratch, 'hook-policy.json');
    writeFileSync(policyCopy, JSON.stringify({ ...policy, ledgerPath }), { mode: 0o600 });
    const stagingPath = typeof policy['stagingPath'] === 'string' ? policy['stagingPath'] : scratch;
    const call = {
      cwd: stagingPath,
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      // The scratch directory is not among the policy's write roots, whatever the policy says.
      tool_input: { file_path: join(scratch, 'outside-the-write-roots.txt'), content: 'avarice hook self-test\n' },
    };
    const lead = input.leadArgs ?? ['--disable-warning=ExperimentalWarning', input.hookEntry];
    const ran = spawnSync(input.command ?? process.execPath, [...lead, '--event', 'pre', '--policy', policyCopy], {
      input: JSON.stringify(call),
      encoding: 'utf8',
      timeout,
      killSignal: 'SIGKILL',
      env: probeEnv(),
      maxBuffer: 1024 * 1024,
    });
    if (ran.error !== undefined || ran.status !== 0) return refuse('hook-self-test');
    let verdict: unknown;
    try {
      verdict = JSON.parse(ran.stdout.trim());
    } catch {
      return refuse('hook-self-test');
    }
    const output = isObject(verdict) ? verdict['hookSpecificOutput'] : undefined;
    if (!isObject(output) || output['permissionDecision'] !== 'deny') return refuse('hook-self-test');
    return ok(undefined);
  } catch {
    return refuse('hook-self-test');
  } finally {
    if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  }
}

export function checkLaunchReady(input: LaunchReadyInput): Result<HostVersionOk> {
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
  // The in-flight subagent count (the contract's subagentsConcurrent) is built from these completions: a settings file without
  // them would leave the limit stuck or off (O-1). They need not block; a completion that cannot be recorded only keeps a slot held.
  const post = avariceHooks(settings, 'PostToolUse', 'post');
  if (post.length === 0) return refuse('post-hook-missing');
  const postFailure = avariceHooks(settings, 'PostToolUseFailure', 'post');
  if (postFailure.length === 0) return refuse('post-failure-hook-missing');
  for (const hook of [...pre, ...config, ...post, ...postFailure]) {
    if (!readable(hookScript(hook))) return refuse('hook-script-unreadable');
  }

  // 2b. The hook, started the way the settings start it, denies a write outside the write roots.
  if (input.policyFile !== undefined) {
    const entry = pre[0] as HookRef;
    const flag = entry.args.indexOf('--event');
    const selfTest = hookSelfTest({
      hookEntry: hookScript(entry),
      policyFile: input.policyFile,
      command: entry.command,
      leadArgs: flag === -1 ? entry.args : entry.args.slice(0, flag),
      timeoutMs: timeout,
    });
    if (!selfTest.ok) return selfTest;
  }

  // 3. The OS sandbox applies a profile.
  const sandbox = checkSandbox(input.sandboxProbe, timeout);
  if (!sandbox.ok) return sandbox;

  // 4. The host is a verified version, or an unverified patch that lists every flag the launch line uses.
  return checkHostVersion(input.claudeBin, timeout);
}

// ---- restricted mode (plan 04-23; CON-4, D-12) --------------------------------------------------------------------------------------------

export interface RestrictedReadyInput {
  claudeBin: string;
  timeoutMs?: number;
}

// The startup check behind the restricted host's descriptor: `claude --help` lists `--restricted` and every other flag the restricted line uses. Restricted mode is the
// answer for a host that cannot be contained (docs/containment.md "Fail-closed behavior"), so it asks for no admitted version, no sandbox and no hook: the host's own
// `--restricted` removes the tools that run code. It proves the flags are listed, never that the host honours them (spike S4-C; plan 04-34's live run).
export function checkRestrictedHostReady(input: RestrictedReadyInput): Result<void> {
  return checkHelpFlags(input.claudeBin, input.timeoutMs ?? DEFAULT_TIMEOUT_MS, RESTRICTED_HELP_FLAGS);
}

export interface RestrictedLaunchReadyInput {
  claudeBin: string;
  // The generated run settings the restricted line names with `--settings`.
  settingsFile: string;
  // The line is an onboarding's (plan 04-24): `--plugin-dir` and `--agents` must be listed too.
  extensions?: boolean;
  timeoutMs?: number;
}

// Fail-closed readiness before every restricted launch. The run settings must be there, valid, and deny by default (`permissions.defaultMode` `dontAsk`: anything the settings
// do not allow is refused, since there is nobody to ask); then the host must list `--restricted` and the rest of the line's flags. No sandbox probe, no hook self-test and no
// admitted version: those are the contained line's, and a host that cannot pass them is who this line is for.
export function checkRestrictedLaunchReady(input: RestrictedLaunchReadyInput): Result<void> {
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
  if (at(settings, ['permissions', 'defaultMode']) !== 'dontAsk') return refuse('settings-key:permissions.defaultMode');
  return checkHelpFlags(input.claudeBin, input.timeoutMs ?? DEFAULT_TIMEOUT_MS, input.extensions === true ? RESTRICTED_ONBOARDING_HELP_FLAGS : RESTRICTED_HELP_FLAGS);
}
