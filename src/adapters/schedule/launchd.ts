// The LaunchAgent writer (plan 03-23; D-23, AUT-6; T-03-44, T-03-45). `avarice schedule install` writes one user LaunchAgent that runs `avarice digest`
// at the profile's digest times, and `schedule remove` takes it away. launchd, not AVARICE, waits for the clock: no model and no AVARICE process sits
// in a loop (AUT-6). The file is the only thing written outside the profile roots: `<agentsDir>/<label>.plist`, mode 0644, no admin rights.
//
// The plist is a fixed template whose only variable parts are validated values: the label (a-z, 0-9, dot and dash after a fixed prefix), integer
// Hour and Minute from HH:MM digits, absolute paths without control characters, and three environment names AVARICE reads. Every value is also
// XML-escaped, so a value that slipped past a check could still not add a key. The program is the Node binary and the CLI entry of the running install,
// both required to exist. The file is written through a temporary name and a rename, linted with plutil before it is renamed into place, and
// bootstrapped with `launchctl bootstrap gui/<uid>`; `remove` uses `launchctl bootout gui/<uid>/<label>` (never the deprecated load and unload).
// Nothing here follows a symbolic link or touches a file that does not carry the marker line AVARICE writes. A refusal is a `denied` error (the command
// exits 3); a bad value is `invalid`; a tool that fails is `internal`. Both tools run with argv, no shell, a timeout and no detached child.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, constants, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';

export const DIGEST_LABEL_PREFIX = 'io.avarice.digest.';
// A line of its own, so `remove` and `install` only ever touch a file AVARICE wrote.
export const PLIST_MARKER = '<!-- avarice:digest-schedule (written by `avarice schedule install`; remove it with `avarice schedule remove`) -->';

export interface DigestPlistInput {
  label: string;
  // The absolute Node binary and the absolute CLI entry of the running install.
  nodePath: string;
  // Node flags placed before the entry; only `--disable-warning=<Name>` (what the bin script's own shebang passes) is accepted.
  nodeArgs?: readonly string[];
  entryPath: string;
  // `HH:MM`, two digits each.
  times: readonly string[];
  // The profile roots the digest reads, by their three variable names.
  env: Readonly<Record<string, string>>;
  // Where launchd writes standard output and standard error of the digest.
  logPath: string;
}

export interface LaunchdOptions {
  // `~/Library/LaunchAgents` in production.
  agentsDir: string;
  // `/bin/launchctl` and `/usr/bin/plutil` in production.
  launchctl: string;
  plutil: string;
  uid: number;
}

// The test seam of `schedule`: the writer's options, and the program line a test wants the agent to carry. Only src/cli/main.ts reads the override
// of MainOverrides that carries it (footprint.test.ts pins that), so production always writes the real agents directory with the running install.
export interface SchedulerSeam extends LaunchdOptions {
  nodePath?: string;
  nodeArgs?: readonly string[];
  entryPath?: string;
}

export interface ScheduleInstall {
  label: string;
  path: string;
  status: 'installed' | 'replaced';
}

export interface ScheduleRemoval {
  label: string;
  path: string;
  status: 'removed' | 'not-installed';
}

const LABEL = /^io\.avarice\.digest\.[a-z0-9][a-z0-9.-]*$/;
const LABEL_MAX_CHARS = 128;
const CLOCK_TIME = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;
const MAX_TIMES = 6;
const ENV_NAMES: readonly string[] = ['AVARICE_CONFIG_HOME', 'AVARICE_DATA_ROOT', 'AVARICE_WORK_ROOT'];
const NODE_ARG = /^--disable-warning=[A-Za-z]{1,40}$/;
const PATH_MAX_CHARS = 1024;
const ANY_CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
// A plist larger than this is not one AVARICE wrote.
const MAX_EXISTING_BYTES = 64 * 1024;
const TOOL_TIMEOUT_MS = 10_000;
// `launchctl bootout` exits with these when the service is not loaded (ESRCH `3`, and `113` on newer systems): nothing to unload.
const NOT_LOADED_EXITS: readonly (number | null)[] = [3, 113];

const invalid = (field: string, reason: string): Result<never> => err({ kind: 'invalid', field, reason });
const refuse = (rule: string): Result<never> => err({ kind: 'denied', rule, enforcer: 'avarice' });

function xml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function absolutePath(value: unknown, field: string): Result<string> {
  if (typeof value !== 'string' || !isAbsolute(value) || value.length > PATH_MAX_CHARS || ANY_CONTROL.test(value)) {
    return invalid(field, 'expected an absolute path without control characters');
  }
  return ok(value);
}

