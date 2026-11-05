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
import { errorLine, resultLine, stripControl } from '../render/style.ts';

export function usage(args: ParsedArgs): string | undefined {
  const profile = args.flags['profile'];
  if (profile !== undefined && profile !== DEFAULT_PROFILE) return `only ${DEFAULT_PROFILE} in Phase 1`;
  if (args.positionals.length > 0) return `unexpected argument '${args.positionals[0]}'`;
  return undefined;
}

// The store's schema version, and whether this process applied a migration to it: the composition root has already run
// by now, so a store whose latest migration was applied after this process started is one this `init` created.
function readStore(dataRoot: string, nowMs: number): { schema: string; created: boolean } {
  const opened = openDb(join(dataRoot, 'state.db'), { readOnly: true });
  if (!opened.ok) return { schema: `unknown (${describeError(opened.error)})`, created: false };
  try {
    const row = opened.value.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value?: unknown } | undefined;
    const applied = opened.value.prepare('SELECT max(applied_at) AS at FROM schema_migrations').get() as { at?: unknown } | undefined;
    const startedMs = nowMs - process.uptime() * 1000;
    return {
      schema: row?.value === undefined ? 'unknown' : String(row.value),
      created: typeof applied?.at === 'string' && Date.parse(applied.at) >= startedMs,
    };
  } finally {
    opened.value.close();
  }
}

export function run(_args: ParsedArgs, deps: AppDeps, io: Io): number {
  const { profile, configHome, dataRoot, workRoot } = deps.profile;
  const store = readStore(dataRoot, deps.clock.nowMs());
  io.out(
    [
      resultLine(`profile ${profile}`, store.created ? 'initialized' : 'already initialized'),
      `config:          ${stripControl(configPathFor(configHome, profile))}`,
      `data root:       ${stripControl(dataRoot)}`,
      `work root:       ${stripControl(workRoot)}`,
      `schema version:  ${stripControl(store.schema)}`,
      '',
      'note: the ledger uses node:sqlite, which Node still marks experimental; AVARICE refuses a runtime whose bundled SQLite lacks the WAL-reset fix.',
      '',
    ].join('\n'),
  );
  for (const dir of [configHome, dataRoot, workRoot]) {
    const mode = statSync(dir).mode & 0o777;
    if ((mode & 0o077) !== 0) io.err(`${errorLine('init', `warning: ${dir} has mode ${mode.toString(8).padStart(4, '0')} and is accessible to other users; run: chmod 700 '${dir}'`)}\n`);
  }
  return 0;
}
