// The repository binding registry and the enterprise remote patterns (SEC-1, D-16, S-9). `<configHome>/bindings.json` records which
// profile a repository belongs to, keyed by the repository's realpath git root and its root commit; it lives outside every store, so
// the profile can be chosen before any store is opened. Like the profile config, every file here is opened without following a symbolic
// link and read only when it is a regular file of at most 64 KiB, so a planted link or a huge file cannot steer which store opens.
// Entries are validated by hand: a file that does not validate is refused whole (nothing is skipped), because a skipped entry would
// silently let a bound repository open under another profile.
import { closeSync, constants, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseProfileName, profileClass } from '../../domain/profile.ts';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { configPathFor } from './profile-paths.ts';

export const MAX_REGISTRY_BYTES = 64 * 1024;
export const BINDINGS_FILE = 'bindings.json';
const BINDINGS_SCHEMA = 1;
const MAX_BINDINGS = 1000;
const MAX_PATTERNS = 64;
const MAX_PATTERN_CHARS = 256;

export interface Binding {
  gitRoot: string;
  rootCommit: string;
  profile: string;
  boundAt: string;
}

export interface RepositoryIdentity {
  gitRoot: string;
  rootCommit: string;
}

export interface EnterprisePatterns {
  profile: string;
  patterns: string[];
}

