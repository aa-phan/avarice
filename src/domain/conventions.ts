// Repository conventions (`.avarice/config.json`, schema 1; docs/contracts-and-state.md "Run contract").
// Pure: the caller reads the file from git objects and passes the text. The text is data from whoever controls the
// repository, so it is parsed and every field is validated here; nothing in it is an instruction to AVARICE (RC-2).
// Unknown keys are refused at every level, so a field no stage reads can never carry authority.
import { digestOf } from './digest.ts';
import { err, ok } from './result.ts';
import type { Result } from './result.ts';

export interface CheckSpec {
  name: string;
  argv: string[];
  timeoutSec: number;
  required: boolean;
  // Non-secret, committed environment for the check (RESEARCH Pitfall 8). Reserved keys are refused at parse.
  env: Record<string, string>;
  // Paths the check writes besides the write set (build output, tool caches); they become run artifacts.
  writes: string[];
}

export interface TestInventorySpec {
  argv?: string[];
  globs: string[];
}

export interface DependencySpec {
  install: string[];
  lockfile: string;
  // Host names the supervisor's install step may reach (the data comes from the repository, never from this file).
  registryHosts: string[];
}

export interface Conventions {
  schema: 1;
  checks: CheckSpec[];
  paths: { write: string[]; protected: string[]; artifacts: string[] };
  testInventory?: TestInventorySpec;
  dependencies?: DependencySpec;
  agentCommands: string[];
}

export const CHECK_NAME_PATTERN = /^[a-z][a-z0-9:_-]{0,63}$/;
export const ENV_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

// Environment names a check may never set: they decide which code runs or where it keeps its state (T-02-11). Names are
// compared as written; the prefixes are compared without regard to case.
export const RESERVED_CHECK_ENV: readonly string[] = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'NODE_OPTIONS',
  'NODE_PATH',
  'NODE_EXTRA_CA_CERTS',
  'BASH_ENV',
  'ENV',
  'SHELL',
  'IFS',
];
export const RESERVED_ENV_PREFIXES: readonly string[] = ['DYLD_', 'LD_', 'npm_config_'];

// First words an agent command may never start with (T-02-08): version control, AVARICE itself, the host, and anything
// that reaches the network or escalates.
export const REFUSED_AGENT_COMMAND_WORDS: readonly string[] = ['git', 'avarice', 'claude', 'gh', 'curl', 'wget', 'ssh', 'scp', 'sudo'];

export const LIMITS = {
  textChars: 262144,
  checks: 32,
  agentCommands: 64,
  globs: 128,
  globLength: 512,
  argvWords: 64,
  wordLength: 1024,
  commandLength: 256,
  envKeys: 32,
  envValueLength: 1024,
  timeoutSecMax: 3600,
  timeoutSecDefault: 600,
  hosts: 16,
} as const;

function invalid(field: string, reason: string): Result<never> {
  return err({ kind: 'invalid', field, reason });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const CONTROL = /[\u0000-\u001f\u007f]/;

function unknownKey(object: Record<string, unknown>, allowed: readonly string[], at: string): Result<never> | null {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) return invalid(`${at}.${key}`, 'unknown key');
  }
  return null;
}

// A repository-relative glob: no absolute path, no home reference, no `.` or `..` or empty segment, no backslash, NUL or
// control character, at most 512 characters.
export function validateGlob(field: string, raw: unknown): Result<string> {
  if (typeof raw !== 'string' || raw === '') return invalid(field, 'must be a non-empty string');
  if (raw.length > LIMITS.globLength) return invalid(field, `glob is longer than ${LIMITS.globLength} characters`);
  if (CONTROL.test(raw)) return invalid(field, 'glob holds a control character or NUL');
  if (raw.includes('\\')) return invalid(field, `glob ${JSON.stringify(raw)} holds a backslash`);
  if (raw.startsWith('/')) return invalid(field, `absolute glob ${JSON.stringify(raw)}`);
  if (raw.startsWith('~')) return invalid(field, `glob ${JSON.stringify(raw)} names a home directory`);
  if (raw.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return invalid(field, `glob ${JSON.stringify(raw)} holds an empty, "." or ".." segment`);
  }
  return ok(raw);
}

function readGlobs(field: string, raw: unknown): Result<string[]> {
  if (raw === undefined) return ok([]);
  if (!Array.isArray(raw)) return invalid(field, 'must be an array of globs');
  if (raw.length > LIMITS.globs) return invalid(field, `at most ${LIMITS.globs} globs`);
  const out: string[] = [];
  for (const entry of raw) {
    const glob = validateGlob(field, entry);
    if (!glob.ok) return glob;
    out.push(glob.value);
  }
  return ok(out);
}

function readArgv(field: string, raw: unknown): Result<string[]> {
  if (!Array.isArray(raw) || raw.length === 0) return invalid(field, 'must be a non-empty array of strings');
  if (raw.length > LIMITS.argvWords) return invalid(field, `at most ${LIMITS.argvWords} words`);
  const out: string[] = [];
  for (const word of raw) {
    if (typeof word !== 'string' || word === '') return invalid(field, 'every word must be a non-empty string');
    if (word.length > LIMITS.wordLength) return invalid(field, `a word is longer than ${LIMITS.wordLength} characters`);
    if (word.includes('\0')) return invalid(field, 'a word holds NUL');
    out.push(word);
  }
  return ok(out);
}

