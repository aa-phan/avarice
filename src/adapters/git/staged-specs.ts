// Staged GSD specs (plan 04-34, owner ruling (a) after the second D-04 stop). The restricted host confines the file tools to the working directory, so the GSD workflow
// specs the fast map reads are copied from GSD's own directory into `.claude/gsd-core/` of the staging copy, where the map skill looks first for a project-local
// spec, and are taken out again when the invocation is settled. Only the closure of the seed files is copied (restricted-specs.ts), every file read-only (0444),
// and the copy is made through no symbolic link. A marker file names the directory as AVARICE's: a `.claude/gsd-core` the repository itself holds is never replaced
// or removed, and a leftover of this one (a kill between the copy and the removal) is replaced.
import { chmodSync, lstatSync, mkdirSync, realpathSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { MAX_SPEC_BYTES, RESTRICTED_SPEC_DIR, specClosure } from '../../domain/restricted-specs.ts';
import type { GsdSpecsInput, StagedGsdSpecs } from '../../ports/staging-workspace.ts';
import { denied, inside, invalid, readConfinedFile } from './staging-base.ts';

// Names the staged directory as this adapter's. It sits in the directory and is read-only like the specs.
export const STAGED_SPECS_MARKER = '.avarice-staged';

const FILE_MODE = 0o444;
const DIR_MODE = 0o755;

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}

const internal = (what: string, error: unknown): Result<never> => err({ kind: 'internal', cause: `${what}: ${(error as NodeJS.ErrnoException).code ?? String(error)}` });

// The staging root as a real path, or the error that says it is not one.
function stagingRoot(stagingPath: string): Result<string> {
  if (!isAbsolute(stagingPath)) return invalid('path', 'an absolute path is required');
  try {
    return ok(realpathSync(stagingPath));
  } catch {
    return err({ kind: 'not_found', ref: stagingPath });
  }
}

// Whether a directory is one this adapter made: a real directory (not a link) that holds the marker as a regular file.
function isStagedDir(path: string, stat: Stats): boolean {
  if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
  const marker = lstatOrNull(join(path, STAGED_SPECS_MARKER));
  return marker !== null && marker.isFile();
}

function removeEmptyDotClaude(dotClaude: string): void {
  try {
    rmdirSync(dotClaude);
  } catch {
    // Not empty (the repository holds files there) or already gone: not ours to remove.
  }
}

export function stageGsdSpecs(stagingPath: string, input: GsdSpecsInput): Result<StagedGsdSpecs> {
  if (!isAbsolute(input.gsdCoreDir)) return invalid('gsdCoreDir', 'an absolute path is required');
  const root = stagingRoot(stagingPath);
  if (!root.ok) return root;

  // The closure is read, whole, before anything is written: a missing seed or a closure past a cap leaves the staging copy untouched.
  const closure = specClosure(input.seeds, (rel) => readConfinedFile(input.gsdCoreDir, rel, MAX_SPEC_BYTES));
  if (!closure.ok) return closure;

  const dotClaude = join(root.value, '.claude');
  const target = join(root.value, RESTRICTED_SPEC_DIR);
  try {
    const dotStat = lstatOrNull(dotClaude);
    if (dotStat?.isSymbolicLink() === true) return denied('staging-writes-stay-inside-staging');
    if (dotStat !== null && !dotStat.isDirectory()) return err({ kind: 'conflict', expected: 'a directory or nothing at .claude', actual: 'a file the repository holds' });
    const targetStat = lstatOrNull(target);
    if (targetStat !== null) {
      if (!isStagedDir(target, targetStat)) return err({ kind: 'conflict', expected: `no ${RESTRICTED_SPEC_DIR} in the staging copy`, actual: `${RESTRICTED_SPEC_DIR} that the repository holds` });
      rmSync(target, { recursive: true, force: true });
    }

    try {
      mkdirSync(target, { recursive: true, mode: DIR_MODE });
      writeFileSync(join(target, STAGED_SPECS_MARKER), 'staged by AVARICE for the restricted map; removed when the invocation is settled\n', { flag: 'wx', mode: FILE_MODE });
      chmodSync(join(target, STAGED_SPECS_MARKER), FILE_MODE);
      for (const file of closure.value) {
        const destination = resolve(target, file.path);
        if (!inside(target, destination)) return denied('staging-writes-stay-inside-staging');
        mkdirSync(dirname(destination), { recursive: true, mode: DIR_MODE });
        writeFileSync(destination, file.text, { flag: 'wx', mode: FILE_MODE });
        chmodSync(destination, FILE_MODE);
      }
    } catch (error) {
      // Nothing partial stays: what was written is taken out again before the failure is reported.
      rmSync(target, { recursive: true, force: true });
      removeEmptyDotClaude(dotClaude);
      return internal('staging the GSD specs', error);
    }
    return ok({ root: RESTRICTED_SPEC_DIR, files: closure.value.map((f) => f.path) });
  } catch (error) {
    return internal('staging the GSD specs', error);
  }
}

export function unstageGsdSpecs(stagingPath: string): Result<void> {
  const root = stagingRoot(stagingPath);
  if (!root.ok) return root.error.kind === 'not_found' ? ok(undefined) : root;
  const dotClaude = join(root.value, '.claude');
  const target = join(root.value, RESTRICTED_SPEC_DIR);
  try {
    const dotStat = lstatOrNull(dotClaude);
    if (dotStat === null) return ok(undefined);
    if (dotStat.isSymbolicLink()) return denied('staging-writes-stay-inside-staging');
    if (!dotStat.isDirectory()) return ok(undefined);
    const targetStat = lstatOrNull(target);
    // A directory the repository holds is left as it is, with its files.
    if (targetStat !== null && isStagedDir(target, targetStat)) rmSync(target, { recursive: true, force: true });
    removeEmptyDotClaude(dotClaude);
    return ok(undefined);
  } catch (error) {
    return internal('removing the staged GSD specs', error);
  }
}