// The parsed JSON of a small regular file, or `undefined` when the file is absent. A symbolic link, a file that is not regular, a file
// over the cap and text that is not JSON are `invalid` with the file named; anything else that stops the read is `unavailable`.
function readSmallJson(path: string, label: string): Result<unknown> {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (code === 'ENOENT') return ok(undefined);
    if (code === 'ELOOP') return err({ kind: 'invalid', field: label, reason: `${path} is a symbolic link, which is refused` });
    return err({ kind: 'unavailable', cause: `cannot read ${path}: ${typeof code === 'string' ? code : 'open failed'}` });
  }
  try {
    const info = fstatSync(fd);
    if (!info.isFile()) return err({ kind: 'invalid', field: label, reason: `${path} is not a regular file` });
    if (info.size > MAX_REGISTRY_BYTES) return err({ kind: 'invalid', field: label, reason: `${path} is larger than ${MAX_REGISTRY_BYTES} bytes` });
    try {
      return ok(JSON.parse(readFileSync(fd, 'utf8')) as unknown);
    } catch {
      return err({ kind: 'invalid', field: label, reason: `${path} is not valid JSON` });
    }
  } catch (e) {
    return err({ kind: 'unavailable', cause: `cannot read ${path}: ${(e as { code?: unknown }).code === undefined ? 'read failed' : String((e as { code?: unknown }).code)}` });
  } finally {
    closeSync(fd);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBinding(value: unknown, path: string, index: number): Result<Binding> {
  const where = `${path} entry ${index}`;
  if (!isRecord(value)) return err({ kind: 'invalid', field: 'bindings', reason: `${where} is not an object` });
  const { gitRoot, rootCommit, profile, boundAt } = value;
  if (typeof gitRoot !== 'string' || gitRoot === '' || gitRoot.length > 4096) return err({ kind: 'invalid', field: 'bindings', reason: `${where} has no gitRoot` });
  if (typeof rootCommit !== 'string' || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(rootCommit)) return err({ kind: 'invalid', field: 'bindings', reason: `${where} has no rootCommit` });
  if (typeof profile !== 'string') return err({ kind: 'invalid', field: 'bindings', reason: `${where} has no profile` });
  const named = parseProfileName(profile);
  if (!named.ok) return err({ kind: 'invalid', field: 'bindings', reason: `${where} names a profile that is not valid` });
  if (typeof boundAt !== 'string' || boundAt === '' || boundAt.length > 64) return err({ kind: 'invalid', field: 'bindings', reason: `${where} has no boundAt` });
  return ok({ gitRoot, rootCommit, profile, boundAt });
}

export function bindingsPathFor(configHome: string): string {
  return join(configHome, BINDINGS_FILE);
}

// Every binding of the registry; an absent file is no bindings.
export function readBindings(configHome: string): Result<Binding[]> {
  const path = bindingsPathFor(configHome);
  const raw = readSmallJson(path, BINDINGS_FILE);
  if (!raw.ok) return raw;
  if (raw.value === undefined) return ok([]);
  if (!isRecord(raw.value) || raw.value['schema'] !== BINDINGS_SCHEMA || !Array.isArray(raw.value['bindings'])) {
    return err({ kind: 'invalid', field: BINDINGS_FILE, reason: `${path} is not a version ${BINDINGS_SCHEMA} bindings file` });
  }
  const entries = raw.value['bindings'] as unknown[];
  if (entries.length > MAX_BINDINGS) return err({ kind: 'invalid', field: BINDINGS_FILE, reason: `${path} holds more than ${MAX_BINDINGS} bindings` });
  const out: Binding[] = [];
  for (const [index, entry] of entries.entries()) {
    const parsed = parseBinding(entry, path, index);
    if (!parsed.ok) return parsed;
    out.push(parsed.value);
  }
  return ok(out);
}

// The identity of every project a store holds, bound to `profile` when it has no binding yet (D-18: a project already in a store belongs to the
// profile of that store, so the first command that may write makes that explicit). A project whose repository path is no longer on disk has no
// git root to bind and is skipped. A project that is already bound to the same profile is left alone; one bound to another profile is a
// `conflict` naming the repository and that profile, and nothing is written for the projects after it.
export function backfillBindings(configHome: string, profile: string, projects: ReadonlyArray<{ rootCommit: string; repoPath: string }>, nowMs: number): Result<number> {
  let added = 0;
  for (const project of projects) {
    let gitRoot: string;
    try {
      gitRoot = realpathSync(project.repoPath);
    } catch {
      continue;
    }
    const existing = findBinding(configHome, { gitRoot, rootCommit: project.rootCommit });
    if (!existing.ok) return existing;
    if (existing.value !== undefined) {
      if (existing.value.profile === profile) continue;
      return err({ kind: 'conflict', expected: profile, actual: `repository ${gitRoot} is bound to ${existing.value.profile}` });
    }
    const written = writeBinding(configHome, { gitRoot, rootCommit: project.rootCommit, profile, boundAt: new Date(nowMs).toISOString() });
    if (!written.ok) return written;
    added += 1;
  }
  return ok(added);
}

// The binding of a repository: the entry whose git root and root commit are both the repository's.
export function findBinding(configHome: string, identity: RepositoryIdentity): Result<Binding | undefined> {
  const all = readBindings(configHome);
  if (!all.ok) return all;
  return ok(all.value.find((b) => b.gitRoot === identity.gitRoot && b.rootCommit === identity.rootCommit));
}

// Adds a binding. Create-only: a repository already bound to the same profile is left as it is, and one bound to another profile is a
// `conflict` that changes nothing (a binding is never re-pointed). The file is written to a temporary name and renamed over the
// registry, mode 0600, so a reader sees the old registry or the new one and never half of either.
export function writeBinding(configHome: string, binding: Binding): Result<Binding> {
  const existing = readBindings(configHome);
  if (!existing.ok) return existing;
  const same = existing.value.find((b) => b.gitRoot === binding.gitRoot && b.rootCommit === binding.rootCommit);
  if (same !== undefined) {
    if (same.profile === binding.profile) return ok(same);
    return err({ kind: 'conflict', expected: binding.profile, actual: `repository bound to ${same.profile}` });
  }
  if (existing.value.length >= MAX_BINDINGS) return err({ kind: 'invalid', field: BINDINGS_FILE, reason: `the registry already holds ${MAX_BINDINGS} bindings` });
  const path = bindingsPathFor(configHome);
  const temp = `${path}.${process.pid}.tmp`;
  try {
    mkdirSync(configHome, { recursive: true, mode: 0o700 });
    writeFileSync(temp, `${JSON.stringify({ schema: BINDINGS_SCHEMA, bindings: [...existing.value, binding] }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    renameSync(temp, path);
  } catch (e) {
    try {
      unlinkSync(temp);
    } catch {
      // never written
    }
    return err({ kind: 'unavailable', cause: `cannot write ${path}: ${(e as { code?: unknown }).code === undefined ? 'write failed' : String((e as { code?: unknown }).code)}` });
  }
  return ok(binding);
}

function parsePatterns(value: unknown, path: string): Result<string[]> {
  if (value === undefined) return ok([]);
  if (!Array.isArray(value) || value.length > MAX_PATTERNS || !value.every((p) => typeof p === 'string' && p.trim() !== '' && p.length <= MAX_PATTERN_CHARS)) {
    return err({ kind: 'invalid', field: 'remotePatterns', reason: `remotePatterns in ${path} must be a list of at most ${MAX_PATTERNS} non-empty strings of at most ${MAX_PATTERN_CHARS} characters` });
  }
  return ok(value as string[]);
}

// The `remotePatterns` of every enterprise profile config under `<configHome>/profiles/enterprise-*/config.json`, sorted by profile.
// Only config files are read, never a store, and only the `remotePatterns` key. A directory whose name does not follow the profile
// grammar is not a profile and is skipped; a config that cannot be trusted (a link, too large, not JSON, a malformed list) is an error,
// so the caller refuses instead of taking the repository to be personal.
export function readEnterprisePatterns(configHome: string): Result<EnterprisePatterns[]> {
  let names: string[];
  try {
    names = readdirSync(join(configHome, 'profiles'));
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return ok([]);
    return err({ kind: 'unavailable', cause: `cannot list the profiles of ${configHome}: ${typeof code === 'string' ? code : 'read failed'}` });
  }
  const out: EnterprisePatterns[] = [];
  for (const name of names.sort()) {
    const named = parseProfileName(name);
    if (!named.ok || profileClass(name) !== 'enterprise') continue;
    const path = configPathFor(configHome, name);
    const raw = readSmallJson(path, 'config');
    if (!raw.ok) return err(raw.error.kind === 'invalid' ? { kind: 'invalid', field: 'config', reason: `profile ${name}: ${raw.error.reason}` } : raw.error);
    if (raw.value === undefined) continue;
    if (!isRecord(raw.value)) return err({ kind: 'invalid', field: 'config', reason: `profile ${name}: ${path} is not a JSON object` });
    const patterns = parsePatterns(raw.value['remotePatterns'], path);
    if (!patterns.ok) return err(patterns.error.kind === 'invalid' ? { kind: 'invalid', field: 'config', reason: `profile ${name}: ${patterns.error.reason}` } : patterns.error);
    if (patterns.value.length > 0) out.push({ profile: name, patterns: patterns.value });
  }
  return ok(out);
}
