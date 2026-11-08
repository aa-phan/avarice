// avarice install-host [--config-dir <dir>]
// Writes the `avarice-run` skill to `<claude config dir>/skills/avarice-run/SKILL.md` for attended sessions (docs/extensions.md entry 3).
// The directory is --config-dir, else $CLAUDE_CONFIG_DIR, else ~/.claude. Idempotent: an identical file is `unchanged`. It refuses inside a
// run (AVARICE_RUN is set), refuses a symbolic link at `skills`, `skills/avarice-run` or SKILL.md, and refuses to overwrite a SKILL.md
// that does not carry the AVARICE marker line (CS-11, RC-5, CON-6). It records the content digest as the adapter config
// `host-skill:avarice-run`. Exit 0 installed, unchanged or updated; 3 refused; 64 usage or inside a run; 70 internal failure.
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { describeError } from '../../adapters/sqlite/db.ts';
import { AVARICE_RUN_SKILL } from '../../adapters/host-claude/avarice-run-skill.ts';
import { installSkill } from '../../adapters/host-claude/skill-install.ts';
import type { AppDeps } from '../../app/deps.ts';
import type { Io, ParsedArgs } from '../args.ts';
import { errorLine, resultLine, stripControl } from '../render/style.ts';

const EXIT_REFUSED = 3;
const EXIT_INTERNAL = 70;

export const SKILL_CONFIG_NAME = 'host-skill:avarice-run';

const USAGE = 'usage: avarice install-host [--config-dir <dir>]';

// Checked before the profile is resolved, so a refusal inside a run leaves nothing on disk: no store, no profile, no skill.
export function usage(args: ParsedArgs, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env['AVARICE_RUN'] !== undefined) return 'refused inside a run (AVARICE_RUN is set)';
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

export function run(args: ParsedArgs, deps: AppDeps, io: Io): number {
  const installed = installSkill(configDirOf(args, deps), AVARICE_RUN_SKILL);
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
  return 0;
}
