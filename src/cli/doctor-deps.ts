// The dependency set of `avarice doctor` (plan 04-25; OPS-1, OPS-6). Doctor exists to explain the problems the normal composition exits 70 on, so it does not use
// createDeps: no migration, no backup, no lease, no GSD requirement, no host composed, no executor probed. It resolves the profile the way every command does (which
// creates the profile directories and config file when they are absent, and nothing else), reads the profile's config, and builds the bounded probes. It never fails: a
// profile that cannot be prepared is reported as a finding by the read model, and the sections that do not need it are still filled.
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProcessDiagnostics } from '../adapters/diagnostics/probes.ts';
import { configPathFor, resolveProfile } from '../adapters/fs/profile-paths.ts';
import { attendedEntryPaths } from '../adapters/host-claude/attended-hook-install.ts';
import { processRedactor } from '../adapters/redaction/process-redactor.ts';
import { describeError, openDb } from '../adapters/sqlite/db.ts';
import type { Db } from '../adapters/sqlite/db.ts';
import { SqliteLedger } from '../adapters/sqlite/ledger.ts';
import type { DoctorDeps } from '../app/doctor.ts';
import type { Ledger } from '../ports/ledger.ts';
import { MIGRATIONS, locateOnPath, systemClock } from './composition.ts';
import { effectiveHostConfigDir } from './host-config-dir.ts';

export interface DoctorComposition {
  deps: DoctorDeps;
  close(): void;
}

// Whether a path is a regular file now (a symbolic link is followed, as the host's process start does).
function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function createDoctorDeps(env: NodeJS.ProcessEnv, profileName: string): DoctorComposition {
  const home = env['HOME'] !== undefined && env['HOME'] !== '' ? env['HOME'] : homedir();
  const resolved = resolveProfile(env, {}, profileName);
  const profile: DoctorDeps['profile'] = resolved.ok
    ? {
        ok: true,
        value: {
          profile: resolved.value.profile,
          class: resolved.value.class,
          configHome: resolved.value.configHome,
          dataRoot: resolved.value.dataRoot,
          workRoot: resolved.value.workRoot,
          configPath: configPathFor(resolved.value.configHome, resolved.value.profile),
          credentials: resolved.value.config.sections.credentials,
          limits: resolved.value.config.sections.limits,
        },
      }
    : { ok: false, message: describeError(resolved.error) };

  // The same rules the composition applies, so doctor reports the `claude` and the hook entry a command would use.
  const claudeBin = env['AVARICE_CLAUDE_BIN'] !== undefined && env['AVARICE_CLAUDE_BIN'] !== '' ? env['AVARICE_CLAUDE_BIN'] : locateOnPath('claude', env['PATH']);
  const hookEntry = env['AVARICE_HOOK_ENTRY'] !== undefined && env['AVARICE_HOOK_ENTRY'] !== '' ? env['AVARICE_HOOK_ENTRY'] : fileURLToPath(new URL('../hook/pre-tool-use.ts', import.meta.url));
  const claudeConfigDir = effectiveHostConfigDir(env, home);
  const defaultConfigDir = effectiveHostConfigDir({ ...env, CLAUDE_CONFIG_DIR: undefined }, home);

  let db: Db | undefined;
  const readLedger = (): Ledger | undefined => {
    if (!profile.ok) return undefined;
    const opened = openDb(join(profile.value.dataRoot, 'state.db'), { readOnly: true });
    if (!opened.ok) return undefined;
    db = opened.value;
    return new SqliteLedger(db, () => {
      throw new Error('doctor does not write');
    });
  };

  return {
    deps: {
      env,
      profile,
      claudeBin,
      hookEntry,
      claudeConfigDir,
      extensionDirs: claudeConfigDir === defaultConfigDir ? [claudeConfigDir] : [claudeConfigDir, defaultConfigDir],
      attendedEntryFiles: (command) => {
        const paths = attendedEntryPaths(command);
        if (paths === null) return [];
        return [
          { role: 'node executable', path: paths.node, present: isRegularFile(paths.node) },
          { role: 'hook script', path: paths.script, present: isRegularFile(paths.script) },
        ];
      },
      expectedSchema: Math.max(...MIGRATIONS.map((m) => m.version)),
      diagnostics: new ProcessDiagnostics(),
      readLedger,
      clock: systemClock(),
      redact: (text) => processRedactor.redact(text),
    },
    close: () => {
      try {
        db?.close();
      } catch {
        // already closed
      }
    },
  };
}