function isReservedEnv(key: string): boolean {
  if (RESERVED_CHECK_ENV.includes(key)) return true;
  const lower = key.toLowerCase();
  return RESERVED_ENV_PREFIXES.some((prefix) => lower.startsWith(prefix.toLowerCase()));
}

function readEnv(field: string, raw: unknown): Result<Record<string, string>> {
  if (raw === undefined) return ok({});
  if (!isPlainObject(raw)) return invalid(field, 'must be an object of strings');
  const entries = Object.entries(raw);
  if (entries.length > LIMITS.envKeys) return invalid(field, `at most ${LIMITS.envKeys} variables`);
  const env: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (isReservedEnv(key)) return invalid(field, `variable ${JSON.stringify(key)} is reserved: a check may not set it`);
    if (!ENV_KEY_PATTERN.test(key)) return invalid(field, `variable name ${JSON.stringify(key)} must match [A-Z_][A-Z0-9_]*`);
    if (typeof value !== 'string' || value.length > LIMITS.envValueLength || value.includes('\0')) {
      return invalid(field, `value of ${key} must be a string of at most ${LIMITS.envValueLength} characters without NUL`);
    }
    env[key] = value;
  }
  return ok(env);
}

const CHECK_KEYS = ['name', 'argv', 'timeoutSec', 'required', 'env', 'writes'] as const;

function readCheck(index: number, raw: unknown, seen: Set<string>): Result<CheckSpec> {
  const at = `conventions.checks[${index}]`;
  if (!isPlainObject(raw)) return invalid(at, 'must be an object');
  const unknown = unknownKey(raw, CHECK_KEYS, at);
  if (unknown) return unknown;
  const name = raw.name;
  if (typeof name !== 'string' || !CHECK_NAME_PATTERN.test(name)) {
    return invalid(`${at}.name`, 'must match [a-z][a-z0-9:_-]{0,63}');
  }
  if (seen.has(name)) return invalid(`${at}.name`, `duplicate check name ${JSON.stringify(name)}`);
  seen.add(name);
  const argv = readArgv(`${at}.argv`, raw.argv);
  if (!argv.ok) return argv;
  let timeoutSec: number = LIMITS.timeoutSecDefault;
  if (raw.timeoutSec !== undefined) {
    const value = raw.timeoutSec;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > LIMITS.timeoutSecMax) {
      return invalid(`${at}.timeoutSec`, `must be an integer from 1 to ${LIMITS.timeoutSecMax}`);
    }
    timeoutSec = value;
  }
  if (raw.required !== undefined && typeof raw.required !== 'boolean') return invalid(`${at}.required`, 'must be a boolean');
  const env = readEnv(`${at}.env`, raw.env);
  if (!env.ok) return env;
  const writes = readGlobs(`${at}.writes`, raw.writes);
  if (!writes.ok) return writes;
  return ok({ name, argv: argv.value, timeoutSec, required: raw.required ?? true, env: env.value, writes: writes.value });
}

// A command word is refused by its last path segment, without regard to case, so `/usr/bin/git` and `GIT` are refused too.
export function isRefusedAgentCommand(command: string): boolean {
  const first = command.split(' ')[0] ?? '';
  const base = (first.split('/').pop() ?? '').toLowerCase();
  return REFUSED_AGENT_COMMAND_WORDS.includes(base);
}

