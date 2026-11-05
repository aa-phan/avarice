// Repository conventions (`.avarice/config.json`, schema 1; docs/contracts-and-state.md "Run contract").
// Pure: the caller reads the file from git objects and passes the text. The text is data from whoever controls the
// repository, so it is parsed and every field is validated here; nothing in it is an instruction to AVARICE (RC-2).
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

function invalid(field: string, reason: string): Result<never> {
  return err({ kind: 'invalid', field, reason });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// A repository-relative glob.
export function validateGlob(field: string, raw: unknown): Result<string> {
  if (typeof raw !== 'string' || raw === '') return invalid(field, 'must be a non-empty string');
  if (raw.startsWith('/')) return invalid(field, `absolute glob ${JSON.stringify(raw)}`);
  return ok(raw);
}

export function checkSpecDigest(checks: readonly CheckSpec[]): string {
  return digestOf(checks);
}

function readGlobs(field: string, raw: unknown): Result<string[]> {
  if (raw === undefined) return ok([]);
  if (!Array.isArray(raw)) return invalid(field, 'must be an array of globs');
  const out: string[] = [];
  for (const entry of raw) {
    const glob = validateGlob(field, entry);
    if (!glob.ok) return glob;
    out.push(glob.value);
  }
  return ok(out);
}

function readCheck(index: number, raw: unknown): Result<CheckSpec> {
  const at = `conventions.checks[${index}]`;
  if (!isPlainObject(raw)) return invalid(at, 'must be an object');
  if (typeof raw.name !== 'string') return invalid(`${at}.name`, 'must be a string');
  if (!Array.isArray(raw.argv) || raw.argv.some((word) => typeof word !== 'string')) {
    return invalid(`${at}.argv`, 'must be an array of strings');
  }
  const writes = readGlobs(`${at}.writes`, raw.writes);
  if (!writes.ok) return writes;
  const env: Record<string, string> = {};
  if (isPlainObject(raw.env)) {
    for (const [key, value] of Object.entries(raw.env)) {
      if (typeof value === 'string') env[key] = value;
    }
  }
  return ok({
    name: raw.name,
    argv: raw.argv as string[],
    timeoutSec: typeof raw.timeoutSec === 'number' ? raw.timeoutSec : 600,
    required: typeof raw.required === 'boolean' ? raw.required : true,
    env,
    writes: writes.value,
  });
}

export function parseConventions(text: string): Result<Conventions> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return invalid('conventions', 'is not valid JSON');
  }
  if (!isPlainObject(parsed)) return invalid('conventions', 'must be a JSON object');
  if (parsed.schema !== 1) return invalid('conventions.schema', 'must be 1');
  const checks: CheckSpec[] = [];
  if (Array.isArray(parsed.checks)) {
    for (const [index, entry] of parsed.checks.entries()) {
      const check = readCheck(index, entry);
      if (!check.ok) return check;
      checks.push(check.value);
    }
  }
  const paths = isPlainObject(parsed.paths) ? parsed.paths : {};
  const write = readGlobs('conventions.paths.write', paths.write);
  if (!write.ok) return write;
  const protectedGlobs = readGlobs('conventions.paths.protected', paths.protected);
  if (!protectedGlobs.ok) return protectedGlobs;
  const artifacts = readGlobs('conventions.paths.artifacts', paths.artifacts);
  if (!artifacts.ok) return artifacts;
  const agentCommands = Array.isArray(parsed.agentCommands)
    ? parsed.agentCommands.filter((c): c is string => typeof c === 'string')
    : [];
  const conventions: Conventions = {
    schema: 1,
    checks,
    paths: { write: write.value, protected: protectedGlobs.value, artifacts: artifacts.value },
    agentCommands,
  };
  const inventory = parsed.testInventory;
  if (isPlainObject(inventory)) {
    const globs = readGlobs('conventions.testInventory.globs', inventory.globs);
    if (!globs.ok) return globs;
    conventions.testInventory = Array.isArray(inventory.argv)
      ? { argv: inventory.argv as string[], globs: globs.value }
      : { globs: globs.value };
  }
  const dependencies = parsed.dependencies;
  if (isPlainObject(dependencies)) {
    conventions.dependencies = {
      install: Array.isArray(dependencies.install) ? (dependencies.install as string[]) : [],
      lockfile: typeof dependencies.lockfile === 'string' ? dependencies.lockfile : '',
      registryHosts: Array.isArray(dependencies.registryHosts) ? (dependencies.registryHosts as string[]) : [],
    };
  }
  return ok(conventions);
}
