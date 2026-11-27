// The probes behind `avarice doctor` (plan 04-25; OPS-1, OPS-6). Every probe that starts a process has its own timeout (1 s unless the caller asks for more) and a
// kill signal that cannot be ignored, so a hung `claude` or `graphify` costs doctor its bound and no more. Nothing here writes, except `removeOrphanTemps`, which the
// caller reaches only through `--repair`: the store is opened read-only and never migrated, no lease is taken, no credential is resolved, no model is started.
// The processes started get a small environment: enough to find themselves, nothing that carries a credential.
import { spawnSync } from 'node:child_process';
import { accessSync, closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, isAbsolute, join } from 'node:path';
import { describeError, openDb } from '../sqlite/db.ts';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { ClaudeFacts, CliStatus, ConfigDirFacts, Diagnostics, GraphifyFacts, GsdFacts, HookSettingsFacts, NodeFacts, StoreFacts } from '../../ports/diagnostics.ts';
import { DelegatedProvider } from '../credential/delegated.ts';
import { findGraphifyBinary } from '../graph/graphify.ts';
import { identifyGsdCore } from '../gsd/locate.ts';
import { ATTENDED_HOOK_MARKER } from '../host-claude/attended-hook-install.ts';
import { DEFAULT_SANDBOX_PROBE } from '../host-claude/launch-preflight.ts';

export const PROBE_TIMEOUT_MS = 1_000;
// The one probe that reaches the network, and only under --online: the CLI's own authentication check.
export const ONLINE_TIMEOUT_MS = 8_000;

const MAX_TEXT_BYTES = 256 * 1024;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

// Enough for a host or a CLI to find itself, nothing that carries a credential.
function probeEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = { PATH: '/usr/bin:/bin:/opt/homebrew/bin' };
  for (const name of ['HOME', 'USER', 'LOGNAME', 'LANG', 'TMPDIR', 'CLAUDE_CONFIG_DIR']) {
    const value = source[name];
    if (value !== undefined && value !== '') env[name] = value;
  }
  return env;
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// A text file of at most MAX_TEXT_BYTES, opened without following a link placed after the check; undefined when it is absent, not a regular file, too large or unreadable.
function readSmallText(path: string): { text: string } | { absent: true } | { unreadable: true } {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? { absent: true } : { unreadable: true };
  }
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > MAX_TEXT_BYTES) return { unreadable: true };
    return { text: readFileSync(fd, 'utf8') };
  } catch {
    return { unreadable: true };
  } finally {
    closeSync(fd);
  }
}

// The entries of `hooks.PreToolUse` whose command carries the attended marker.
function attendedEntriesOf(settings: unknown): number {
  const groups = isObject(settings) && isObject(settings['hooks']) ? settings['hooks']['PreToolUse'] : undefined;
  if (!Array.isArray(groups)) return 0;
  return groups.filter((group) => isObject(group) && Array.isArray(group['hooks']) && group['hooks'].some((hook) => isObject(hook) && typeof hook['command'] === 'string' && hook['command'].includes(ATTENDED_HOOK_MARKER))).length;
}

// The command strings of the attended entries: every command of a PreToolUse entry that carries the marker.
function attendedCommandsOf(settings: unknown): string[] {
  const groups = isObject(settings) && isObject(settings['hooks']) ? settings['hooks']['PreToolUse'] : undefined;
  if (!Array.isArray(groups)) return [];
  const commands: string[] = [];
  for (const group of groups) {
    if (!isObject(group) || !Array.isArray(group['hooks'])) continue;
    for (const hook of group['hooks']) {
      if (isObject(hook) && typeof hook['command'] === 'string' && hook['command'].includes(ATTENDED_HOOK_MARKER)) commands.push(hook['command']);
    }
  }
  return commands;
}

