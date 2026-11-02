// avarice init [--profile personal-local]
// First-run path: the composition root has already checked the root placement rules, created the profile
// config (0600), the data root and the work root (0700) and opened and migrated the ledger, so init reports
// what it resolved. Idempotent: a second run changes nothing.
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { configPathFor, DEFAULT_PROFILE } from '../../adapters/fs/profile-paths.ts';
import { describeError, openDb } from '../../adapters/sqlite/db.ts';
import type { AppDeps } from '../../app/deps.ts';
import type { Io, ParsedArgs } from '../args.ts';

export function usage(args: ParsedArgs): string | undefined {
  const profile = args.flags['profile'];
  if (profile !== undefined && profile !== DEFAULT_PROFILE) return `only ${DEFAULT_PROFILE} in Phase 1`;
  if (args.positionals.length > 0) return `unexpected argument '${args.positionals[0]}'`;
  return undefined;
}

function schemaVersion(dataRoot: string): string {
  const opened = openDb(join(dataRoot, 'state.db'), { readOnly: true });
  if (!opened.ok) return `unknown (${describeError(opened.error)})`;
  try {
    const row = opened.value.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value?: unknown } | undefined;
    return row?.value === undefined ? 'unknown' : String(row.value);
  } finally {
    opened.value.close();
  }
}

export function run(_args: ParsedArgs, deps: AppDeps, io: Io): number {
  const { profile, configHome, dataRoot, workRoot } = deps.profile;
  io.out(
    [
      `profile:         ${profile}`,
      `config:          ${configPathFor(configHome, profile)}`,
      `data root:       ${dataRoot}`,
      `work root:       ${workRoot}`,
      `schema version:  ${schemaVersion(dataRoot)}`,
      '',
      'note: the ledger uses node:sqlite, which Node still marks experimental; AVARICE refuses a runtime whose bundled SQLite lacks the WAL-reset fix.',
      '',
    ].join('\n'),
  );
  for (const dir of [configHome, dataRoot, workRoot]) {
    const mode = statSync(dir).mode & 0o777;
    if ((mode & 0o077) !== 0) io.err(`warning: ${dir} has mode ${mode.toString(8).padStart(4, '0')} and is accessible to other users; run: chmod 700 '${dir}'\n`);
  }
  return 0;
}
