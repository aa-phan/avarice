// The generated plugin directory that restores GSD's skills under `--setting-sources ""` (spike S0-E): the host
// loads skills only through `--plugin-dir`, namespaced as `avarice-run-skills:<name>`. Each skill is a symlink
// to the realpath of the user's skill directory, so nothing is copied and nothing outside the named skills
// loads.
import { lstatSync, mkdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { PLAIN_NAME } from './agents-json.ts';

export const PLUGIN_NAME = 'avarice-run-skills';

// What each contained invocation may load is PURPOSE_EXTENSIONS (src/domain/invocation-scope.ts); re-exported here, where
// the plugin directory and the --agents file are built from it.
export { PURPOSE_EXTENSIONS, PURPOSE_SUBAGENT_TYPES } from '../../domain/invocation-scope.ts';

export function buildPluginDir(outDir: string, skillsRoot: string, names: readonly string[]): Result<{ dir: string; skills: string[] }> {
  // Resolve every skill before creating anything, so a missing skill leaves no half-built plugin.
  const targets: Array<[string, string]> = [];
  for (const name of names) {
    if (!PLAIN_NAME.test(name)) return err({ kind: 'invalid', field: 'skill', reason: `${JSON.stringify(name)} is not a plain skill name` });
    try {
      const real = realpathSync(join(skillsRoot, name));
      if (!statSync(real).isDirectory()) return err({ kind: 'not_found', ref: `skill:${name}` });
      targets.push([name, real]);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return err({ kind: 'not_found', ref: `skill:${name}` });
      return err({ kind: 'internal', cause: `cannot resolve skill ${name}: ${code ?? 'unresolvable'}` });
    }
  }

  try {
    mkdirSync(join(outDir, '.claude-plugin'), { recursive: true, mode: 0o700 });
    writeFileSync(join(outDir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: PLUGIN_NAME, version: '0.0.0' }) + '\n', { mode: 0o600 });
    const skillsDir = join(outDir, 'skills');
    // Links from an earlier build are removed (a link is unlinked, its target is never touched).
    rmSync(skillsDir, { recursive: true, force: true });
    mkdirSync(skillsDir, { recursive: true, mode: 0o700 });
    for (const [name, real] of targets) {
      symlinkSync(real, join(skillsDir, name));
      if (!lstatSync(join(skillsDir, name)).isSymbolicLink()) return err({ kind: 'internal', cause: `skill ${name} was not linked` });
    }
  } catch (e) {
    return err({ kind: 'internal', cause: `cannot build the plugin directory: ${(e as NodeJS.ErrnoException).code ?? 'write failed'}` });
  }
  return ok({ dir: outDir, skills: targets.map(([name]) => name) });
}