// Lines of an instruction file that mention pushing or opening a pull request. A line that carries a word of approval, or a prohibition, is not a conflict.
const PUSH_MENTION = /\bgit\s+push\b|\bgh\s+pr\s+create\b|\b(?:create|open|raise|submit)\s+(?:a\s+|the\s+)?(?:pull request|PR)\b/i;
const APPROVAL_WORD = /\b(?:approv\w*|ask\w*|confirm\w*|permission|consent|never|do not|don't|must not|without asking)\b/i;

export interface ProbeOptions {
  // The timeout of a probe that starts a process; PROBE_TIMEOUT_MS when absent.
  timeoutMs?: number;
}

export class ProcessDiagnostics implements Diagnostics {
  readonly #timeout: number;

  constructor(options: ProbeOptions = {}) {
    this.#timeout = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  }

  node(): NodeFacts {
    let engines: string | undefined;
    try {
      const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as unknown;
      const rule = isObject(pkg) && isObject(pkg['engines']) ? pkg['engines']['node'] : undefined;
      if (typeof rule === 'string') engines = rule;
    } catch {
      // the rule is reported as unknown
    }
    return { version: process.versions.node, engines };
  }

  sqliteVersion(): Result<string> {
    try {
      const probe = new DatabaseSync(':memory:');
      try {
        return ok(String((probe.prepare('select sqlite_version() as v').get() as { v: string }).v));
      } finally {
        probe.close();
      }
    } catch (e) {
      return err({ kind: 'internal', cause: `cannot read the bundled SQLite version: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  store(path: string): StoreFacts {
    let size: number;
    try {
      size = statSync(path).size;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'absent', adapters: [] };
      return { state: 'unreadable', detail: `cannot inspect the store file: ${(e as NodeJS.ErrnoException).code ?? 'stat failed'}`, adapters: [] };
    }
    const opened = openDb(path, { readOnly: true });
    if (!opened.ok) return { state: 'unreadable', detail: describeError(opened.error), sizeBytes: size, adapters: [] };
    const db = opened.value;
    const facts: StoreFacts = { state: 'readable', sizeBytes: size, adapters: [] };
    try {
      try {
        const row = db.prepare('SELECT max(version) AS v FROM schema_migrations').get() as { v: number | null } | undefined;
        if (row?.v !== null && row?.v !== undefined) facts.schemaVersion = Number(row.v);
      } catch {
        // a database with no migration table is reported with no schema version
      }
      try {
        const profile = db.prepare("SELECT value FROM meta WHERE key = 'profile_id'").get() as { value?: unknown } | undefined;
        if (typeof profile?.value === 'string') facts.profileId = profile.value;
      } catch {
        // no meta table
      }
      try {
        const mode = db.prepare('PRAGMA journal_mode').get() as { journal_mode?: unknown } | undefined;
        if (typeof mode?.journal_mode === 'string') facts.journalMode = mode.journal_mode.toLowerCase();
      } catch {
        // not readable
      }
      try {
        // quick_check reads the pages without cross-checking every index against its table, so it stays inside doctor's bound on a store of any size.
        const check = db.prepare('PRAGMA quick_check(1)').get() as { quick_check?: unknown } | undefined;
        if (typeof check?.quick_check === 'string') facts.integrity = check.quick_check;
      } catch (e) {
        facts.integrity = e instanceof Error ? e.message.slice(0, 120) : 'the check could not run';
      }
      try {
        const rows = db.prepare('SELECT count(*) AS n FROM events').get() as { n?: unknown } | undefined;
        const dropped = db.prepare("SELECT value FROM meta WHERE key = 'events_dropped_debug'").get() as { value?: unknown } | undefined;
        if (typeof rows?.n === 'number' || typeof rows?.n === 'bigint') facts.events = { rows: Number(rows.n), droppedDebug: dropped?.value === undefined ? 0 : Number(dropped.value) || 0 };
      } catch {
        // no events table
      }
      try {
        facts.adapters = (db.prepare('SELECT name, port, adapter FROM adapter_configs ORDER BY name').all() as Array<{ name: unknown; port: unknown; adapter: unknown }>).map((r) => ({ name: String(r.name), port: String(r.port), adapter: String(r.adapter) }));
      } catch {
        // no adapter table
      }
    } finally {
      db.close();
    }
    try {
      const backups = join(dirname(path), 'backups');
      let newest: number | undefined;
      for (const name of readdirSync(backups)) {
        if (!/^pre-migration-.*\.db$/.test(name)) continue;
        const stat = statSync(join(backups, name));
        if (newest === undefined || stat.mtimeMs > newest) newest = stat.mtimeMs;
      }
      if (newest !== undefined) facts.lastBackupMs = newest;
    } catch {
      // no backups directory: no backup yet
    }
    return facts;
  }

  claude(bin: string): ClaudeFacts {
    if (!isExecutableFile(bin)) return { state: 'absent' };
    const ran = spawnSync(bin, ['--version'], { timeout: this.#timeout, killSignal: 'SIGKILL', encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: probeEnv(process.env) });
    if (ran.error !== undefined) {
      const code = (ran.error as NodeJS.ErrnoException).code;
      return code === 'ENOENT' ? { state: 'absent' } : { state: 'failed', cause: code === 'ETIMEDOUT' ? 'timed out' : (code ?? 'could not run') };
    }
    if (ran.status !== 0) return { state: 'failed', cause: `exit ${String(ran.status)}` };
    return { state: 'ran', versionOutput: ran.stdout ?? '' };
  }

  claudeHelp(bin: string): string | undefined {
    const ran = spawnSync(bin, ['--help'], { timeout: this.#timeout, killSignal: 'SIGKILL', encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: probeEnv(process.env), maxBuffer: 1024 * 1024 });
    return ran.error !== undefined || ran.status !== 0 ? undefined : ran.stdout;
  }

  gsd(env: NodeJS.ProcessEnv): GsdFacts {
    const identity = identifyGsdCore(env, this.#timeout);
    return identity;
  }

  graphify(env: NodeJS.ProcessEnv): GraphifyFacts {
    let path: string | undefined;
    try {
      path = findGraphifyBinary(env);
    } catch {
      path = undefined;
    }
    if (path === undefined) return { state: 'absent' };
    const ran = spawnSync(path, ['--version'], { timeout: this.#timeout, killSignal: 'SIGKILL', encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: probeEnv(env) });
    if (ran.error !== undefined) return { state: 'found', path, version: undefined, detail: (ran.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ? 'the version probe timed out' : 'the version probe could not run' };
    if (ran.status !== 0) return { state: 'found', path, version: undefined, detail: `the version probe exited ${String(ran.status)}` };
    return { state: 'found', path, version: /\d+\.\d+\.\d+\S*/.exec(ran.stdout ?? '')?.[0] };
  }

  sandbox(): boolean {
    const [bin, ...args] = DEFAULT_SANDBOX_PROBE;
    if (bin === undefined) return false;
    const ran = spawnSync(bin, args, { timeout: this.#timeout, killSignal: 'SIGKILL', stdio: 'ignore', env: probeEnv(process.env) });
    return ran.error === undefined && ran.status === 0;
  }

  readable(path: string): boolean {
    try {
      accessSync(path, constants.R_OK);
      return statSync(path).isFile();
    } catch {
      return false;
    }
  }

  hookSettings(configDir: string): HookSettingsFacts {
    const path = join(configDir, 'settings.json');
    const read = readSmallText(path);
    if ('absent' in read) return { path, state: 'absent', attendedEntries: 0, attendedCommands: [] };
    if ('unreadable' in read) return { path, state: 'unreadable', attendedEntries: 0, attendedCommands: [] };
    try {
      const parsed: unknown = JSON.parse(read.text);
      return { path, state: 'read', attendedEntries: attendedEntriesOf(parsed), attendedCommands: attendedCommandsOf(parsed) };
    } catch {
      return { path, state: 'unreadable', attendedEntries: 0, attendedCommands: [] };
    }
  }

  configDir(path: string): ConfigDirFacts {
    const facts: ConfigDirFacts = { path, exists: false, attendedEntries: 0, attendedCommands: [], skills: [], instructionLines: [] };
    try {
      facts.exists = statSync(path).isDirectory();
    } catch {
      return facts;
    }
    const settings = this.hookSettings(path);
    facts.attendedEntries = settings.attendedEntries;
    facts.attendedCommands = settings.attendedCommands;
    try {
      for (const entry of readdirSync(join(path, 'skills'), { withFileTypes: true })) {
        if (!entry.name.startsWith('avarice-')) continue;
        let isDir = entry.isDirectory();
        if (entry.isSymbolicLink()) {
          try {
            isDir = statSync(join(path, 'skills', entry.name)).isDirectory();
          } catch {
            isDir = false;
          }
        }
        if (isDir) facts.skills.push(entry.name);
      }
      facts.skills.sort();
    } catch {
      // no skills directory
    }
    const instructions = readSmallText(join(path, 'CLAUDE.md'));
    if ('text' in instructions) {
      instructions.text.split(/\r\n|\n|\r/).forEach((line, index) => {
        if (PUSH_MENTION.test(line) && !APPROVAL_WORD.test(line)) facts.instructionLines.push(index + 1);
      });
    }
    return facts;
  }

  async delegatedAuth(cli: string, env: NodeJS.ProcessEnv): Promise<CliStatus> {
    const pathEnv = env['PATH'] ?? '';
    // The delegated provider decides whether the CLI is there, by the rule every other use of a `delegated:` reference follows.
    const found = await new DelegatedProvider({ pathEnv }).resolve(cli, 'doctor --online');
    if (!found.ok) return { state: 'absent' };
    const runEnv: Record<string, string> = { PATH: pathEnv.split(':').filter((dir) => isAbsolute(dir)).join(':') };
    // The CLI finds its own login through its configuration directory. A token in AVARICE's environment is not passed on: an environment variable is not a credential source (S-49).
    for (const name of ['HOME', 'USER', 'LOGNAME', 'LANG', 'TMPDIR', 'XDG_CONFIG_HOME', 'GH_CONFIG_DIR']) {
      const value = env[name];
      if (value !== undefined && value !== '') runEnv[name] = value;
    }
    const ran = spawnSync(cli, ['auth', 'status'], { timeout: ONLINE_TIMEOUT_MS, killSignal: 'SIGKILL', stdio: 'ignore', env: runEnv });
    if (ran.error !== undefined) return (ran.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ? { state: 'timed_out' } : { state: 'absent' };
    return ran.status === 0 ? { state: 'ok' } : { state: 'failed', exitCode: ran.status };
  }

  removeOrphanTemps(dataRoot: string, nowMs: number, olderThanMs: number): { removed: number; kept: number } {
    const root = join(dataRoot, 'artifacts');
    let removed = 0;
    let kept = 0;
    let shards: string[];
    try {
      shards = readdirSync(root);
    } catch {
      return { removed, kept };
    }
    for (const shard of shards) {
      let names: string[];
      try {
        names = readdirSync(join(root, shard));
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.startsWith('.tmp-')) continue;
        const file = join(root, shard, name);
        try {
          const stat = lstatSync(file);
          if (!stat.isFile()) continue;
          if (nowMs - stat.mtimeMs >= olderThanMs) {
            unlinkSync(file);
            removed += 1;
          } else {
            kept += 1;
          }
        } catch {
          // gone already, or not ours to remove
        }
      }
    }
    return { removed, kept };
  }
}
