// Root placement rules (SKELETON.md "Roots"; spike "paths under the Claude config directory are unwritable").
// Pure: every input is an already realpath'd absolute POSIX path, so a symlinked root is judged by where it
// lands. Rules, in the order they are reported for each root (data root first, then work root):
//   1. not under a ~/.claude* directory (any first segment under home that starts with `.claude`)
//   2. not equal to or under realpath(CLAUDE_CONFIG_DIR)
//   3. does not contain the home directory or the Claude config directory
// then, for the pair:
//   4. the work root is not inside the data root, nor the data root inside the work root (never nested)
import { err, ok } from './result.ts';
import type { Result } from './result.ts';

export interface RootInputs {
  home: string;
  claudeConfigDirReal: string;
  dataRoot: string;
  workRoot: string;
}

function strip(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.replace(/\/+$/, '') || '/' : path;
}

// True when `path` equals `base` or lies below it, on a path-segment boundary.
function isWithin(path: string, base: string): boolean {
  const p = strip(path);
  const b = strip(base);
  if (b === '/') return true;
  return p === b || p.startsWith(b + '/');
}

function refuse(field: 'dataRoot' | 'workRoot', reason: string): Result<void> {
  return err({ kind: 'invalid', field, reason });
}

function checkOne(field: 'dataRoot' | 'workRoot', path: string, home: string, claudeConfigDirReal: string): Result<void> {
  const label = field === 'dataRoot' ? 'data root' : 'work root';
  const homeDir = strip(home);
  if (homeDir !== '/' && isWithin(path, homeDir) && strip(path) !== homeDir) {
    const first = strip(path).slice(homeDir.length + 1).split('/')[0] ?? '';
    if (first.startsWith('.claude')) {
      return refuse(
        field,
        `the ${label} '${path}' lies under ~/.claude* ('${homeDir}/${first}'); sandboxed runs cannot write there and AVARICE keeps no state under a Claude config directory. Choose a location outside every ~/.claude* directory (set AVARICE_${field === 'dataRoot' ? 'DATA' : 'WORK'}_ROOT)`,
      );
    }
  }
  if (isWithin(path, claudeConfigDirReal)) {
    return refuse(field, `the ${label} '${path}' is the Claude config directory or lies under it (CLAUDE_CONFIG_DIR resolves to '${claudeConfigDirReal}'); choose a location outside it`);
  }
  if (isWithin(homeDir, path)) {
    return refuse(field, `the ${label} '${path}' would contain the home directory '${homeDir}'; choose a dedicated directory`);
  }
  if (isWithin(claudeConfigDirReal, path)) {
    return refuse(field, `the ${label} '${path}' would contain the Claude config directory (CLAUDE_CONFIG_DIR resolves to '${claudeConfigDirReal}'); choose a dedicated directory`);
  }
  return ok(undefined);
}

export function checkRoots(inputs: RootInputs): Result<void> {
  const data = checkOne('dataRoot', inputs.dataRoot, inputs.home, inputs.claudeConfigDirReal);
  if (!data.ok) return data;
  const work = checkOne('workRoot', inputs.workRoot, inputs.home, inputs.claudeConfigDirReal);
  if (!work.ok) return work;
  if (isWithin(inputs.workRoot, inputs.dataRoot)) {
    return refuse('workRoot', `the work root '${inputs.workRoot}' is inside the data root '${inputs.dataRoot}'; the two roots must be separate, un-nested directories`);
  }
  if (isWithin(inputs.dataRoot, inputs.workRoot)) {
    return refuse('dataRoot', `the data root '${inputs.dataRoot}' is inside the work root '${inputs.workRoot}'; the two roots must be separate, un-nested directories`);
  }
  return ok(undefined);
}