// The text of the agent, or the first value that is not allowed. Pure: nothing is read or written.
export function renderDigestPlist(input: DigestPlistInput): Result<string> {
  if (typeof input.label !== 'string' || input.label.length > LABEL_MAX_CHARS || !LABEL.test(input.label)) {
    return invalid('label', `expected ${DIGEST_LABEL_PREFIX} followed by a-z, 0-9, dot and dash`);
  }
  const node = absolutePath(input.nodePath, 'nodePath');
  if (!node.ok) return node;
  const entry = absolutePath(input.entryPath, 'entryPath');
  if (!entry.ok) return entry;
  const log = absolutePath(input.logPath, 'logPath');
  if (!log.ok) return log;
  const nodeArgs = input.nodeArgs ?? [];
  for (const arg of nodeArgs) {
    if (typeof arg !== 'string' || !NODE_ARG.test(arg)) return invalid('nodeArgs', 'only --disable-warning=<Name> is accepted');
  }
  if (!Array.isArray(input.times) || input.times.length === 0 || input.times.length > MAX_TIMES) return invalid('times', `expected 1 to ${MAX_TIMES} times`);
  const intervals: string[] = [];
  for (let index = 0; index < input.times.length; index += 1) {
    const match = typeof input.times[index] === 'string' ? CLOCK_TIME.exec(input.times[index] as string) : null;
    if (match === null) return invalid(`times[${index}]`, 'expected HH:MM, two digits each, 00:00 to 23:59');
    intervals.push(`    <dict><key>Hour</key><integer>${Number(match[1])}</integer><key>Minute</key><integer>${Number(match[2])}</integer></dict>`);
  }
  const variables: string[] = [];
  for (const [name, value] of Object.entries(input.env)) {
    if (!ENV_NAMES.includes(name)) return invalid(`env.${name.slice(0, 40).replace(ANY_CONTROL, '')}`, `only ${ENV_NAMES.join(', ')} are carried`);
    const path = absolutePath(value, `env.${name}`);
    if (!path.ok) return path;
    variables.push(`    <key>${name}</key><string>${xml(path.value)}</string>`);
  }
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    PLIST_MARKER,
    '<plist version="1.0">',
    '<dict>',
    `  <key>Label</key><string>${xml(input.label)}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...[node.value, ...nodeArgs, entry.value, 'digest'].map((arg) => `    <string>${xml(arg)}</string>`),
    '  </array>',
    ...(variables.length > 0 ? ['  <key>EnvironmentVariables</key>', '  <dict>', ...variables, '  </dict>'] : []),
    '  <key>StartCalendarInterval</key>',
    '  <array>',
    ...intervals,
    '  </array>',
    `  <key>StandardOutPath</key><string>${xml(log.value)}</string>`,
    `  <key>StandardErrorPath</key><string>${xml(log.value)}</string>`,
    '</dict>',
    '</plist>',
    '',
  ];
  return ok(lines.join('\n'));
}

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

// The existing file's text, read without following a symbolic link placed after the check.
function readExisting(path: string): string | 'symlink' {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ELOOP') return 'symlink';
    throw e;
  }
  try {
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}

interface ToolFailure {
  status: number | null;
  detail: string;
}

// Runs a tool with argv (no shell), a timeout and no inherited input. Null when it exited 0; otherwise its exit status and the first line of what it said,
// with control characters removed, so the text is safe to print.
function runTool(tool: string, args: readonly string[]): ToolFailure | null {
  try {
    execFileSync(tool, [...args], { timeout: TOOL_TIMEOUT_MS, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
    return null;
  } catch (e) {
    const failure = e as { status?: number | null; code?: string; stderr?: string };
    const first = (typeof failure.stderr === 'string' ? failure.stderr : '').split('\n')[0] ?? '';
    const said = first.replace(ANY_CONTROL, '').slice(0, 160);
    return { status: typeof failure.status === 'number' ? failure.status : null, detail: said !== '' ? said : (failure.code ?? 'no output') };
  }
}

const exitText = (failure: ToolFailure): string => `exit ${failure.status === null ? 'none' : String(failure.status)}: ${failure.detail}`;

export class LaunchdScheduler {
  private readonly options: LaunchdOptions;

  constructor(options: LaunchdOptions) {
    this.options = options;
  }

  private domain(): string {
    return `gui/${String(this.options.uid)}`;
  }

  install(input: DigestPlistInput): Result<ScheduleInstall> {
    const text = renderDigestPlist(input);
    if (!text.ok) return text;
    for (const [field, path] of [['nodePath', input.nodePath], ['entryPath', input.entryPath]] as const) {
      try {
        if (!statSync(path).isFile()) return invalid(field, `${path} is not a file`);
      } catch {
        return invalid(field, `${path} does not exist`);
      }
    }
    const { agentsDir } = this.options;
    if (!isAbsolute(agentsDir)) return invalid('agentsDir', 'must be an absolute path');
    let temp: string | undefined;
    try {
      // The agents directory itself may not be a symbolic link: a launchd file written through one lands where the link points.
      const dirStat = lstatOrNull(agentsDir);
      if (dirStat === null) mkdirSync(agentsDir, { recursive: true, mode: 0o755 });
      else if (dirStat.isSymbolicLink()) return refuse(`${agentsDir} is a symbolic link, so nothing was written`);
      else if (!dirStat.isDirectory()) return refuse(`${agentsDir} is not a directory, so nothing was written`);

      const file = join(agentsDir, `${input.label}.plist`);
      const stat = lstatOrNull(file);
      let status: ScheduleInstall['status'] = 'installed';
      if (stat !== null) {
        if (stat.isSymbolicLink()) return refuse(`${file} is a symbolic link, so nothing was written`);
        if (!stat.isFile()) return refuse(`${file} is not a regular file, so nothing was written`);
        if (stat.size > MAX_EXISTING_BYTES) return refuse(`${file} was not written by AVARICE (too large), so it was left untouched`);
        const existing = readExisting(file);
        if (existing === 'symlink') return refuse(`${file} is a symbolic link, so nothing was written`);
        if (!existing.split('\n').includes(PLIST_MARKER)) return refuse(`${file} was not written by AVARICE (it has no marker line), so it was left untouched`);
        status = 'replaced';
      }

      // launchd opens the log file but does not create its directory.
      const logDir = dirname(input.logPath);
      const logStat = lstatOrNull(logDir);
      if (logStat === null) mkdirSync(logDir, { recursive: true, mode: 0o700 });
      else if (logStat.isSymbolicLink()) return refuse(`${logDir} is a symbolic link, so nothing was written`);
      else if (!logStat.isDirectory()) return refuse(`${logDir} is not a directory, so nothing was written`);

      temp = join(agentsDir, `.${input.label}.plist.${String(process.pid)}.${randomBytes(4).toString('hex')}.tmp`);
      // `wx` never opens an existing path, so a planted file or link at the temporary name is an error, not a write through it.
      const fd = openSync(temp, 'wx', 0o644);
      try {
        writeSync(fd, text.value);
        fchmodSync(fd, 0o644);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      const linted = runTool(this.options.plutil, ['-lint', temp]);
      if (linted !== null) {
        unlinkSync(temp);
        temp = undefined;
        return err({ kind: 'internal', cause: `plutil lint refused the plist (${exitText(linted)}); nothing was installed` });
      }
      if (status === 'replaced') runTool(this.options.launchctl, ['bootout', `${this.domain()}/${input.label}`]);
      renameSync(temp, file);
      temp = undefined;
      const loaded = runTool(this.options.launchctl, ['bootstrap', this.domain(), file]);
      if (loaded !== null) {
        if (status === 'installed') unlinkSync(file);
        return err({ kind: 'internal', cause: `launchctl bootstrap failed (${exitText(loaded)}); ${status === 'installed' ? 'the new file was removed again' : 'the new file is in place but not loaded'}` });
      }
      return ok({ label: input.label, path: file, status });
    } catch (e) {
      if (temp !== undefined) {
        try {
          unlinkSync(temp);
        } catch {
          // already gone
        }
      }
      return err({ kind: 'internal', cause: `cannot install the digest schedule: ${(e as NodeJS.ErrnoException).code ?? (e instanceof Error ? e.message : String(e))}` });
    }
  }

  remove(label: string): Result<ScheduleRemoval> {
    if (typeof label !== 'string' || label.length > LABEL_MAX_CHARS || !LABEL.test(label)) return invalid('label', `expected ${DIGEST_LABEL_PREFIX} followed by a-z, 0-9, dot and dash`);
    const { agentsDir } = this.options;
    if (!isAbsolute(agentsDir)) return invalid('agentsDir', 'must be an absolute path');
    try {
      const file = join(agentsDir, `${label}.plist`);
      const dirStat = lstatOrNull(agentsDir);
      if (dirStat === null) return ok({ label, path: file, status: 'not-installed' });
      if (dirStat.isSymbolicLink()) return refuse(`${agentsDir} is a symbolic link, so nothing was removed`);
      const stat = lstatOrNull(file);
      if (stat === null) return ok({ label, path: file, status: 'not-installed' });
      if (stat.isSymbolicLink()) return refuse(`${file} is a symbolic link, so nothing was removed`);
      if (!stat.isFile()) return refuse(`${file} is not a regular file, so nothing was removed`);
      if (stat.size > MAX_EXISTING_BYTES) return refuse(`${file} was not written by AVARICE (too large), so it was left untouched`);
      const existing = readExisting(file);
      if (existing === 'symlink') return refuse(`${file} is a symbolic link, so nothing was removed`);
      // Only a file that carries the marker is ours, so only then is its label unloaded or the file deleted.
      if (!existing.split('\n').includes(PLIST_MARKER)) return refuse(`${file} was not written by AVARICE (it has no marker line), so it was left untouched`);
      const unloaded = runTool(this.options.launchctl, ['bootout', `${this.domain()}/${label}`]);
      if (unloaded !== null && !NOT_LOADED_EXITS.includes(unloaded.status)) {
        return err({ kind: 'internal', cause: `launchctl bootout failed (${exitText(unloaded)}); the file was left in place` });
      }
      unlinkSync(file);
      return ok({ label, path: file, status: 'removed' });
    } catch (e) {
      return err({ kind: 'internal', cause: `cannot remove the digest schedule: ${(e as NodeJS.ErrnoException).code ?? (e instanceof Error ? e.message : String(e))}` });
    }
  }
}
