// Writes one skill into a Claude configuration directory (plan 02-15; CS-11, RC-5, CON-6). This is the only place AVARICE writes under a
// Claude configuration directory, and it writes one file: `<configDir>/skills/<name>/SKILL.md`. It never follows a symbolic link, never
// overwrites a file it did not write, and writes through a temporary file and a rename, so a reader sees the old file or the new one.
// A refusal is a `denied` error (the command exits 3); a failure to read or write is `internal`.
import { closeSync, constants, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { SKILL_MARKER } from './avarice-run-skill.ts';
import type { Skill } from './avarice-run-skill.ts';

export type SkillInstallStatus = 'installed' | 'unchanged' | 'updated';

export interface SkillInstall {
  status: SkillInstallStatus;
  // The SKILL.md that was written or found.
  path: string;
  digest: string;
}

// A SKILL.md larger than this is not one AVARICE wrote.
const MAX_EXISTING_BYTES = 256 * 1024;

const refuse = (rule: string): Result<never> => err({ kind: 'denied', rule, enforcer: 'avarice' });

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

// The existing file's text, read without following a symbolic link placed after the check.
function readExisting(path: string): string | 'symlink' {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ELOOP') return 'symlink';
    throw e;
  }
  try {
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}

export function installSkill(configDir: string, skill: Skill): Result<SkillInstall> {
  if (!isAbsolute(configDir)) return err({ kind: 'invalid', field: 'configDir', reason: 'must be an absolute path' });
  try {
    // The configuration directory itself may be a symbolic link (a dotfiles setup); everything under it may not.
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    let dir = realpathSync(configDir);
    for (const part of ['skills', skill.name]) {
      dir = join(dir, part);
      const stat = lstatOrNull(dir);
      if (stat === null) {
        mkdirSync(dir, { mode: 0o755 });
        continue;
      }
      if (stat.isSymbolicLink()) return refuse(`${dir} is a symbolic link, so nothing was written`);
      if (!stat.isDirectory()) return refuse(`${dir} is not a directory, so nothing was written`);
    }

    const file = join(dir, 'SKILL.md');
    const stat = lstatOrNull(file);
    let status: SkillInstallStatus = 'installed';
    if (stat !== null) {
      if (stat.isSymbolicLink()) return refuse(`${file} is a symbolic link, so nothing was written`);
      if (!stat.isFile()) return refuse(`${file} is not a regular file, so nothing was written`);
      if (stat.size > MAX_EXISTING_BYTES) return refuse(`${file} was not written by AVARICE (too large), so it was left untouched`);
      const existing = readExisting(file);
      if (existing === 'symlink') return refuse(`${file} is a symbolic link, so nothing was written`);
      if (!existing.split('\n').includes(SKILL_MARKER)) return refuse(`${file} was not written by AVARICE (it has no marker line), so it was left untouched`);
      if (existing === skill.text) return ok({ status: 'unchanged', path: file, digest: skill.digest });
      status = 'updated';
    }

    const temp = join(dir, `.SKILL.md.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
    // `wx` never opens an existing path, so a planted file or link at the temporary name is an error, not a write through it.
    const fd = openSync(temp, 'wx', 0o644);
    try {
      writeSync(fd, skill.text);
      fchmodSync(fd, 0o644);
      fsyncSync(fd);
    } catch (e) {
      closeSync(fd);
      unlinkSync(temp);
      throw e;
    }
    closeSync(fd);
    try {
      renameSync(temp, file);
    } catch (e) {
      unlinkSync(temp);
      throw e;
    }
    return ok({ status, path: file, digest: skill.digest });
  } catch (e) {
    return err({ kind: 'internal', cause: `cannot install the ${skill.name} skill: ${(e as NodeJS.ErrnoException).code ?? (e instanceof Error ? e.message : String(e))}` });
  }
}
