// The attended PreToolUse hook entry in a Claude settings.json (plan 04-19; FR-12, S-4, T-04-52; docs/extensions.md entries 2 and 4). `avarice install-host`
// writes one entry to `<claude config dir>/settings.json`, beside the skill, that runs AVARICE's hook entry in attended mode: it enforces privileged-action
// approvals in the owner's own sessions (src/hook/pre-tool-use.ts "Attended mode").
//
// The owner's file is not AVARICE's. Settings JSON has no comment field, so an entry is identified as AVARICE's by the argument ATTENDED_HOOK_MARKER in its
// command string, and only such an entry is ever replaced. Every other key and every other entry keeps its content (and the file keeps its indentation and its
// mode). A symbolic link at settings.json, a file that is not a JSON object with the hook structure, and an entry that mixes the marker with another command
// are refused with nothing written. The file is written through a temporary file and a rename, so a reader sees the old file or the new one.
// A refusal is a `denied` error (the command exits 3); a failure to read or write is `internal`.
import { closeSync, constants, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { canonicalJson, digestOf } from '../../domain/digest.ts';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';

// The argument that marks the entry as AVARICE's: settings JSON has no comment field, so the marker is part of the command string.
export const ATTENDED_HOOK_MARKER = '--avarice-attended-hook';

export type AttendedHookStatus = 'installed' | 'unchanged' | 'updated';

export interface AttendedHookInstall {
  status: AttendedHookStatus;
  // The settings.json that was written or found.
  path: string;
  // The digest of the entry AVARICE keeps in it.
  digest: string;
}

export interface AttendedHookOptions {
  // The absolute path of the hook entry script (src/hook/pre-tool-use.ts).
  hookEntry: string;
  // The absolute path of the profile's data root, where the ledger `state.db` lives.
  dataRoot: string;
}

// A settings.json larger than this is not a file this command edits.
const MAX_SETTINGS_BYTES = 1024 * 1024;
// The host runs a hook with this time limit; the entry fails closed (a block) beyond it, as the run settings do (docs/extensions.md entry 2).
const HOOK_TIMEOUT_SECONDS = 5;

const refuse = (reason: string): Result<never> => err({ kind: 'denied', rule: reason, enforcer: 'avarice' });

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

const SAFE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;
const quote = (word: string): string => (SAFE_WORD.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`);

// The entry as it is written: the matcher Bash, and one command hook whose command line runs the hook entry in attended mode.
export function attendedHookEntry(options: AttendedHookOptions): Json {
  const words = [process.execPath, '--disable-warning=ExperimentalWarning', options.hookEntry, '--event', 'pre', '--attended', ATTENDED_HOOK_MARKER, '--data-root', options.dataRoot];
  return {
    matcher: 'Bash',
    hooks: [{ type: 'command', command: words.map(quote).join(' '), timeout: HOOK_TIMEOUT_SECONDS, onFailure: 'block' }],
  };
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

// The indentation the file already uses (the whitespace before its first key), so a rewrite does not reformat the owner's file; two spaces for a new file.
function indentOf(text: string | null): string {
  const found = text === null ? null : /^([ \t]+)"/m.exec(text);
  return found?.[1] ?? '  ';
}

// What each entry of PreToolUse is to this command: AVARICE's (every command in it carries the marker), not AVARICE's, or a mix that is not safe to edit.
function ownership(entry: unknown): 'ours' | 'theirs' | 'mixed' | 'invalid' {
  if (!isObject(entry)) return 'invalid';
  const inner = Array.isArray(entry['hooks']) ? (entry['hooks'] as unknown[]) : [];
  const marked = inner.filter((hook) => isObject(hook) && typeof hook['command'] === 'string' && hook['command'].includes(ATTENDED_HOOK_MARKER)).length;
  if (marked === 0) return 'theirs';
  return marked === inner.length ? 'ours' : 'mixed';
}

export function installAttendedHook(configDir: string, options: AttendedHookOptions): Result<AttendedHookInstall> {
  for (const [field, value] of [['configDir', configDir], ['hookEntry', options.hookEntry], ['dataRoot', options.dataRoot]] as const) {
    if (!isAbsolute(value)) return err({ kind: 'invalid', field, reason: 'must be an absolute path' });
  }
  const entry = attendedHookEntry(options);
  const digest = digestOf(entry);
  try {
    // The configuration directory itself may be a symbolic link (a dotfiles setup); the file in it may not.
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    const dir = realpathSync(configDir);
    const file = join(dir, 'settings.json');
    const stat = lstatOrNull(file);

    let text: string | null = null;
    let settings: Json = {};
    if (stat !== null) {
      if (stat.isSymbolicLink()) return refuse(`${file} is a symbolic link, so nothing was written`);
      if (!stat.isFile()) return refuse(`${file} is not a regular file, so nothing was written`);
      if (stat.size > MAX_SETTINGS_BYTES) return refuse(`${file} is larger than ${MAX_SETTINGS_BYTES} bytes, so it was left untouched`);
      const existing = readExisting(file);
      if (existing === 'symlink') return refuse(`${file} is a symbolic link, so nothing was written`);
      text = existing;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return refuse(`${file} is not valid JSON, so it was left untouched`);
      }
      if (!isObject(parsed)) return refuse(`${file} is not a JSON object, so it was left untouched`);
      settings = parsed;
    }

    const hooks = settings['hooks'];
    if (hooks !== undefined && !isObject(hooks)) return refuse(`${file} has a "hooks" that is not an object, so it was left untouched`);
    const preTool = hooks?.['PreToolUse'];
    if (preTool !== undefined && !Array.isArray(preTool)) return refuse(`${file} has a "hooks.PreToolUse" that is not a list, so it was left untouched`);
    const entries: unknown[] = Array.isArray(preTool) ? [...preTool] : [];
    const owned: number[] = [];
    for (const [index, existing] of entries.entries()) {
      const kind = ownership(existing);
      if (kind === 'invalid') return refuse(`${file} has a "hooks.PreToolUse" entry that is not an object, so it was left untouched`);
      if (kind === 'mixed') return refuse(`${file} has a hook entry that mixes the ${ATTENDED_HOOK_MARKER} marker with a command that is not AVARICE's, so it was left untouched`);
      if (kind === 'ours') owned.push(index);
    }

    let status: AttendedHookStatus;
    let next: unknown[];
    if (owned.length === 0) {
      status = 'installed';
      next = [...entries, entry];
    } else if (owned.length === 1 && canonicalJson(entries[owned[0] as number]) === canonicalJson(entry)) {
      return ok({ status: 'unchanged', path: file, digest });
    } else {
      // The first of AVARICE's entries is replaced where it stands; any further copy is removed.
      status = 'updated';
      next = entries.flatMap((existing, index) => (index === owned[0] ? [entry] : owned.includes(index) ? [] : [existing]));
    }

    const written: Json = { ...settings, hooks: { ...(hooks ?? {}), PreToolUse: next } };
    const body = JSON.stringify(written, null, indentOf(text)) + (text === null || text.endsWith('\n') ? '\n' : '');
    const mode = stat !== null ? stat.mode & 0o777 : 0o600;
    const temp = join(dir, `.settings.json.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
    // `wx` never opens an existing path, so a planted file or link at the temporary name is an error, not a write through it.
    const fd = openSync(temp, 'wx', mode);
    try {
      writeSync(fd, body);
      fchmodSync(fd, mode);
      fsyncSync(fd);
    } catch (e) {
      closeSync(fd);
      unlinkSync(temp);
      throw e;
    }
    closeSync(fd);
    try {
      renameSync(temp, file);
    } catch (e) {
      unlinkSync(temp);
      throw e;
    }
    return ok({ status, path: file, digest });
  } catch (e) {
    return err({ kind: 'internal', cause: `cannot install the attended hook: ${(e as NodeJS.ErrnoException).code ?? (e instanceof Error ? e.message : String(e))}` });
  }
}
