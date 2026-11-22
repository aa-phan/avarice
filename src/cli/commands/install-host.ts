// avarice install-host [--config-dir <dir>]
// Writes the `avarice-run` skill to `<claude config dir>/skills/avarice-run/SKILL.md` for attended sessions (docs/extensions.md entry 3), and the attended
// PreToolUse hook entry to `<claude config dir>/settings.json` beside it (entries 2 and 4; plan 04-19), so a privileged shell form in the owner's own session
// needs an approval. The directory is --config-dir, else $CLAUDE_CONFIG_DIR, else ~/.claude. Idempotent: an identical file or entry is `unchanged`. It refuses
// inside a run (AVARICE_RUN is set, or a run supervisor is an ancestor process), refuses a symbolic link at `skills`, `skills/avarice-run`, SKILL.md or settings.json, refuses to overwrite a SKILL.md
// that does not carry the AVARICE marker line, and replaces in settings.json only an entry whose command carries the `--avarice-attended-hook` marker, leaving
// every other key and entry as it was (CS-11, RC-5, CON-6, T-04-52). It records the content digest of the skill as the adapter config
// `host-skill:avarice-run` and the digest of the hook entry as `host-hook:attended`. Exit 0 installed, unchanged or updated; 3 refused; 64 usage or inside a
// run; 70 internal failure.
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeError } from '../../adapters/sqlite/db.ts';
import { AVARICE_RUN_SKILL } from '../../adapters/host-claude/avarice-run-skill.ts';
import { installAttendedHook } from '../../adapters/host-claude/attended-hook-install.ts';
import { installSkill } from '../../adapters/host-claude/skill-install.ts';
import type { AppDeps } from '../../app/deps.ts';
import type { Io, ParsedArgs } from '../args.ts';
import { refuseInsideRun } from '../identity.ts';
import type { IdentityContext } from '../identity.ts';
import { errorLine, resultLine, stripControl } from '../render/style.ts';

const EXIT_REFUSED = 3;
const EXIT_INTERNAL = 70;

export const SKILL_CONFIG_NAME = 'host-skill:avarice-run';
export const HOOK_CONFIG_NAME = 'host-hook:attended';

const USAGE = 'usage: avarice install-host [--config-dir <dir>]';

// Checked before the profile is resolved, so a refusal inside a run leaves nothing on disk: no store, no profile, no skill. A run is refused by its marker and by its
// process tree (WR-24, T-04-122), because the command writes an executable hook entry into the owner's host settings.
export function usage(args: ParsedArgs, env: NodeJS.ProcessEnv = process.env, context?: IdentityContext): string | undefined {
  const refused = refuseInsideRun(env, context);
  if (refused !== undefined) return refused;
  if (args.positionals.length > 0) return `install-host takes no argument, found ${JSON.stringify(args.positionals[0])}\n${USAGE}`;
  const dir = args.flags['config-dir'];
  if (dir === true || dir === '') return `--config-dir needs a directory\n${USAGE}`;
  return undefined;
}

function configDirOf(args: ParsedArgs, deps: AppDeps): string {
  const flag = args.flags['config-dir'];
  if (typeof flag === 'string') return resolve(flag);
  const named = process.env['CLAUDE_CONFIG_DIR'];
  if (named !== undefined && named !== '') return resolve(named);
  return join(deps.home ?? homedir(), '.claude');
}

// The hook entry script the settings entry runs: the one the composition names (AVARICE_HOOK_ENTRY), else this checkout's.
function hookEntryOf(env: NodeJS.ProcessEnv = process.env): string {
  const named = env['AVARICE_HOOK_ENTRY'];
  return named !== undefined && named !== '' ? resolve(named) : fileURLToPath(new URL('../../hook/pre-tool-use.ts', import.meta.url));
}

export function run(args: ParsedArgs, deps: AppDeps, io: Io): number {
  const configDir = configDirOf(args, deps);
  const installed = installSkill(configDir, AVARICE_RUN_SKILL);
  if (!installed.ok) {
    const e = installed.error;
    if (e.kind === 'denied') {
      io.err(`${errorLine('install-host', `refused: ${e.rule}`)}\n`);
      return EXIT_REFUSED;
    }
    io.err(`${errorLine('install-host', `failed: ${describeError(e)}`)}\n`);
    return EXIT_INTERNAL;
  }
  const { status, path, digest } = installed.value;
  const descriptor = { skill: AVARICE_RUN_SKILL.name, path, digest };
  const recorded = deps.ledger.upsertAdapterConfig({ name: SKILL_CONFIG_NAME, port: 'host-skill', adapter: 'claude-code-skill', configDigest: digest, descriptor });
  if (!recorded.ok) {
    io.err(`${errorLine('install-host', `the skill is in place but its record failed: ${describeError(recorded.error)}`)}\n`);
    return EXIT_INTERNAL;
  }
  io.out(`${resultLine(`skill ${AVARICE_RUN_SKILL.name}`, status)}\npath: ${stripControl(path)}\ndigest: ${digest}\n`);

  // The attended hook entry, beside the skill. A refusal here leaves the skill in place and says so.
  const hook = installAttendedHook(configDir, { hookEntry: hookEntryOf(), dataRoot: resolve(deps.profile.dataRoot) });
  if (!hook.ok) {
    const e = hook.error;
    if (e.kind === 'denied') {
      io.err(`${errorLine('install-host', `the skill is in place; the attended hook was refused: ${e.rule}`)}\n`);
      return EXIT_REFUSED;
    }
    io.err(`${errorLine('install-host', `the skill is in place; the attended hook failed: ${describeError(e)}`)}\n`);
    return EXIT_INTERNAL;
  }
  const entry = hook.value;
  const hookRecorded = deps.ledger.upsertAdapterConfig({
    name: HOOK_CONFIG_NAME,
    port: 'host-hook',
    adapter: 'claude-code-hook',
    configDigest: entry.digest,
    descriptor: { hook: 'attended', path: entry.path, digest: entry.digest },
  });
  if (!hookRecorded.ok) {
    io.err(`${errorLine('install-host', `the attended hook is in place but its record failed: ${describeError(hookRecorded.error)}`)}\n`);
    return EXIT_INTERNAL;
  }
  io.out(`${resultLine('hook attended', entry.status)}\npath: ${stripControl(entry.path)}\ndigest: ${entry.digest}\n`);
  return 0;
}