function readAgentCommand(field: string, raw: unknown): Result<string> {
  if (typeof raw !== 'string' || raw === '') return invalid(field, 'must be a non-empty string');
  if (raw.length > LIMITS.commandLength) return invalid(field, `command is longer than ${LIMITS.commandLength} characters`);
  if (CONTROL.test(raw)) return invalid(field, 'command holds a control character or NUL');
  if (/[;&|$`\\]/.test(raw)) return invalid(field, 'command chaining, substitution and escapes are not allowed');
  const tokens = raw.split(' ');
  if (tokens.some((token) => token === '')) return invalid(field, 'words must be separated by exactly one space');
  for (const [i, token] of tokens.entries()) {
    if (!/[<>]/.test(token)) continue;
    if (token !== '<paths>' || i !== tokens.length - 1 || i === 0) {
      return invalid(field, `token ${JSON.stringify(token)} is not allowed: only a single trailing <paths> is`);
    }
  }
  if (isRefusedAgentCommand(raw)) {
    return invalid(field, `commands starting with ${JSON.stringify(tokens[0])} are never granted to the agent`);
  }
  return ok(raw);
}

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function readHosts(field: string, raw: unknown): Result<string[]> {
  if (raw === undefined) return ok([]);
  if (!Array.isArray(raw)) return invalid(field, 'must be an array of host names');
  if (raw.length > LIMITS.hosts) return invalid(field, `at most ${LIMITS.hosts} hosts`);
  const out: string[] = [];
  for (const entry of raw) {
    const host = typeof entry === 'string' ? entry.toLowerCase() : '';
    if (host === '' || host.length > 253 || !host.split('.').every((label) => HOST_LABEL.test(label))) {
      return invalid(field, `${JSON.stringify(entry)} is not a bare host name`);
    }
    out.push(host);
  }
  return ok(out);
}

export function checkSpecDigest(checks: readonly CheckSpec[]): string {
  return digestOf(checks);
}

const TOP_KEYS = ['schema', 'checks', 'paths', 'testInventory', 'dependencies', 'agentCommands'] as const;
const PATH_KEYS = ['write', 'protected', 'artifacts'] as const;

export function parseConventions(text: string): Result<Conventions> {
  if (typeof text !== 'string' || text.length > LIMITS.textChars) {
    return invalid('conventions', `must be text of at most ${LIMITS.textChars} characters`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return invalid('conventions', 'is not valid JSON');
  }
  if (!isPlainObject(parsed)) return invalid('conventions', 'must be a JSON object');
  const unknown = unknownKey(parsed, TOP_KEYS, 'conventions');
  if (unknown) return unknown;
  if (parsed.schema !== 1) return invalid('conventions.schema', 'must be 1');

  const checks: CheckSpec[] = [];
  if (parsed.checks !== undefined) {
    if (!Array.isArray(parsed.checks)) return invalid('conventions.checks', 'must be an array');
    if (parsed.checks.length > LIMITS.checks) return invalid('conventions.checks', `at most ${LIMITS.checks} checks`);
    const seen = new Set<string>();
    for (const [index, entry] of parsed.checks.entries()) {
      const check = readCheck(index, entry, seen);
      if (!check.ok) return check;
      checks.push(check.value);
    }
  }

  let rawPaths: Record<string, unknown> = {};
  if (parsed.paths !== undefined) {
    if (!isPlainObject(parsed.paths)) return invalid('conventions.paths', 'must be an object');
    const unknownPath = unknownKey(parsed.paths, PATH_KEYS, 'conventions.paths');
    if (unknownPath) return unknownPath;
    rawPaths = parsed.paths;
  }
  const write = readGlobs('conventions.paths.write', rawPaths.write);
  if (!write.ok) return write;
  const protectedGlobs = readGlobs('conventions.paths.protected', rawPaths.protected);
  if (!protectedGlobs.ok) return protectedGlobs;
  const artifacts = readGlobs('conventions.paths.artifacts', rawPaths.artifacts);
  if (!artifacts.ok) return artifacts;

  const conventions: Conventions = {
    schema: 1,
    checks,
    paths: { write: write.value, protected: protectedGlobs.value, artifacts: artifacts.value },
    agentCommands: [],
  };

  if (parsed.testInventory !== undefined) {
    const raw = parsed.testInventory;
    if (!isPlainObject(raw)) return invalid('conventions.testInventory', 'must be an object');
    const unknownInventory = unknownKey(raw, ['argv', 'globs'], 'conventions.testInventory');
    if (unknownInventory) return unknownInventory;
    if (raw.globs === undefined) return invalid('conventions.testInventory.globs', 'is required');
    const globs = readGlobs('conventions.testInventory.globs', raw.globs);
    if (!globs.ok) return globs;
    if (raw.argv === undefined) {
      conventions.testInventory = { globs: globs.value };
    } else {
      const argv = readArgv('conventions.testInventory.argv', raw.argv);
      if (!argv.ok) return argv;
      conventions.testInventory = { argv: argv.value, globs: globs.value };
    }
  }

  if (parsed.dependencies !== undefined) {
    const raw = parsed.dependencies;
    if (!isPlainObject(raw)) return invalid('conventions.dependencies', 'must be an object');
    const unknownDeps = unknownKey(raw, ['install', 'lockfile', 'registryHosts'], 'conventions.dependencies');
    if (unknownDeps) return unknownDeps;
    const install = readArgv('conventions.dependencies.install', raw.install);
    if (!install.ok) return install;
    const lockfile = validateGlob('conventions.dependencies.lockfile', raw.lockfile);
    if (!lockfile.ok) return lockfile;
    if (/[*?[\]{}]/.test(lockfile.value)) return invalid('conventions.dependencies.lockfile', 'must be a path, not a glob');
    const hosts = readHosts('conventions.dependencies.registryHosts', raw.registryHosts);
    if (!hosts.ok) return hosts;
    conventions.dependencies = { install: install.value, lockfile: lockfile.value, registryHosts: hosts.value };
  }

  if (parsed.agentCommands !== undefined) {
    if (!Array.isArray(parsed.agentCommands)) return invalid('conventions.agentCommands', 'must be an array of commands');
    if (parsed.agentCommands.length > LIMITS.agentCommands) {
      return invalid('conventions.agentCommands', `at most ${LIMITS.agentCommands} commands`);
    }
    for (const [index, entry] of parsed.agentCommands.entries()) {
      const command = readAgentCommand(`conventions.agentCommands[${index}]`, entry);
      if (!command.ok) return command;
      conventions.agentCommands.push(command.value);
    }
  }
  return ok(conventions);
}
